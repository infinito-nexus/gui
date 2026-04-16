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

render_env_file() {
  local target_file="${1}"
  local catalog_image
  local runner_image

  if [[ "${MODE}" == "local" ]]; then
    local src_dir distro image_tag
    src_dir="$(require_src_dir)"
    distro="${INFINITO_E2E_LOCAL_DISTRO:-debian}"
    image_tag="${INFINITO_E2E_LOCAL_IMAGE:-$(resolve_local_image_tag "${src_dir}" "${distro}")}"
    build_local_image "${src_dir}" "${distro}" "${image_tag}"
    catalog_image="${image_tag}"
    runner_image="${image_tag}"
  else
    catalog_image="${INFINITO_E2E_CATALOG_IMAGE:-ghcr.io/infinito-nexus/core/debian:latest}"
    runner_image="${INFINITO_E2E_JOB_RUNNER_IMAGE:-ghcr.io/infinito-nexus/core/arch:latest}"
    echo "→ Pulling Infinito.Nexus catalog image (${catalog_image})"
    docker pull "${catalog_image}"
    echo "→ Pulling Infinito.Nexus runner image (${runner_image})"
    docker pull "${runner_image}"
  fi

  local api_port="${E2E_API_PORT}"
  local web_port="${E2E_WEB_PORT}"
  local api_proxy_target="http://api:${api_port}"

  local ldapsm_shim_host
  ldapsm_shim_host="$(resolve_dir "${SCRIPT_DIR}")/controller-ldapsm-shim.sh"
  chmod +x "${ldapsm_shim_host}" || true

  cat "${ENV_SOURCE}" > "${target_file}"
  cat >> "${target_file}" <<EOF
STATE_HOST_PATH=$(resolve_dir "${STATE_DIR}")
JOB_RUNNER_REPO_DIR=/opt/src/infinito
JOB_RUNNER_WORKDIR=/workspace
JOB_RUNNER_DOCKER_ARGS=-v ${ldapsm_shim_host}:/usr/bin/ldapsm:ro -e DNS_IP=${INFINITO_E2E_TARGET_DNS_IP:-172.28.0.10}
JOB_RUNNER_SKIP_CLEANUP=false
JOB_RUNNER_SKIP_BUILD=false
JOB_RUNNER_ANSIBLE_ARGS=-e '{"TLS_ENABLED": true, "TLS_MODE": "self_signed"}' -e SYS_SVC_SSHD_PASSWORD_AUTHENTICATION=true -e MASK_CREDENTIALS_IN_LOGS=false -e '{"MAILU_IP4_PUBLIC": "{{ ansible_default_ipv4.address }}"}' -e TEST_E2E_PLAYWRIGHT_STAGE_BASE_DIR=/var/lib/test-e2e-playwright
CORS_ALLOW_ORIGINS=http://127.0.0.1:${web_port},http://localhost:${web_port}
INFINITO_NEXUS_IMAGE=${catalog_image}
JOB_RUNNER_IMAGE=${runner_image}
INFINITO_REPO_MOUNT_TYPE=volume
INFINITO_REPO_MOUNT_SOURCE=infinito_repo
JOB_RUNNER_REPO_HOST_PATH=
API_PORT=${api_port}
API_APP_PORT=${api_port}
WEB_PORT=${web_port}
API_PROXY_TARGET=${api_proxy_target}
EOF
}

compose() {
  docker compose --env-file "${TMP_ENV_FILE}" -f "${REPO_ROOT}/docker-compose.yml" --profile test "$@"
}

cleanup() {
  local exit_code="$?"
  if [[ "${STACK_STARTED:-0}" == "1" ]]; then
    if [[ "${exit_code}" -ne 0 ]]; then
      echo "→ Capturing recent compose logs after failure"
      compose logs --tail=200 || true
    fi
    if [[ "${INFINITO_E2E_KEEP_STACK:-0}" == "1" && "${exit_code}" -ne 0 ]]; then
      echo "→ INFINITO_E2E_KEEP_STACK=1: leaving stack up for inspection"
      echo "  env file: ${TMP_ENV_FILE}"
      exit "${exit_code}"
    fi
    echo "→ Tearing down dashboard E2E stack"
    compose down -v --remove-orphans || true
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

echo "→ Starting dashboard E2E stack"
compose up -d --build --wait
STACK_STARTED=1

cd "${APPS_WEB_DIR}"
export INFINITO_E2E_COMPOSE_ENV_FILE="${TMP_ENV_FILE}"
export INFINITO_E2E_COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
export INFINITO_E2E_MODE="${MODE}"
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
npx playwright test -c playwright.dashboard.config.ts
