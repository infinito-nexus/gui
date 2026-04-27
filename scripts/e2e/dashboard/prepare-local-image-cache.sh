#!/usr/bin/env bash
set -euo pipefail

# Optional hermetic E2E optimization:
# Pre-save a small set of images into a local cache so the dedicated test target
# can load them without repeated registry round-trips. This is infrastructure
# optimization for reproducibility and iteration speed, not a network fix. If
# registry, DNS, TLS, routing, or Docker daemon connectivity breaks, that root
# cause still has to be diagnosed and fixed directly.

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <cache-dir>" >&2
  exit 1
fi

cache_dir="$1"
mkdir -p "${cache_dir}"
manifest_path="${cache_dir}/images.tsv"
tmp_manifest="${manifest_path}.tmp"
: >"${tmp_manifest}"

# Optional cache specs support the format:
#   <requested-ref>|<pinned-source-ref>|<loaded-ref>
# When a pinned source differs from the ref expected by the target compose or
# Dockerfile, the wrapper retags <loaded-ref> back to <requested-ref> after
# docker load. This keeps CI hermetic without mutating the live deployment
# definitions inside the mirrored Nexus repo.
image_specs=(
  "ghcr.io/kevinveenbirkenbach/csp-checker:stable"
  "ghcr.io/kevinveenbirkenbach/matomo-bootstrap:1.1.13"
  # MariaDB 12.2 currently breaks the generated root@127.0.0.1 healthcheck in
  # the real dashboard deploy. Pin the CI cache to a known-good 11.4 digest and
  # retag it to mariadb:latest inside the DinD target for reproducible builds.
  "mariadb:latest|mariadb:11.4@sha256:3b4dfcc32247eb07adbebec0793afae2a8eafa6860ec523ee56af4d3dec42f7f|mariadb:11.4"
  "matomo:latest"
  # Exact base images for locally buildable services in the E2E stack and the
  # dashboard target host. These are cached so local builds can stay hermetic
  # instead of resolving fresh registry metadata during the deployment flow.
  #
  # We MUST retag to the friendly un-pinned name (third column) before save:
  # `docker save <ref>@sha256:<digest>` produces an OCI archive with
  # `RepoTags: null`, so `docker load` adds the layers but assigns NO tag.
  # Dockerfiles like `FROM python:3.12-slim` then can't resolve the image
  # locally, fall back to a live registry pull, and time out in CI's
  # rate-limited DinD network (CI run 24968576122 spent 80 min retrying
  # `compose pull` because of exactly this gap).
  "python:3.12-slim@sha256:520153e2deb359602c9cffd84e491e3431d76e7bf95a3255c9ce9433b76ab99a|python:3.12-slim@sha256:520153e2deb359602c9cffd84e491e3431d76e7bf95a3255c9ce9433b76ab99a|python:3.12-slim"
  "node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293|node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293|node:20-alpine"
  # Base image for locally buildable services like web-svc-simpleicons.
  "node:latest"
  "openresty/openresty:alpine"
  # Dashboard primary image. Keep BOTH versions cached: 1.1.0 is what the
  # current web-app-dashboard role pulls (roles/web-app-dashboard/meta/services.yml
  # → services.dashboard.version=1.1.0), 1.0.0 stays for backwards-compat with
  # tests/branches that still pin the older version. Whichever the live role
  # references is short-circuited by docker-wrapper.sh from the cache, so the
  # ssh-password DinD never has to round-trip ghcr.io during compose pull.
  # Run 24961002019 timed out in CI because only 1.0.0 was cached, the role
  # used 1.1.0, and the live pull from inside DinD got stuck for 10 retries.
  "ghcr.io/kevinveenbirkenbach/port-ui:1.0.0"
  "ghcr.io/kevinveenbirkenbach/port-ui:1.1.0"
  "ghcr.io/kevinveenbirkenbach/universal-logout:latest"
)

parse_image_spec() {
  local spec="$1"
  local requested_ref=""
  local source_ref=""
  local loaded_ref=""

  IFS='|' read -r requested_ref source_ref loaded_ref <<<"${spec}"
  if [[ -z "${source_ref}" ]]; then
    source_ref="${requested_ref}"
  fi
  if [[ -z "${loaded_ref}" ]]; then
    loaded_ref="${requested_ref}"
  fi

  printf '%s\t%s\t%s\n' "${requested_ref}" "${source_ref}" "${loaded_ref}"
}

sanitize_image_ref() {
  local ref="$1"
  ref="${ref//\//_}"
  ref="${ref//:/_}"
  ref="${ref//@/_}"
  printf '%s.tar\n' "${ref}"
}

registry_probe_url() {
  local image_ref="$1"
  case "${image_ref}" in
    ghcr.io/*)
      printf '%s\n' "https://ghcr.io/v2/"
      ;;
    *)
      printf '%s\n' "https://registry-1.docker.io/v2/"
      ;;
  esac
}

registry_probe_host() {
  local image_ref="$1"
  case "${image_ref}" in
    ghcr.io/*)
      printf '%s\n' "ghcr.io"
      ;;
    *)
      printf '%s\n' "registry-1.docker.io"
      ;;
  esac
}

probe_registry() {
  local url="$1"
  local family="$2"
  local http_code=""
  http_code="$(
    curl "${family}" -sS -o /dev/null \
      --connect-timeout 5 \
      --max-time 10 \
      -w '%{http_code}' \
      "${url}" 2>/dev/null || true
  )"
  [[ "${http_code}" =~ ^[1-5][0-9][0-9]$ ]]
}

assert_registry_reachable() {
  local image_ref="$1"
  local probe_host=""
  local probe_url=""
  probe_host="$(registry_probe_host "${image_ref}")"
  probe_url="$(registry_probe_url "${image_ref}")"

  if probe_registry "${probe_url}" -4 || probe_registry "${probe_url}" -6; then
    return 0
  fi

  cat >&2 <<EOF
✖ Unable to reach the registry required for ${image_ref}
  Registry host: ${probe_host}
  Probe URL: ${probe_url}

This E2E helper keeps the local cache as a hermetic optimization, but it is not
the fix for broken host networking. A missing cache artifact plus an unreachable
registry means the underlying transport problem must be resolved first.

Suggested host diagnostics:
  curl -4 -I ${probe_url}
  curl -6 -I ${probe_url}
  ip route
  ip -6 route
  ss -tpn
  journalctl -u docker --since "15 min ago"
EOF
  exit 1
}

for image_spec in "${image_specs[@]}"; do
  IFS=$'\t' read -r image_ref source_ref loaded_ref <<<"$(parse_image_spec "${image_spec}")"

  archive_path="${cache_dir}/$(sanitize_image_ref "${source_ref}")"
  if [[ -s "${archive_path}" ]]; then
    printf '%s\t%s\t%s\n' "${image_ref}" "$(basename "${archive_path}")" "${loaded_ref}" >>"${tmp_manifest}"
    continue
  fi

  if ! docker image inspect "${source_ref}" >/dev/null 2>&1; then
    assert_registry_reachable "${source_ref}"
    echo "→ Pulling optional hermetic E2E cache source (${source_ref})" >&2
    docker pull "${source_ref}" >&2
  fi

  if ! docker image inspect "${loaded_ref}" >/dev/null 2>&1; then
    image_id="$(docker image inspect --format '{{.Id}}' "${source_ref}")"
    docker tag "${image_id}" "${loaded_ref}"
  fi

  tmp_path="${archive_path}.tmp"
  rm -f "${tmp_path}"
  echo "→ Saving optional hermetic E2E image cache (${image_ref} <= ${source_ref})" >&2
  docker save -o "${tmp_path}" "${loaded_ref}"
  mv "${tmp_path}" "${archive_path}"
  printf '%s\t%s\t%s\n' "${image_ref}" "$(basename "${archive_path}")" "${loaded_ref}" >>"${tmp_manifest}"
done

mv "${tmp_manifest}" "${manifest_path}"

printf '%s\n' "${cache_dir}"
