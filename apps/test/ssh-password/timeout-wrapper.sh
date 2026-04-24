#!/bin/bash
set -euo pipefail

real_timeout="/usr/bin/timeout"

if [[ $# -ge 6 ]] \
  && [[ "$1" == "--signal=KILL" ]] \
  && [[ "$2" =~ ^[0-9]+s$ ]] \
  && [[ "$3" == "/root/.venvs/pkgmgr/bin/pkgmgr" ]] \
  && [[ "$4" == "update" ]] \
  && [[ "$5" == "pkgmgr" ]] \
  && [[ "$6" == "--clone-mode" ]] \
  && [[ "${7:-}" == "shallow" ]]; then
  echo "[e2e-timeout-wrapper] Skipping pkgmgr self-update on the ssh-password test target."
  exit 0
fi

exec "${real_timeout}" "$@"
