#!/usr/bin/env bash
set -euo pipefail

last_arg="${!#:-}"
last_arg="${last_arg#\[}"
last_arg="${last_arg%\]}"

if [[ "${last_arg}" == "github.com" ]]; then
  printf '%s\n' \
    'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII3+7UnC83CxweO0Gr8ptLLxSgSQ4W0NoJhlCz5ZzVwN'
  exit 0
fi

exec /usr/bin/ssh-keyscan "$@"
