#!/usr/bin/env bash
# Reset cache-registry and cache-package state to empty so the next
# e2e run starts from a fully cold cache. Cache files are owned by
# container uids (registry, apt-cacher-ng, devpi, verdaccio) and
# unreachable from the host shell, so the wipe runs in a privileged
# alpine container with the bind mount.
#
# Triggered by `make e2e-dashboard-wipe-caches`. Stops the cache
# services first so file handles are released cleanly.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
STATE_DIR="${INFINITO_E2E_STATE_DIR:-${REPO_ROOT}/state}"

echo "→ wipe-caches: stopping cache-registry + cache-package"
(cd "${REPO_ROOT}" &&
  docker compose -f docker-compose.yml --profile test stop cache-registry cache-package 2>&1 |
  sed 's/^/  /' || true)

if [[ ! -d "${STATE_DIR}" ]]; then
  echo "→ wipe-caches: ${STATE_DIR} does not exist; nothing to do"
  exit 0
fi

state_dir_abs="$(cd "${STATE_DIR}" && pwd -P)"
# The harness creates the bind dirs under state/e2e/cache-{registry,package}
# (see prepare_cache_dirs in run.sh). Wipe must match that location.
echo "→ wipe-caches: clearing ${state_dir_abs}/e2e/{cache-registry,cache-package}"

docker run --rm \
  -v "${state_dir_abs}:/state" \
  alpine:latest \
  sh -c 'rm -rf /state/e2e/cache-registry/* /state/e2e/cache-package/* 2>/dev/null || true' \
  >/dev/null 2>&1 || true

echo "→ wipe-caches: done"
