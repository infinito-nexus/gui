#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${1:-${ENV_FILE:-${REPO_ROOT}/.env}}"

resolve_from_env() {
  local key="$1"
  local value="${!key:-}"
  if [[ -n "${value}" ]]; then
    printf '%s\n' "${value}"
    return 0
  fi
  if [[ -f "${ENV_FILE}" ]]; then
    awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, "", $0); value=$0 } END { print value }' "${ENV_FILE}"
    return 0
  fi
  printf '\n'
}

runner_image="$(resolve_from_env JOB_RUNNER_IMAGE)"
catalog_image="$(resolve_from_env INFINITO_NEXUS_IMAGE)"
if [[ -z "${runner_image}" ]]; then
  runner_image="${catalog_image}"
fi

if [[ -z "${runner_image}" ]]; then
  exit 0
fi

# Registry-shaped images (digest-pinned `repo@sha256:...` or repo paths
# containing `/`) are pullable. Pre-pull them when missing so the first
# `docker run` from runner-manager doesn't trigger a >5s implicit pull
# that races runner_manager_service_sweep._wait_for_container_running()
# (CI ran 24943727751 hit "runner container ... did not become running
# in time" because the digest-pinned arch image had not been pulled yet).
case "${runner_image}" in
  *@sha256:* | */*)
    if docker image inspect "${runner_image}" >/dev/null 2>&1; then
      exit 0
    fi
    echo "→ Pulling registry runner image (${runner_image})"
    docker pull "${runner_image}"
    exit 0
    ;;
esac

case "${runner_image}" in
  infinito-arch | infinito-arch:latest)
    echo "→ Building local runner image (${runner_image}) from apps/test/arch-ssh"
    docker build -t "${runner_image}" "${REPO_ROOT}/apps/test/arch-ssh"
    exit 0
    ;;
esac

if docker image inspect "${runner_image}" >/dev/null 2>&1; then
  exit 0
fi

echo "✖ Missing local runner image ${runner_image}" >&2
echo "  Set JOB_RUNNER_IMAGE to a digest-pinned registry image or build/tag the local image before deploying." >&2
exit 1
