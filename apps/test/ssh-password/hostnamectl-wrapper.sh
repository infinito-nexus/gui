#!/usr/bin/env bash
set -euo pipefail

REAL_HOSTNAMECTL="/usr/bin/hostnamectl"

find_set_hostname_value() {
  local expect_value=0
  local arg=""
  for arg in "$@"; do
    if ((expect_value)); then
      printf '%s\n' "${arg}"
      return 0
    fi
    if [[ "${arg}" == "set-hostname" ]]; then
      expect_value=1
    fi
  done
  return 1
}

if new_hostname="$(find_set_hostname_value "$@" 2>/dev/null)"; then
  printf '%s\n' "${new_hostname}" >/etc/hostname
  /usr/bin/hostname "${new_hostname}" 2>/dev/null || true
  exit 0
fi

exec "${REAL_HOSTNAMECTL}" "$@"
