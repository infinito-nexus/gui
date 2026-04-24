#!/usr/bin/env bash
set -euo pipefail

# Optional hermetic E2E optimization:
# Mirror and seed a local repo snapshot so the dedicated test target can clone
# from mounted local sources during E2E runs. This is infrastructure
# optimization for reproducibility, not a substitute for fixing DNS, routing,
# proxy, TLS, or Git transport failures when they surface.

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --repo-root <repo-root> --state-dir <state-dir>
EOF
}

resolve_dir() {
  local target="${1}"
  (
    cd "${target}"
    pwd -P
  )
}

parse_repo_locator() {
  local locator="${1:-}"
  local provider=""
  local account=""
  local repo=""
  local path=""

  case "${locator}" in
    https://*/*/*)
      path="${locator#https://}"
      provider="${path%%/*}"
      path="${path#*/}"
      account="${path%%/*}"
      repo="${path#*/}"
      ;;
    ssh://git@*/*/*)
      path="${locator#ssh://git@}"
      provider="${path%%/*}"
      path="${path#*/}"
      account="${path%%/*}"
      repo="${path#*/}"
      ;;
    git@*:*/*)
      path="${locator#git@}"
      provider="${path%%:*}"
      path="${path#*:}"
      account="${path%%/*}"
      repo="${path#*/}"
      ;;
    file://*)
      path="${locator#file://}"
      repo="$(basename "${path}")"
      account="$(basename "$(dirname "${path}")")"
      provider="$(basename "$(dirname "$(dirname "${path}")")")"
      ;;
    *)
      return 1
      ;;
  esac

  repo="${repo%.git}"
  repo="${repo%%/*}"
  if [[ -z "${provider}" || -z "${account}" || -z "${repo}" ]]; then
    return 1
  fi

  printf '%s\n%s\n%s\n' "${provider}" "${account}" "${repo}"
}

repo_root=""
state_dir=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --repo-root)
      repo_root="${2:-}"
      shift 2
      ;;
    --state-dir)
      state_dir="${2:-}"
      shift 2
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${repo_root}" || -z "${state_dir}" ]]; then
  usage
  exit 1
fi

repo_root="$(resolve_dir "${repo_root}")"
state_dir="$(resolve_dir "${state_dir}")"

empty_root="${state_dir}/e2e/repo-cache/empty"
empty_mirror_dir="${empty_root}/mirrors"
empty_seed_dir="${empty_root}/seeds"
mkdir -p "${empty_mirror_dir}" "${empty_seed_dir}"

local_repos_dir="${INFINITO_E2E_LOCAL_REPOS_DIR:-$(dirname "${repo_root}")}"
required_remote_repos_raw="${INFINITO_E2E_REQUIRED_REMOTE_REPOS:-https://github.com/kevinveenbirkenbach/port-ui.git}"

mirror_root="${state_dir}/e2e/repo-cache/git-mirrors"
seed_root="${state_dir}/e2e/repo-cache/repo-seeds"
cache_state_root="${state_dir}/e2e/repo-cache"
sync_stamp="${cache_state_root}/last-sync.epoch"
max_age_seconds="${INFINITO_E2E_REPO_CACHE_MAX_AGE_SECONDS:-900}"
mkdir -p "${cache_state_root}"

declare -A sync_sources=()
sync_keys=()

add_sync_source() {
  local provider="${1}"
  local account="${2}"
  local repo_name="${3}"
  local source="${4}"
  local key="${provider}/${account}/${repo_name}"

  if [[ -z "${sync_sources[${key}]+x}" ]]; then
    sync_keys+=("${key}")
  fi
  sync_sources["${key}"]="${source}"
}

if [[ -d "${local_repos_dir}" ]]; then
  local_repos_dir="$(resolve_dir "${local_repos_dir}")"
  local_provider="$(basename "$(dirname "${local_repos_dir}")")"
  local_account="$(basename "${local_repos_dir}")"

  while IFS= read -r src_dir; do
    [[ -e "${src_dir}/.git" ]] || continue
    repo_name="$(basename "${src_dir}")"
    add_sync_source "${local_provider}" "${local_account}" "${repo_name}" "${src_dir}"
  done < <(find "${local_repos_dir}" -mindepth 1 -maxdepth 1 -type d | sort)
fi

if [[ -n "${required_remote_repos_raw//[[:space:]]/}" ]]; then
  for remote_repo in ${required_remote_repos_raw}; do
    if ! mapfile -t repo_parts < <(parse_repo_locator "${remote_repo}"); then
      echo "✖ Could not parse required remote repo locator: ${remote_repo}" >&2
      exit 1
    fi
    add_sync_source "${repo_parts[0]}" "${repo_parts[1]}" "${repo_parts[2]}" "${remote_repo}"
  done
fi

if [[ "${#sync_keys[@]}" -eq 0 ]]; then
  printf '%s\n%s\n' \
    "$(resolve_dir "${empty_mirror_dir}")" \
    "$(resolve_dir "${empty_seed_dir}")"
  exit 0
fi

sync_repo() {
  local provider="${1}"
  local account="${2}"
  local repo_name="${3}"
  local source="${4}"
  local mirror_repo="${mirror_root}/${provider}/${account}/${repo_name}.git"
  local seed_repo="${seed_root}/${provider}/${account}/${repo_name}"
  local container_remote="file:///opt/e2e/repo-mirrors/${provider}/${account}/${repo_name}.git"

  mkdir -p "$(dirname "${mirror_repo}")" "$(dirname "${seed_repo}")"

  if [[ -d "${mirror_repo}" ]] && ! git -C "${mirror_repo}" rev-parse --is-bare-repository >/dev/null 2>&1; then
    rm -rf "${mirror_repo}"
  fi

  if [[ -d "${mirror_repo}" ]]; then
    if git -C "${mirror_repo}" remote get-url origin >/dev/null 2>&1; then
      git -C "${mirror_repo}" remote set-url origin "${source}"
    else
      git -C "${mirror_repo}" remote add origin "${source}"
    fi
    git -C "${mirror_repo}" fetch --prune origin '+refs/*:refs/*'
  else
    git clone --mirror --no-hardlinks "${source}" "${mirror_repo}"
  fi

  if [[ -d "${seed_repo}/.git" ]]; then
    default_branch="$(git -C "${mirror_repo}" symbolic-ref --short HEAD 2>/dev/null || true)"
    git -C "${seed_repo}" remote set-url origin "${mirror_repo}"
    git -C "${seed_repo}" fetch --prune origin
    if [[ -n "${default_branch}" ]] && git -C "${seed_repo}" rev-parse --verify "refs/remotes/origin/${default_branch}" >/dev/null 2>&1; then
      git -C "${seed_repo}" checkout -f "${default_branch}" >/dev/null 2>&1 ||
        git -C "${seed_repo}" checkout -f -B "${default_branch}" "origin/${default_branch}"
      git -C "${seed_repo}" reset --hard "origin/${default_branch}" >/dev/null
    else
      git -C "${seed_repo}" reset --hard HEAD >/dev/null
    fi
    git -C "${seed_repo}" clean -fdx >/dev/null
  else
    rm -rf "${seed_repo}"
    git clone --no-hardlinks "${mirror_repo}" "${seed_repo}"
  fi
  git -C "${seed_repo}" remote set-url origin "${container_remote}"
  git -C "${seed_repo}" remote set-url --push origin "${container_remote}"
}

cache_is_complete=true
for key in "${sync_keys[@]}"; do
  IFS=/ read -r key_provider key_account key_repo <<<"${key}"
  if [[ ! -d "${mirror_root}/${key_provider}/${key_account}/${key_repo}.git" || ! -d "${seed_root}/${key_provider}/${key_account}/${key_repo}/.git" ]]; then
    cache_is_complete=false
    break
  fi
done

if [[ "${max_age_seconds}" =~ ^[0-9]+$ ]] &&
  [[ -s "${sync_stamp}" ]] &&
  [[ "${cache_is_complete}" == true ]] &&
  [[ -n "$(find "${mirror_root}" -mindepth 1 -print -quit 2>/dev/null)" ]] &&
  [[ -n "$(find "${seed_root}" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
  last_sync="$(cat "${sync_stamp}" 2>/dev/null || true)"
  now_epoch="$(date +%s)"
  if [[ "${last_sync}" =~ ^[0-9]+$ ]] && ((now_epoch - last_sync <= max_age_seconds)); then
    echo "→ Reusing recently synced optional hermetic repo cache ($((now_epoch - last_sync))s old)" >&2
    printf '%s\n%s\n' \
      "$(resolve_dir "${mirror_root}")" \
      "$(resolve_dir "${seed_root}")"
    exit 0
  fi
fi

for key in "${sync_keys[@]}"; do
  IFS=/ read -r key_provider key_account key_repo <<<"${key}"
  sync_repo "${key_provider}" "${key_account}" "${key_repo}" "${sync_sources[${key}]}"
done

date +%s >"${sync_stamp}"

printf '%s\n%s\n' \
  "$(resolve_dir "${mirror_root}")" \
  "$(resolve_dir "${seed_root}")"
