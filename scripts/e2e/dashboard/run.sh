#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-ci}"

if [[ "${MODE}" != "local" && "${MODE}" != "ci" ]]; then
  echo "Usage: $0 <local|ci>" >&2
  echo "" >&2
  echo "  local  Build image from INFINITO_NEXUS_SRC_DIR (required) and run E2E." >&2
  echo "  ci     Pull configured registry image and run E2E (no source dir needed)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APPS_WEB_DIR="${REPO_ROOT}/apps/web"
STATE_DIR="${REPO_ROOT}/state"
ENV_SOURCE="${REPO_ROOT}/.env"
CI_CATALOG_IMAGE_DEFAULT="ghcr.io/infinito-nexus/core/debian@sha256:b494b40a45823fbefea7936c20f512582496a2e977a5c5ad3511775e98e83023"
CI_RUNNER_IMAGE_DEFAULT="ghcr.io/infinito-nexus/core/arch@sha256:9d6c7709caab53eeb1f227a1002f06df29990dfa0c4d41ca7cb84594c081f2cb"
CI_POSTGRES_IMAGE_DEFAULT="postgres@sha256:4327b9fd295502f326f44153a1045a7170ddbfffed1c3829798328556cfd09e2"
E2E_DIAGNOSTIC_IMAGE=""

if [[ ! -f "${ENV_SOURCE}" ]]; then
  ENV_SOURCE="${REPO_ROOT}/env.example"
fi

mkdir -p "${STATE_DIR}"

resolve_dir() {
  local target="${1}"
  (
    cd "${target}"
    pwd -P
  )
}

warn_unpinned_local_image() {
  local image_ref="${1}"
  if [[ -n "${image_ref}" && ! "${image_ref}" =~ @sha256:[0-9a-f]{64}$ ]]; then
    echo "WARN: unpinned local image ${image_ref}, digest pinning enforced only in CI/prod"
  fi
}

ensure_state_dir_access() {
  local repair_image="${1}"
  local current_uid current_gid
  current_uid="$(id -u)"
  current_gid="$(id -g)"

  mkdir -p "${STATE_DIR}"
  if [[ -d "${STATE_DIR}" && -r "${STATE_DIR}" && -w "${STATE_DIR}" && -x "${STATE_DIR}" ]]; then
    return 0
  fi

  echo "→ Repairing repo-local state/ ownership for the current user (${current_uid}:${current_gid})"
  docker run --rm \
    -v "${STATE_DIR}:/mnt" \
    "${repair_image}" \
    sh -lc "chown ${current_uid}:${current_gid} /mnt && chmod 0755 /mnt"

  if [[ ! -d "${STATE_DIR}" || ! -r "${STATE_DIR}" || ! -w "${STATE_DIR}" || ! -x "${STATE_DIR}" ]]; then
    echo "✖ state/ is still not accessible after ownership repair." >&2
    echo "  Run: docker run --rm -v \"${STATE_DIR}:/mnt\" \"${repair_image}\" sh -lc 'chown ${current_uid}:${current_gid} /mnt && chmod 0755 /mnt'" >&2
    exit 1
  fi
}

resolve_docker_socket_path() {
  local socket_path="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"
  printf '%s\n' "${socket_path}"
}

resolve_docker_socket_gid() {
  local socket_path
  socket_path="$(resolve_docker_socket_path)"

  if [[ ! -S "${socket_path}" ]]; then
    echo "✖ Docker socket is missing or not a Unix socket: ${socket_path}" >&2
    echo "  Run: ls -ln ${socket_path}" >&2
    echo "  Run: stat -c '%u %g %a %n' ${socket_path}" >&2
    exit 1
  fi

  # Centralised probe: resolves to the gid containers actually see, falling
  # back to host stat if the docker daemon / alpine pull is unavailable.
  bash "${REPO_ROOT}/scripts/util/resolve-docker-socket-gid.sh" "${socket_path}"
}

require_src_dir() {
  local src="${INFINITO_NEXUS_SRC_DIR:-}"
  if [[ -z "${src}" ]]; then
    echo "✖ INFINITO_NEXUS_SRC_DIR is not set." >&2
    echo "  Set it to the absolute path of your Infinito.Nexus source directory." >&2
    echo "  Example: make e2e-dashboard-local INFINITO_NEXUS_SRC_DIR=/path/to/infinito-nexus" >&2
    exit 1
  fi
  if [[ ! -d "${src}" ]]; then
    echo "✖ INFINITO_NEXUS_SRC_DIR does not exist: ${src}" >&2
    exit 1
  fi
  local resolved
  resolved="$(resolve_dir "${src}")"
  if [[ -z "$(find "${resolved}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "✖ INFINITO_NEXUS_SRC_DIR is empty: ${resolved}" >&2
    exit 1
  fi
  printf '%s\n' "${resolved}"
}

resolve_local_image_tag() {
  local src_dir="${1}"
  local distro="${2}"
  (
    cd "${src_dir}"
    INFINITO_DISTRO="${distro}" bash scripts/meta/resolve/image/local.sh
  )
}

build_local_image() {
  local src_dir="${1}"
  local distro="${2}"
  local image_tag="${3}"
  echo "→ Building Infinito.Nexus image (${image_tag}) from ${src_dir}"
  (
    cd "${src_dir}"
    INFINITO_DISTRO="${distro}" IMAGE_TAG="${image_tag}" make build-missing
  )
}

prepare_local_repo_cache() {
  local cache_output
  mapfile -t cache_output < <(
    "${SCRIPT_DIR}/prepare-local-repo-cache.sh" \
      --repo-root "${REPO_ROOT}" \
      --state-dir "${STATE_DIR}"
  )
  if [[ "${#cache_output[@]}" -lt 2 ]]; then
    echo "✖ Failed to prepare the local E2E repo cache." >&2
    exit 1
  fi
  printf '%s\n%s\n' "${cache_output[0]}" "${cache_output[1]}"
}

prepare_cache_dirs() {
  local registry_dir="${STATE_DIR}/e2e/cache-registry"
  local package_dir="${STATE_DIR}/e2e/cache-package"
  mkdir -p "${registry_dir}" "${package_dir}"
  printf '%s\n%s\n' "${registry_dir}" "${package_dir}"
}

render_env_file() {
  local target_file="${1}"
  local catalog_image
  local runner_image
  local enforce_digest_pinning="true"
  local docker_socket_path
  local docker_socket_gid
  local test_repo_mirror_host_path
  local test_repo_seed_host_path
  local test_cache_registry_host_path
  local test_cache_package_host_path

  if [[ "${MODE}" == "local" ]]; then
    local src_dir distro image_tag
    src_dir="$(require_src_dir)"
    distro="${INFINITO_E2E_LOCAL_DISTRO:-debian}"
    image_tag="${INFINITO_E2E_LOCAL_IMAGE:-$(resolve_local_image_tag "${src_dir}" "${distro}")}"
    warn_unpinned_local_image "${image_tag}"
    build_local_image "${src_dir}" "${distro}" "${image_tag}"
    catalog_image="${image_tag}"
    runner_image="${image_tag}"
    enforce_digest_pinning="false"
  else
    catalog_image="${INFINITO_E2E_CATALOG_IMAGE:-${CI_CATALOG_IMAGE_DEFAULT}}"
    runner_image="${INFINITO_E2E_JOB_RUNNER_IMAGE:-${CI_RUNNER_IMAGE_DEFAULT}}"
    echo "→ Pulling Infinito.Nexus catalog image (${catalog_image})"
    docker pull "${catalog_image}"
    echo "→ Pulling Infinito.Nexus runner image (${runner_image})"
    docker pull "${runner_image}"
  fi
  E2E_DIAGNOSTIC_IMAGE="${catalog_image}"

  ensure_state_dir_access "${catalog_image}"

  mapfile -t repo_cache_paths < <(prepare_local_repo_cache)
  test_repo_mirror_host_path="${repo_cache_paths[0]}"
  test_repo_seed_host_path="${repo_cache_paths[1]}"
  mapfile -t cache_paths < <(prepare_cache_dirs)
  test_cache_registry_host_path="${cache_paths[0]}"
  test_cache_package_host_path="${cache_paths[1]}"
  echo "→ Using hermetic E2E repo cache + cache-registry (docker.io) + cache-package (apt/pip/npm)"
  echo "  ssh-password's inner DinD routes docker.io pulls through cache-registry"
  echo "  via --registry-mirror; ghcr.io / quay.io / etc. pull direct."
  echo "  Build containers consume cache-package via INFINITO_CACHE_* build-args"
  echo "  (when the consuming Dockerfile supports them)."

  local api_port="${E2E_API_PORT}"
  local web_port="${E2E_WEB_PORT}"
  local api_proxy_target="http://api:${api_port}"

  local ldapsm_shim_host
  ldapsm_shim_host="$(resolve_dir "${SCRIPT_DIR}")/controller-ldapsm-shim.sh"
  chmod +x "${ldapsm_shim_host}" || true
  docker_socket_path="$(resolve_docker_socket_path)"
  docker_socket_gid="$(resolve_docker_socket_gid)"
  # Re-export so docker compose's ${DOCKER_SOCKET_GID:-...} substitution uses
  # the probed-from-container value instead of any stale value the parent
  # Makefile may have exported from a host-side `stat` call (which does not
  # always match the GID containers actually see in user-namespaced setups).
  export DOCKER_SOCKET_PATH="${docker_socket_path}"
  export DOCKER_SOCKET_GID="${docker_socket_gid}"

  local stream_base_url="http://127.0.0.1:${api_port}"
  local cors_allow_origins="http://127.0.0.1:${web_port},http://localhost:${web_port}"
  # Per-run cookie-secret for the OAuth2-Proxy test service (req 020).
  # Always generated even in header-mock mode so the compose interpolation
  # never fails — the proxy only consumes it when oidc-mock auth-mode runs.
  local oauth2_proxy_cookie_secret
  oauth2_proxy_cookie_secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n=' | head -c 32)"
  # In oidc-mock mode the Playwright container resolves through compose
  # DNS (`oauth2-proxy:4180`); flip the proxy's advertised callback URL
  # to match so the IdP redirect target is reachable from the in-network
  # browser. Default keeps the host-port URL for manual host-browser
  # tests (Variante 2 in the OIDC walkthrough).
  local oauth2_proxy_redirect_url
  local auth_proxy_enabled
  local auth_proxy_user_header
  local auth_proxy_email_header
  if [[ "${INFINITO_E2E_AUTH_MODE:-header-mock}" == "oidc-mock" ]]; then
    oauth2_proxy_redirect_url="http://oauth2-proxy:4180/oauth2/callback"
    # OIDC mode = api MUST trust the OAuth2-Proxy headers; otherwise the
    # workspace API silently treats every request as anonymous and the
    # OIDC login spec's `wsBody.authenticated` assertion fails after a
    # successful IdP round-trip.
    auth_proxy_enabled="true"
    # OAuth2-Proxy with --pass-user-headers=true forwards
    # `X-Forwarded-User` / `X-Forwarded-Email` to the upstream (NOT
    # `X-Auth-Request-*`, which only applies to auth-only / subrequest
    # mode). Match the api's expected headers to the proxy's actual
    # output; the legacy `X-Auth-Request-*` default is preserved for
    # the existing header-mock unit tests.
    auth_proxy_user_header="X-Forwarded-User"
    auth_proxy_email_header="X-Forwarded-Email"
  else
    oauth2_proxy_redirect_url="http://localhost:4180/oauth2/callback"
    auth_proxy_enabled="false"
    auth_proxy_user_header="X-Auth-Request-User"
    auth_proxy_email_header="X-Auth-Request-Email"
  fi
  if [[ "${INFINITO_E2E_PLAYWRIGHT_DOCKER:-0}" == "1" ]]; then
    # Playwright runs inside the docker network, so 127.0.0.1 inside the browser
    # container is the browser itself, not the host. Use relative URLs so SSE
    # goes through the web container's Next.js rewrite to api:8000.
    stream_base_url=""
    cors_allow_origins="${cors_allow_origins},http://web:${web_port}"
  fi

  cat "${ENV_SOURCE}" >"${target_file}"
  cat >>"${target_file}" <<EOF
STATE_HOST_PATH=$(resolve_dir "${STATE_DIR}")
STATE_HOST_UID=$(id -u)
STATE_HOST_GID=$(id -g)
DOCKER_SOCKET_PATH=${docker_socket_path}
DOCKER_SOCKET_GID=${docker_socket_gid}
JOB_RUNNER_REPO_DIR=/opt/src/infinito
JOB_RUNNER_WORKDIR=/workspace
JOB_RUNNER_DOCKER_ARGS=-v ${ldapsm_shim_host}:/usr/bin/ldapsm:ro -e DNS_IP=${INFINITO_E2E_TARGET_DNS_IP:-172.28.0.10}
JOB_RUNNER_SKIP_CLEANUP=false
JOB_RUNNER_SKIP_BUILD=false
JOB_RUNNER_ANSIBLE_ARGS=-e '{"TLS_ENABLED": true, "TLS_MODE": "self_signed"}' -e SYS_SVC_SSHD_PASSWORD_AUTHENTICATION=true -e '{"MAILU_IP4_PUBLIC": "{{ ansible_default_ipv4.address }}"}' -e TEST_E2E_PLAYWRIGHT_STAGE_BASE_DIR=/var/lib/test-e2e-playwright
INFINITO_ENFORCE_DIGEST_PINNING=${enforce_digest_pinning}
CORS_ALLOW_ORIGINS=${cors_allow_origins}
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_API_STREAM_BASE_URL=${stream_base_url}
INFINITO_NEXUS_IMAGE=${catalog_image}
JOB_RUNNER_IMAGE=${runner_image}
POSTGRES_IMAGE=${INFINITO_E2E_POSTGRES_IMAGE:-${CI_POSTGRES_IMAGE_DEFAULT}}
INFINITO_REPO_MOUNT_TYPE=volume
INFINITO_REPO_MOUNT_SOURCE=infinito_repo
JOB_RUNNER_REPO_HOST_PATH=
API_PORT=${api_port}
API_APP_PORT=${api_port}
WEB_PORT=${web_port}
API_PROXY_TARGET=${api_proxy_target}
TEST_REPO_MIRROR_HOST_PATH=${test_repo_mirror_host_path}
TEST_REPO_SEED_HOST_PATH=${test_repo_seed_host_path}
TEST_CACHE_REGISTRY_HOST_PATH=${test_cache_registry_host_path}
TEST_CACHE_PACKAGE_HOST_PATH=${test_cache_package_host_path}
INFINITO_CACHE_APT_PROXY=http://172.28.0.31:3142
INFINITO_CACHE_PIP_INDEX_URL=http://172.28.0.31:3141/root/pypi/+simple/
INFINITO_CACHE_NPM_REGISTRY=http://172.28.0.31:4873/
OAUTH2_PROXY_COOKIE_SECRET=${oauth2_proxy_cookie_secret}
OAUTH2_PROXY_REDIRECT_URL=${oauth2_proxy_redirect_url}
AUTH_PROXY_ENABLED=${auth_proxy_enabled}
AUTH_PROXY_USER_HEADER=${auth_proxy_user_header}
AUTH_PROXY_EMAIL_HEADER=${auth_proxy_email_header}
EOF
}

compose() {
  docker compose --env-file "${TMP_ENV_FILE}" -f "${REPO_ROOT}/docker-compose.yml" --profile test "$@"
}

capture_dashboard_e2e_diagnostics() {
  local diagnostic_image="${E2E_DIAGNOSTIC_IMAGE:-${CI_CATALOG_IMAGE_DEFAULT}}"

  echo "→ Capturing recent dashboard E2E job diagnostics"
  docker run --rm \
    -v "${STATE_DIR}:/state:ro" \
    "${diagnostic_image}" \
    sh -lc '
      set -eu
      if [ ! -d /state/jobs ]; then
        echo "  no /state/jobs directory"
        exit 0
      fi
      find /state/jobs -maxdepth 2 -name job.json -exec stat -c "%Y %n" {} + 2>/dev/null |
        sort -nr |
        head -5 |
        while read -r _ meta_path; do
          job_dir="${meta_path%/job.json}"
          job_id="${job_dir##*/}"
          echo
          echo "### job ${job_id}"
          cat "${meta_path}" || true
          echo
          if [ -f "${job_dir}/job.log" ]; then
            echo "--- tail job.log (${job_id}) ---"
            tail -200 "${job_dir}/job.log" || true
          else
            echo "  no job.log"
          fi
        done
    ' || true

  echo "→ Capturing target-container Docker state"
  compose exec -T ssh-password sh -lc 'docker ps -a || true' || true

  echo "→ Capturing target-container Docker image inventory (what the cache loaded)"
  compose exec -T ssh-password sh -lc 'docker images --digests || true' || true

  echo "→ Capturing dashboard compose definition rendered into the target"
  # shellcheck disable=SC2016
  compose exec -T ssh-password sh -lc '
    set +e
    instance_dir=/opt/compose/dashboard
    if [ ! -d "${instance_dir}" ]; then
      echo "  no rendered compose dir at ${instance_dir}"
      exit 0
    fi
    echo "--- ${instance_dir} contents ---"
    ls -la "${instance_dir}" || true
    for f in compose.yml compose.override.yml .env/env; do
      if [ -f "${instance_dir}/${f}" ]; then
        echo "--- ${instance_dir}/${f} ---"
        cat "${instance_dir}/${f}" || true
      fi
    done
    echo "--- docker compose config --images (resolved image refs the role would pull) ---"
    cd "${instance_dir}"
    project_name=dashboard
    cmd="docker compose -p ${project_name}"
    [ -f compose.yml ] && cmd="${cmd} -f compose.yml"
    [ -f compose.override.yml ] && cmd="${cmd} -f compose.override.yml"
    [ -f .env/env ] && cmd="${cmd} --env-file .env/env"
    eval "${cmd} config --images" || true
    echo "--- live docker compose pull dry-run (surfaces the actual stderr the Ansible retry hides) ---"
    eval "timeout 60 ${cmd} pull 2>&1 | tail -100" || true
  ' || true

  echo "→ Capturing target-container inner Docker daemon journal (last 200 lines)"
  compose exec -T ssh-password sh -lc 'journalctl --no-pager -u docker.service -n 200 || true' || true
}

cleanup() {
  local exit_code="$?"
  if [[ "${STACK_STARTED:-0}" == "1" ]]; then
    if [[ "${exit_code}" -ne 0 ]]; then
      echo "→ Capturing recent compose logs after failure"
      compose logs --tail=200 || true
      capture_dashboard_e2e_diagnostics
    fi
    if [[ "${INFINITO_E2E_KEEP_STACK:-0}" == "1" && "${exit_code}" -ne 0 ]]; then
      echo "→ INFINITO_E2E_KEEP_STACK=1: leaving stack up for inspection"
      echo "  env file: ${TMP_ENV_FILE}"
      exit "${exit_code}"
    fi
    echo "→ Tearing down dashboard E2E stack"
    compose down -v --remove-orphans || true
    INFINITO_E2E_STATE_DIR="${STATE_DIR}" bash "${SCRIPT_DIR}/wipe-state.sh"
  fi
  rm -f "${TMP_ENV_FILE}"
  exit "${exit_code}"
}

E2E_API_PORT="${INFINITO_E2E_API_PORT:-8000}"
E2E_WEB_PORT="${INFINITO_E2E_WEB_PORT:-3000}"
TMP_ENV_FILE="$(mktemp "/tmp/infinito-dashboard-e2e-${MODE}.XXXX.env")"
STACK_STARTED=0
trap cleanup EXIT

render_env_file "${TMP_ENV_FILE}"

echo "→ Resetting any existing dashboard E2E stack"
compose down -v --remove-orphans || true

# Two-phase start (req 018): cache services FIRST so the consumer image
# builds (api/web/runner-manager/init-*) can reach cache-package at its
# static IP 172.28.0.31 via host network. compose's single-shot
# `up --build` builds all images in parallel BEFORE any container
# starts, which means without this split the consumer builds would
# attempt 172.28.0.31 while cache-package itself is still queued for
# startup → connect timeout → build fails (verified locally).
echo "→ Starting dashboard E2E stack (phase A: caches)"
compose up -d --build --wait cache-registry cache-package
STACK_STARTED=1

echo "→ Starting dashboard E2E stack (phase B: rest)"
compose up -d --build --wait

cd "${APPS_WEB_DIR}"
export INFINITO_E2E_COMPOSE_ENV_FILE="${TMP_ENV_FILE}"
export INFINITO_E2E_COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
export INFINITO_E2E_MODE="${MODE}"

# Wipe the test-results directory before the run so a previous container-mode
# run that wrote files as a different uid does not block this run with EACCES.
docker run --rm -v "${APPS_WEB_DIR}/test-results:/work" alpine:latest \
  sh -c 'find /work -mindepth 1 -delete 2>/dev/null || true' >/dev/null 2>&1 || true

if [[ "${INFINITO_E2E_PLAYWRIGHT_DOCKER:-0}" == "1" ]]; then
  playwright_base="${INFINITO_E2E_PLAYWRIGHT_BASE_IMAGE:-mcr.microsoft.com/playwright:v1.55.1-jammy}"
  playwright_image="${INFINITO_E2E_PLAYWRIGHT_IMAGE:-infinito-deployer-playwright:latest}"

  if ! docker image inspect "${playwright_image}" >/dev/null 2>&1; then
    # Forward the cache-package apt endpoint so the Playwright image's
    # apt-get install (docker.io + docker-compose-v2) goes through
    # cache-package's apt-cacher-ng on warm runs (req 018). Empty when
    # the cache is not in use; the Dockerfile falls back to public
    # mirrors in that case.
    INFINITO_CACHE_APT_PROXY="http://172.28.0.31:3142" \
      make -C "${REPO_ROOT}" playwright-build \
      PLAYWRIGHT_BASE="${playwright_base}" \
      PLAYWRIGHT_IMAGE="${playwright_image}"
  fi

  network_name="$(docker inspect \
    -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' \
    infinito-deployer-web 2>/dev/null | awk 'NF{print; exit}' || true)"
  network_name="${network_name:-infinito-deployer}"

  # Auth-mode switch (req 020). Default `header-mock` runs the existing
  # dashboard E2E spec against the web upstream directly; `oidc-mock`
  # runs the OIDC login spec against the oauth2-proxy front-door.
  # Top-level (non-function) shell scope — no `local`.
  if [[ "${INFINITO_E2E_AUTH_MODE:-header-mock}" == "oidc-mock" ]]; then
    playwright_config="playwright.oidc.config.ts"
    playwright_target="tests/oidc_login.spec.ts"
    playwright_base_url="http://oauth2-proxy:4180"
    echo "→ Running OIDC login E2E inside docker (network=${network_name}, image=${playwright_image}, mode=oidc-mock)"
  else
    playwright_config="playwright.dashboard.config.ts"
    playwright_target="tests/dashboard_deploy_real.spec.ts"
    playwright_base_url="http://web:${E2E_WEB_PORT}"
    echo "→ Running real dashboard deploy E2E inside docker (network=${network_name}, image=${playwright_image})"
  fi

  # The dashboard reachability assertion in the dashboard spec calls
  # 'docker compose exec ssh-password curl ...' to probe the deployed app
  # inside its target container. The custom image bundles docker.io +
  # docker-compose-v2; mount the docker socket + generated compose env file
  # so 'docker compose exec' works from inside the playwright container.
  # The OIDC spec doesn't need the docker socket but the same mount is
  # harmless.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --group-add "${DOCKER_SOCKET_GID}" \
    --network "${network_name}" \
    -v "${APPS_WEB_DIR}:/work" \
    -v "${REPO_ROOT}:${REPO_ROOT}:ro" \
    -v "${DOCKER_SOCKET_PATH}:/var/run/docker.sock" \
    -v "${TMP_ENV_FILE}:${TMP_ENV_FILE}:ro" \
    -w /work \
    -e PLAYWRIGHT_BASE_URL="${playwright_base_url}" \
    -e INFINITO_E2E_MODE="${MODE}" \
    -e INFINITO_E2E_AUTH_MODE="${INFINITO_E2E_AUTH_MODE:-header-mock}" \
    -e INFINITO_E2E_COMPOSE_ENV_FILE="${TMP_ENV_FILE}" \
    -e INFINITO_E2E_COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml" \
    -e HOME=/tmp \
    "${playwright_image}" \
    npx playwright test -c "${playwright_config}" "${playwright_target}"
else
  export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:${E2E_WEB_PORT}}"

  if [[ ! -d "${APPS_WEB_DIR}/node_modules" ]]; then
    echo "→ Installing frontend dependencies for Playwright"
    npm ci
  fi

  if ! npx playwright --version >/dev/null 2>&1; then
    echo "✖ Playwright CLI is unavailable after dependency install." >&2
    exit 1
  fi

  echo "→ Ensuring Chromium is installed for Playwright"
  npx playwright install chromium

  echo "→ Running real dashboard deploy E2E"
  npx playwright test -c playwright.dashboard.config.ts tests/dashboard_deploy_real.spec.ts
fi
