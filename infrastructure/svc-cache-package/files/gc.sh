#!/usr/bin/env bash
# cache-package GC sidecar.
#
# Spec 018 lists per-process caps (apt 4G / pip 2G / npm 2G) but notes
# the implementation may choose a different distribution. None of the
# three upstreams (apt-cacher-ng, devpi, verdaccio) ships a built-in
# hard size cap — the cleanest pragmatic enforcement is the same pattern
# used by cache-registry: when the combined on-disk footprint exceeds
# CACHE_PACKAGE_MAX_SIZE, drop the cached content of whichever subdir
# is largest. Re-fetch on next pull is acceptable because the e2e is
# not latency-sensitive at minute scale.
#
# Sequence per iteration:
#   1. Measure /state/cache-package total bytes.
#   2. If above CACHE_PACKAGE_MAX_SIZE bytes:
#        a. Identify largest subdir (apt, pip, npm).
#        b. Stop the s6 service that owns it (drains in-flight requests).
#        c. Wipe its on-disk content (entrypoint will recreate skeleton
#           on next service start).
#        d. Restart the service.
#      Sleep 30 min and re-check.
#   3. Else sleep 24 h.

set -euo pipefail

CACHE_DATA_DIR="${CACHE_DATA_DIR:-/state/cache-package}"
CACHE_PACKAGE_MAX_SIZE="${CACHE_PACKAGE_MAX_SIZE:-8g}"
S6_SERVICE_BASE="${S6_SERVICE_BASE:-/run/service}"

CHECK_INTERVAL_OVER="${CACHE_PACKAGE_GC_INTERVAL_OVER:-1800}"
CHECK_INTERVAL_OK="${CACHE_PACKAGE_GC_INTERVAL_OK:-86400}"

declare -A SUBDIR_SERVICE=(
  [apt]=apt-cacher-ng
  [pip]=devpi
  [npm]=verdaccio
)

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

dir_bytes() {
  local d="$1"
  if [[ -d "${d}" ]]; then
    du -sb "${d}" 2>/dev/null | awk '{print $1}'
  else
    echo "0"
  fi
}

biggest_subdir() {
  local best="" best_size=-1 sub size
  for sub in apt pip npm; do
    size="$(dir_bytes "${CACHE_DATA_DIR}/${sub}")"
    if [[ "${size}" -gt "${best_size}" ]]; then
      best="${sub}"
      best_size="${size}"
    fi
  done
  echo "${best}"
}

cycle_subdir() {
  local sub="$1"
  local svc="${SUBDIR_SERVICE[${sub}]}"
  local svc_dir="${S6_SERVICE_BASE}/${svc}"
  local data_dir="${CACHE_DATA_DIR}/${sub}"

  if [[ -d "${svc_dir}" ]] && command -v s6-svc >/dev/null 2>&1; then
    echo "  cycle-subdir(${sub}): stopping ${svc}"
    s6-svc -wD -T 30000 -d "${svc_dir}" || true
    echo "  cycle-subdir(${sub}): wiping ${data_dir}"
    rm -rf "${data_dir:?}"/* 2>/dev/null || true
    echo "  cycle-subdir(${sub}): starting ${svc}"
    s6-svc -wU -T 30000 -u "${svc_dir}" || true
  else
    echo "  cycle-subdir(${sub}): s6-svc unavailable, wiping in place"
    rm -rf "${data_dir:?}"/* 2>/dev/null || true
  fi
}

max_bytes="$(to_bytes "${CACHE_PACKAGE_MAX_SIZE}")"
if [[ "${max_bytes}" -le 0 ]]; then
  echo "cache-package-gc: invalid CACHE_PACKAGE_MAX_SIZE='${CACHE_PACKAGE_MAX_SIZE}', exiting"
  exit 1
fi
echo "cache-package-gc: cap=${CACHE_PACKAGE_MAX_SIZE} (${max_bytes} bytes), data=${CACHE_DATA_DIR}"

while true; do
  total="$(dir_bytes "${CACHE_DATA_DIR}")"
  if [[ "${total}" -gt "${max_bytes}" ]]; then
    sub="$(biggest_subdir)"
    echo "cache-package-gc: ${total} > ${max_bytes} bytes — pruning ${sub}"
    cycle_subdir "${sub}"
    sleep "${CHECK_INTERVAL_OVER}"
  else
    sleep "${CHECK_INTERVAL_OK}"
  fi
done
