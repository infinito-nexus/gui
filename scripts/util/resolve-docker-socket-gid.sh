#!/usr/bin/env bash
# Resolve the GID that containers will see for the docker socket.
#
# `stat -c '%g' /var/run/docker.sock` on the host is wrong on
# user-namespaced / sandboxed docker setups: the host shell sees a
# translated gid (often 65534/nogroup) while a process inside any
# container reading the same bind-mounted socket sees the real
# in-container gid (e.g. 959). The runner-manager service uses
# `user: 10003:${DOCKER_SOCKET_GID}` for socket access, so the value
# we hand compose must match what the container actually sees.
#
# Strategy:
#   1. Probe via a throwaway alpine container that stats the
#      bind-mounted socket. This is the source of truth — what every
#      other container will see.
#   2. Fall back to the host-side `stat` only if the probe is
#      unavailable (e.g. docker daemon down, alpine pull blocked).
#
# Prints a single integer GID on stdout. Never empty (defaults to
# 10900, the infinito-manager group, which keeps compose interpolation
# valid even on an offline machine).
#
# Usage: scripts/util/resolve-docker-socket-gid.sh [<socket-path>]
set -euo pipefail

socket_path="${1:-${DOCKER_SOCKET_PATH:-/var/run/docker.sock}}"

if [[ ! -S "${socket_path}" ]]; then
  printf '10900\n'
  exit 0
fi

probe_gid="$(docker run --rm \
  -v "${socket_path}:/var/run/docker.sock" \
  alpine:latest \
  stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"

if [[ "${probe_gid}" =~ ^[0-9]+$ ]]; then
  printf '%s\n' "${probe_gid}"
  exit 0
fi

host_gid="$(stat -c '%g' "${socket_path}" 2>/dev/null || true)"
if [[ "${host_gid}" =~ ^[0-9]+$ ]]; then
  printf '%s\n' "${host_gid}"
  exit 0
fi

printf '10900\n'
