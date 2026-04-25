#!/usr/bin/env bash
# Test-only: deliberately corrupt one workspace dir back to the
# pre-hardening root:root mode 0755 state so we can verify that
# init-state-perms (or scripts/workspace-perms/repair.sh) self-heals
# it on the next stack start.
#
# Idempotent.
#
# Usage: scripts/workspace-perms/break.sh <workspace-id>
set -euo pipefail

if [[ $# -lt 1 || -z "${1}" ]]; then
  echo "✖ workspace id is required" >&2
  echo "  usage: scripts/workspace-perms/break.sh <workspace-id>" >&2
  exit 2
fi

workspace_id="${1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STATE_DIR="${STATE_DIR:-${REPO_ROOT}/state}"

docker run --rm -v "${STATE_DIR}:/state" alpine:latest sh -lc "
  target=/state/workspaces/${workspace_id}
  if [ ! -d \"\$target\" ]; then
    echo '✖ workspace '\$target' does not exist'
    exit 1
  fi
  chown -R 0:0 \"\$target\"
  find \"\$target\" -type d -exec chmod 0755 {} +
  echo \"✔ corrupted \$target back to root:root 0755 for migration test\"
  stat -c '%u:%g %a %n' \"\$target\"
"
