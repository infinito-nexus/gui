#!/usr/bin/env bash
# Dump compose state + per-container `id` / `stat /var/run/docker.sock` /
# `logs --tail` for the test-profile services. Runs from the workflow's
# `Dump container logs on failure` step so debugging the live stack is
# possible from the CI run page without re-deploying.
#
# Falls back from `.env` to `env.example` to mirror the Makefile's
# EFFECTIVE_ENV_FILE rule — without it `docker compose` aborts on
# `strconv.Atoi: parsing ''` interpolation errors and prints zero logs.
#
# Usage:
#   scripts/ci/dump-container-logs.sh [<service> ...]
#
# With no args, dumps the canonical test-profile services. With explicit
# service args, dumps only those.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"

env_file="${REPO_ROOT}/.env"
if [[ ! -f "${env_file}" ]]; then
  env_file="${REPO_ROOT}/env.example"
fi

services=("$@")
if [[ ${#services[@]} -eq 0 ]]; then
  services=(catalog db api runner-manager web ssh-password ssh-key test-arch)
fi

compose=(docker compose --env-file "${env_file}" -f "${COMPOSE_FILE}" --profile test)

echo "::group::host docker socket"
stat -c '%U:%G %u:%g %a %n' /var/run/docker.sock 2>&1 || true
id 2>&1 || true
echo "::endgroup::"

echo "::group::docker compose ps"
"${compose[@]}" ps -a 2>&1 || true
echo "::endgroup::"

for svc in "${services[@]}"; do
  echo "::group::container id (${svc})"
  "${compose[@]}" exec -T "${svc}" sh -c \
    'id; stat -c "%U:%G %u:%g %a %n" /var/run/docker.sock 2>/dev/null || true' \
    2>&1 || true
  echo "::endgroup::"

  echo "::group::docker compose logs ${svc}"
  "${compose[@]}" logs --no-color --tail=200 "${svc}" 2>&1 || true
  echo "::endgroup::"
done
