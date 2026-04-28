#!/bin/sh
# cache-package entrypoint:
#   1. Ensures /state/cache-package/{apt,pip,npm} exist and are owned by
#      the right service user — bind-mounted host directory may be empty
#      on first run.
#   2. Runs `devpi-init` exactly once (guarded by a marker file) so the
#      devpi server has a writable serverdir with the default `root/pypi`
#      mirror before s6-overlay starts the long-running supervisor.
#   3. Hands off to s6-overlay's /init.
set -eu

STATE_ROOT="/state/cache-package"
APT_DIR="${STATE_ROOT}/apt"
PIP_DIR="${STATE_ROOT}/pip"
NPM_DIR="${STATE_ROOT}/npm"

mkdir -p "${APT_DIR}" "${PIP_DIR}" "${NPM_DIR}"

# Ownership is idempotent: if already correct chown is a no-op.
chown -R apt-cacher-ng:apt-cacher-ng "${APT_DIR}"
chown -R devpi:devpi                 "${PIP_DIR}"
chown -R verdaccio:verdaccio         "${NPM_DIR}"

# devpi-init seeds the server state. Marker file prevents re-init on
# every container restart (would error on existing server dir).
DEVPI_MARKER="${PIP_DIR}/.initialised"
if [ ! -f "${DEVPI_MARKER}" ]; then
  echo "[entrypoint] devpi-init: seeding server state at ${PIP_DIR}"
  su -s /bin/sh devpi -c "devpi-init --serverdir ${PIP_DIR}"
  touch "${DEVPI_MARKER}"
  chown devpi:devpi "${DEVPI_MARKER}"
fi

# Hand off to s6-overlay (CMD ["/init"]).
exec "$@"
