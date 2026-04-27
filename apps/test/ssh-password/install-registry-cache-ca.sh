#!/usr/bin/env bash
# Pull the registry-cache MITM CA certificate from the bind-mounted volume
# and install it into ssh-password's system trust store before dockerd
# starts. This is required because the rpardini/docker-registry-proxy at
# `infinito-deployer-registry-cache:3128` performs SSL bumping on outbound
# registry traffic — clients MUST trust its self-signed CA or every HTTPS
# pull fails with x509 errors.
#
# The script is idempotent and safe to run multiple times. It tolerates a
# missing CA (e.g. registry-cache not yet available, or test profile
# disabled) by exiting 0 — dockerd then starts without proxy and falls back
# to direct registry pulls.
set -eu

CA_SRC="/opt/e2e/registry-cache-ca/ca.crt"
# ssh-password is Arch; ca-certificates uses p11-kit's trust store.
# Anchors live in /etc/ca-certificates/trust-source/anchors/ and are
# materialised into the trust bundle by `update-ca-trust`.
CA_DST="/etc/ca-certificates/trust-source/anchors/infinito-registry-cache.crt"

if [ ! -s "${CA_SRC}" ]; then
  echo "[install-registry-cache-ca] no CA at ${CA_SRC}; skipping" >&2
  exit 0
fi

if cmp -s "${CA_SRC}" "${CA_DST}" 2>/dev/null; then
  exit 0
fi

install -d -m 0755 /etc/ca-certificates/trust-source/anchors
install -m 0644 "${CA_SRC}" "${CA_DST}"
update-ca-trust extract >/dev/null 2>&1 || true
echo "[install-registry-cache-ca] installed ${CA_DST}" >&2
