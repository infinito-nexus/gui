#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="${INFINITO_E2E_REAL_GIT:-/usr/bin/git.actual}"
MIRROR_ROOT="${INFINITO_E2E_REPO_MIRROR_ROOT:-/opt/e2e/repo-mirrors}"
INVOCATION_NAME="$(basename "$0")"

# Preserve Git's helper entry points such as git-upload-pack. Git dispatches
# those via symlinks to the main binary, so changing argv[0] back to "git"
# would make the real binary treat the repository path as a subcommand.
if [[ "${INVOCATION_NAME}" != "git" ]]; then
  exec -a "${INVOCATION_NAME}" "${REAL_GIT}" "$@"
fi

normalize_git_remote() {
  local remote="${1:-}"
  local provider=""
  local owner=""
  local repo=""
  local path=""

  case "${remote}" in
    https://*/*/*)
      path="${remote#https://}"
      provider="${path%%/*}"
      path="${path#*/}"
      owner="${path%%/*}"
      repo="${path#*/}"
      ;;
    ssh://git@*/*/*)
      path="${remote#ssh://git@}"
      provider="${path%%/*}"
      path="${path#*/}"
      owner="${path%%/*}"
      repo="${path#*/}"
      ;;
    git@*:*/*)
      path="${remote#git@}"
      provider="${path%%:*}"
      path="${path#*:}"
      owner="${path%%/*}"
      repo="${path#*/}"
      ;;
    *)
      printf '%s\n' "${remote}"
      return 0
      ;;
  esac

  repo="${repo%.git}"
  repo="${repo%%/*}"
  if [ -z "${provider}" ] || [ -z "${owner}" ] || [ -z "${repo}" ]; then
    printf '%s\n' "${remote}"
    return 0
  fi

  local mirror_path="${MIRROR_ROOT}/${provider}/${owner}/${repo}.git"
  if [ -d "${mirror_path}" ]; then
    printf 'file://%s\n' "${mirror_path}"
    return 0
  fi

  printf '%s\n' "${remote}"
}

remove_invalid_clone_destination() {
  if [ "$#" -lt 3 ] || [ "${1:-}" != "clone" ]; then
    return 0
  fi

  local dest="${*: -1}"
  if [ -z "${dest}" ] || [ "${dest#-}" != "${dest}" ]; then
    return 0
  fi

  local head_file="${dest}/.git/HEAD"
  if [ ! -f "${head_file}" ]; then
    return 0
  fi

  local head_ref
  head_ref="$(cat "${head_file}" 2>/dev/null || true)"
  if [ "${head_ref}" = "ref: refs/heads/.invalid" ]; then
    rm -rf -- "${dest}"
  fi
}

rewritten_args=()
for arg in "$@"; do
  rewritten_args+=("$(normalize_git_remote "${arg}")")
done

remove_invalid_clone_destination "${rewritten_args[@]}"

exec "${REAL_GIT}" "${rewritten_args[@]}"
