#!/usr/bin/env bash
# Reusable wrapper for clearing per-run dashboard e2e state from the
# bind-mounted state/ directory. The files are owned by api/runner-manager
# container uids (10001/10003), so the wipe runs in a privileged
# container and is best-effort: if any path is missing or already empty,
# we still succeed.
#
# Used in two places:
#   1. scripts/e2e/dashboard/run.sh `cleanup()` — auto-runs after every
#      test (success or failure, unless INFINITO_E2E_KEEP_STACK=1 leaves
#      the stack up for inspection).
#   2. `make e2e-dashboard-wipe-state` — manual recovery when a previous
#      run was killed mid-flight and left state behind.
#
# Only the dashboard-e2e-owned subtrees are touched. The registry-cache,
# repo-cache, perf artefacts, and runner state for unrelated tests are
# left alone:
#   wiped: jobs/, workspaces/, audit_logs/, secrets/
#   kept:  e2e/registry-cache, e2e/registry-cache-ca, e2e/repo-cache,
#          perf/, cache/, catalog/
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
STATE_DIR="${INFINITO_E2E_STATE_DIR:-${REPO_ROOT}/state}"

if [[ ! -d "${STATE_DIR}" ]]; then
  echo "→ wipe-state: ${STATE_DIR} does not exist; nothing to do"
  exit 0
fi

state_dir_abs="$(cd "${STATE_DIR}" && pwd -P)"
echo "→ wipe-state: clearing dashboard-e2e state under ${state_dir_abs}/{jobs,workspaces,audit_logs,secrets}"

docker run --rm \
  -v "${state_dir_abs}:/state" \
  alpine:latest \
  sh -c 'rm -rf /state/jobs/* /state/workspaces/* /state/audit_logs/* /state/secrets/* 2>/dev/null || true' \
  >/dev/null 2>&1 || true

echo "→ wipe-state: done"
