#!/usr/bin/env bash
set -euo pipefail

REAL_DOCKER="${INFINITO_E2E_REAL_DOCKER:-/usr/bin/docker.actual}"
CACHE_DIR="${INFINITO_E2E_IMAGE_CACHE_DIR:-/opt/e2e/image-cache}"
MANIFEST_PATH="${INFINITO_E2E_IMAGE_MANIFEST:-${CACHE_DIR}/images.tsv}"

if [ ! -x "${REAL_DOCKER}" ] && [ -x /usr/bin/docker.real.bin ]; then
  REAL_DOCKER="/usr/bin/docker.real.bin"
fi

# Optional hermetic E2E optimization:
# Prefer locally mounted image archives when they already exist so repeat test
# runs do not depend on live registry round-trips. This wrapper is not the
# root-cause fix for DNS, routing, TLS, or daemon connectivity failures.

load_cached_image() {
  local image_ref="$1"
  local manifest_image=""
  local manifest_archive=""
  local manifest_loaded=""

  [ -s "${MANIFEST_PATH}" ] || return 1

  while IFS=$'\t' read -r manifest_image manifest_archive manifest_loaded; do
    [ -n "${manifest_image}" ] || continue
    if [ "${manifest_image}" = "${image_ref}" ]; then
      break
    fi
    manifest_archive=""
    manifest_loaded=""
  done <"${MANIFEST_PATH}"

  [ -n "${manifest_archive}" ] || return 1
  [ -s "${CACHE_DIR}/${manifest_archive}" ] || return 1
  [ -n "${manifest_loaded}" ] || manifest_loaded="${manifest_image}"

  "${REAL_DOCKER}" load -i "${CACHE_DIR}/${manifest_archive}" >/dev/null
  if ! "${REAL_DOCKER}" image inspect "${image_ref}" >/dev/null 2>&1; then
    if [ "${manifest_loaded}" != "${image_ref}" ] && "${REAL_DOCKER}" image inspect "${manifest_loaded}" >/dev/null 2>&1; then
      # `docker tag` rejects targets that contain `@sha256:...` (digest refs
      # are not tags). When the manifest_image is a digest reference (e.g.
      # `python:3.12-slim@sha256:...`) the loaded image is already content-
      # addressable by that digest after `docker load`; skip the retag and
      # rely on the friendly tag already attached to the load.
      case "${image_ref}" in
        *@sha256:*)
          :
          ;;
        *)
          "${REAL_DOCKER}" tag "${manifest_loaded}" "${image_ref}" >/dev/null
          ;;
      esac
    fi
  fi
  "${REAL_DOCKER}" image inspect "${image_ref}" >/dev/null 2>&1
}

load_all_cached_images() {
  local manifest_image=""
  local manifest_archive=""
  local manifest_loaded=""

  [ -s "${MANIFEST_PATH}" ] || return 0

  while IFS=$'\t' read -r manifest_image manifest_archive manifest_loaded; do
    [ -n "${manifest_image}" ] || continue
    [ -n "${manifest_loaded}" ] || manifest_loaded="${manifest_image}"
    if "${REAL_DOCKER}" image inspect "${manifest_image}" >/dev/null 2>&1; then
      continue
    fi
    [ -s "${CACHE_DIR}/${manifest_archive}" ] || continue
    "${REAL_DOCKER}" load -i "${CACHE_DIR}/${manifest_archive}" >/dev/null
    if [ "${manifest_loaded}" != "${manifest_image}" ] && "${REAL_DOCKER}" image inspect "${manifest_loaded}" >/dev/null 2>&1; then
      # See load_cached_image: skip retag when the target is a digest ref.
      case "${manifest_image}" in
        *@sha256:*)
          :
          ;;
        *)
          "${REAL_DOCKER}" tag "${manifest_loaded}" "${manifest_image}" >/dev/null
          ;;
      esac
    fi
  done <"${MANIFEST_PATH}"
}

compose_exempt_images() {
  local compose_prefix=("$@")
  local compose_config=""

  compose_config="$("${REAL_DOCKER}" compose "${compose_prefix[@]}" config 2>/dev/null)" || return 0

  awk '
    /^services:/ { in_services=1; next }
    in_services && /^[^ ]/ { in_services=0 }
    !in_services { next }
    /^  [^[:space:]][^:]*:$/ {
      service=$1
      sub(/:$/, "", service)
      image[service]=""
      has_build[service]=0
      pull_never[service]=0
      next
    }
    service != "" && /^    image:/ {
      image_line=$0
      sub(/^    image:[[:space:]]*/, "", image_line)
      gsub(/^"|"$/, "", image_line)
      image[service]=image_line
      next
    }
    service != "" && /^    build:/ {
      has_build[service]=1
      next
    }
    service != "" && /^    pull_policy: "?never"?$/ {
      pull_never[service]=1
      next
    }
    END {
      for (service in image) {
        if ((has_build[service] || pull_never[service]) && image[service] != "") {
          print image[service]
        }
      }
    }
  ' <<<"${compose_config}"
}

image_is_in_list() {
  local image_ref="$1"
  shift
  local candidate=""
  for candidate in "$@"; do
    if [ "${candidate}" = "${image_ref}" ]; then
      return 0
    fi
  done
  return 1
}

compose_subcommand_index() {
  local -n compose_args_ref=$1
  local index=0

  while [ "${index}" -lt "${#compose_args_ref[@]}" ]; do
    case "${compose_args_ref[$index]}" in
      -f | --file | -p | --project-name | --project-directory | --env-file | --profile | --ansi | --progress | --parallel)
        index=$((index + 2))
        ;;
      --file=* | --project-name=* | --project-directory=* | --env-file=* | --profile=* | --ansi=* | --progress=* | --parallel=*)
        index=$((index + 1))
        ;;
      --all-resources | --compatibility | --dry-run)
        index=$((index + 1))
        ;;
      -*)
        index=$((index + 1))
        ;;
      *)
        break
        ;;
    esac
  done

  printf '%s\n' "${index}"
}

if [ "${1:-}" = "pull" ] && [ "$#" -ge 2 ]; then
  all_images_local=1
  saw_image_ref=0

  for image_ref in "${@:2}"; do
    case "${image_ref}" in
      -*)
        continue
        ;;
    esac

    saw_image_ref=1
    if ! "${REAL_DOCKER}" image inspect "${image_ref}" >/dev/null 2>&1 && ! load_cached_image "${image_ref}"; then
      all_images_local=0
      break
    fi
  done

  if [ "${saw_image_ref}" = "1" ] && [ "${all_images_local}" = "1" ]; then
    echo "[infinito-e2e] using optional hermetic image cache instead of docker pull" >&2
    exit 0
  fi
fi

if [ "${1:-}" = "compose" ]; then
  shift
  compose_args=("$@")
  subcommand_index="$(compose_subcommand_index compose_args)"
  compose_prefix=("${compose_args[@]:0:${subcommand_index}}")
  exempt_images=()
  while IFS= read -r exempt_image; do
    [ -n "${exempt_image}" ] || continue
    exempt_images+=("${exempt_image}")
  done < <(compose_exempt_images "${compose_prefix[@]}")

  if [ "${subcommand_index}" -lt "${#compose_args[@]}" ] && [ "${compose_args[$subcommand_index]}" = "pull" ]; then
    if compose_images="$("${REAL_DOCKER}" compose "${compose_prefix[@]}" config --images 2>/dev/null)"; then
      all_images_local=1
      while IFS= read -r image_ref; do
        [ -n "${image_ref}" ] || continue
        if image_is_in_list "${image_ref}" "${exempt_images[@]}"; then
          continue
        fi
        if ! "${REAL_DOCKER}" image inspect "${image_ref}" >/dev/null 2>&1 && ! load_cached_image "${image_ref}"; then
          all_images_local=0
          break
        fi
      done <<<"${compose_images}"

      if [ "${all_images_local}" = "1" ]; then
        echo "[infinito-e2e] using optional hermetic image cache instead of docker compose pull" >&2
        exit 0
      fi
    fi
  fi

  if [ "${subcommand_index}" -lt "${#compose_args[@]}" ] && [ "${compose_args[$subcommand_index]}" = "build" ] && [ "${#exempt_images[@]}" -gt 0 ]; then
    load_all_cached_images
    filtered_compose_args=()
    for compose_arg in "${compose_args[@]}"; do
      if [ "${compose_arg}" = "--pull" ]; then
        continue
      fi
      filtered_compose_args+=("${compose_arg}")
    done
    echo "[infinito-e2e] preloading optional hermetic image cache and stripping --pull from docker compose build for local buildable services" >&2
    echo "[infinito-e2e] forcing DOCKER_BUILDKIT=0 for local compose builds so cached base images are resolved from the local image store first" >&2
    exec env DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 "${REAL_DOCKER}" compose "${filtered_compose_args[@]}"
  fi

  exec "${REAL_DOCKER}" compose "${compose_args[@]}"
fi

exec "${REAL_DOCKER}" "$@"
