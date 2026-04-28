#!/usr/bin/env bash
# cache-registry GC sidecar.
#
# registry:2 in pull-through proxy mode does NOT track LRU or accept manual
# cleanup the same way a push registry does — `registry garbage-collect`
# only deletes blobs whose manifests are gone, which never happens in proxy
# mode (the proxy keeps every manifest it has ever served). The pragmatic
# pattern is therefore: when on-disk size exceeds the configured cap, drop
# the whole on-disk content and let the proxy re-fetch on next pull.
#
# Sequence:
#   1. Read the size cap from CACHE_REGISTRY_MAX_SIZE (default 16g) and
#      convert to bytes.
#   2. Loop forever:
#      a. Measure /var/lib/registry/docker (the only path that grows).
#      b. If above threshold:
#           - Stop the registry s6 service (drains in-flight requests).
#           - rm -rf /var/lib/registry/docker/*
#           - Start the registry s6 service.
#         Sleep 30 minutes and re-check (size will be close to zero, so
#         the next iteration drops to the daily cadence).
#      c. Else sleep 24 hours.
#
# Why not the readonly+garbage-collect dance from the upstream docs?
#   - That works for push registries with stale manifests; in proxy mode
#     there are no stale manifests, so garbage-collect deletes nothing.
#   - The readonly switch needs config.yml mutation + SIGHUP, which is
#     fragile under s6 supervision; an s6-svc cycle is atomic and clean.
#
# Trade-off: the next pull after a GC pays the upstream-fetch cost again.
# Acceptable because (a) GC only runs when over budget, (b) the e2e is
# not latency-sensitive at minute scale.

set -euo pipefail

REGISTRY_DATA_DIR="${REGISTRY_DATA_DIR:-/var/lib/registry/docker}"
CACHE_REGISTRY_MAX_SIZE="${CACHE_REGISTRY_MAX_SIZE:-16g}"
S6_SERVICE_DIR="${S6_SERVICE_DIR:-/run/service/registry}"

CHECK_INTERVAL_OVER="${CACHE_REGISTRY_GC_INTERVAL_OVER:-1800}" # 30 min
CHECK_INTERVAL_OK="${CACHE_REGISTRY_GC_INTERVAL_OK:-86400}"    # 24 h

to_bytes() {
  local input="$1"
  local num="${input%[gGmMkKbB]*}"
  local unit
  unit="$(printf '%s' "${input}" | tr '[:upper:]' '[:lower:]' | sed 's/[0-9.]//g')"
  case "${unit}" in
    g | gb | "") awk -v n="${num}" 'BEGIN{printf "%.0f", n*1024*1024*1024}' ;;
    m | mb) awk -v n="${num}" 'BEGIN{printf "%.0f", n*1024*1024}' ;;
    k | kb) awk -v n="${num}" 'BEGIN{printf "%.0f", n*1024}' ;;
    b) echo "${num%.*}" ;;
    *) echo "0" ;;
  esac
}

current_bytes() {
  if [[ -d "${REGISTRY_DATA_DIR}" ]]; then
    du -sb "${REGISTRY_DATA_DIR}" 2>/dev/null | awk '{print $1}'
  else
    echo "0"
  fi
}

cycle_registry() {
  if [[ -d "${S6_SERVICE_DIR}" ]] && command -v s6-svc >/dev/null 2>&1; then
    echo "  cycle-registry: stopping registry service"
    s6-svc -wD -T 30000 -d "${S6_SERVICE_DIR}" || true
    echo "  cycle-registry: wiping ${REGISTRY_DATA_DIR}"
    rm -rf "${REGISTRY_DATA_DIR:?}"/*
    echo "  cycle-registry: starting registry service"
    s6-svc -wU -T 30000 -u "${S6_SERVICE_DIR}" || true
  else
    # Fallback: no supervision available (e.g. running outside s6).
    echo "  cycle-registry: s6-svc unavailable, wiping in place"
    rm -rf "${REGISTRY_DATA_DIR:?}"/* 2>/dev/null || true
  fi
}

max_bytes="$(to_bytes "${CACHE_REGISTRY_MAX_SIZE}")"
if [[ "${max_bytes}" -le 0 ]]; then
  echo "cache-registry-gc: invalid CACHE_REGISTRY_MAX_SIZE='${CACHE_REGISTRY_MAX_SIZE}', exiting"
  exit 1
fi
echo "cache-registry-gc: cap=${CACHE_REGISTRY_MAX_SIZE} (${max_bytes} bytes), data=${REGISTRY_DATA_DIR}"

while true; do
  size="$(current_bytes)"
  if [[ "${size}" -gt "${max_bytes}" ]]; then
    echo "cache-registry-gc: ${size} > ${max_bytes} bytes — running GC"
    cycle_registry
    sleep "${CHECK_INTERVAL_OVER}"
  else
    sleep "${CHECK_INTERVAL_OK}"
  fi
done
