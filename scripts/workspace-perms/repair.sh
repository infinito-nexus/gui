#!/usr/bin/env bash
# One-shot migration: re-own any workspace directory that is still
# root-owned (created before the api container was hardened to non-root
# user) so the api (uid 10001, gid 10900) can write atomic temp files
# into it again. Otherwise the inventory PUT endpoint loops with
# HTTP 500 "[Errno 13] Permission denied: .inventory.yml.<hash>.tmp".
#
# Idempotent: only touches dirs not already owned by 10001:10900.
#
# Usage: scripts/workspace-perms/repair.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STATE_DIR="${STATE_DIR:-${REPO_ROOT}/state}"

echo "→ Repairing root-owned workspaces under ${STATE_DIR}/workspaces"
docker run --rm -v "${STATE_DIR}:/state" alpine:latest sh -lc '
  set -e
  root="/state/workspaces"
  if [ ! -d "$root" ]; then
    echo "✖ no workspaces dir at $root"
    exit 0
  fi
  fixed=0
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    owner="$(stat -c "%u:%g" "$d")"
    if [ "$owner" != "10001:10900" ]; then
      echo "  → fixing $d (was $owner)"
      chown -R 10001:10900 "$d"
      find "$d" -type d -exec chmod 2770 {} +
      find "$d" -type f ! -perm -u+w -exec chmod g+w {} + 2>/dev/null || true
      fixed=$((fixed + 1))
    fi
  done
  echo "✔ repaired $fixed workspaces"
'
