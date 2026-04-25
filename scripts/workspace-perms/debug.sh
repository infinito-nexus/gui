#!/usr/bin/env bash
# Compare workspace permissions inside the api container vs on the host
# filesystem. Helps diagnose "Inventory sync failed: HTTP 500" caused by
# pre-hardening root-owned workspace dirs the api (uid 10001) cannot write
# atomic temp files into.
#
# Usage: scripts/workspace-perms/debug.sh <workspace-id>
set -euo pipefail

if [[ $# -lt 1 || -z "${1}" ]]; then
  echo "✖ workspace id is required" >&2
  echo "  usage: scripts/workspace-perms/debug.sh <workspace-id>" >&2
  exit 2
fi

workspace_id="${1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKER_COMPOSE="${DOCKER_COMPOSE:-docker compose}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
ENV_FILE_DEFAULT="${REPO_ROOT}/.env"
ENV_FILE="${ENV_FILE:-${ENV_FILE_DEFAULT}}"
EFFECTIVE_ENV_FILE="${ENV_FILE}"
if [[ ! -f "${EFFECTIVE_ENV_FILE}" ]]; then
  EFFECTIVE_ENV_FILE="${REPO_ROOT}/env.example"
fi

echo "---container (api)---"
${DOCKER_COMPOSE} --env-file "${EFFECTIVE_ENV_FILE}" -f "${COMPOSE_FILE}" \
  exec -T api sh -c \
  "id; stat -c '%U:%G %a %n' /state/workspaces /state/workspaces/${workspace_id} 2>&1"

echo "---host---"
docker run --rm -v "${REPO_ROOT}/state:/state" alpine:latest sh -c \
  "stat -c '%u:%g %a %n' /state /state/workspaces /state/workspaces/${workspace_id} 2>&1"
