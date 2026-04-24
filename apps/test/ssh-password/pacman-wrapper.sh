#!/usr/bin/env bash
set -euo pipefail

REAL_PACMAN="/usr/bin/pacman"

is_repo_package_name() {
  local value="${1:-}"
  case "${value}" in
    "" | -* | /* | ./* | ../* | *.pkg.tar | *.pkg.tar.*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

append_package_tokens() {
  local raw="${1:-}"
  local token=""
  while IFS= read -r token; do
    token="${token#"${token%%[![:space:]]*}"}"
    token="${token%"${token##*[![:space:]]}"}"
    if [[ -n "${token}" ]]; then
      package_args+=("${token}")
    fi
  done < <(printf '%s\n' "${raw}")
}

lookup_installed_version() {
  local package_name="${1:-}"
  local package_line=""
  if ! package_line="$("${REAL_PACMAN}" -Q "${package_name}" 2>/dev/null)"; then
    return 1
  fi
  printf '%s\n' "${package_line#"${package_name}" }"
}

# Ansible's pacman integration probes and installs Arch repo packages via
# `pacman --upgrade ... <repo-package>`, but `--upgrade` only accepts local
# package files. On the ssh-password test target we normalize repo package
# names and:
# - emulate the `--print-format` probe for installed repo packages
# - translate repo-package installs from `--upgrade` to `--sync`
if [[ " $* " == *" --upgrade "* ]]; then
  package_args=()
  translated_args=()
  print_format=""
  skip_next=0
  capture_print_format=0
  for arg in "$@"; do
    if ((skip_next)); then
      if ((capture_print_format)); then
        print_format="${arg}"
        capture_print_format=0
      fi
      translated_args+=("${arg}")
      skip_next=0
      continue
    fi
    case "${arg}" in
      --print-format)
        capture_print_format=1
        translated_args+=("${arg}")
        skip_next=1
        ;;
      --upgrade)
        translated_args+=("--sync")
        ;;
      --root | --dbpath | --cachedir | --config | --gpgdir | --hookdir | --overwrite | --arch | --assume-installed | --sysroot)
        translated_args+=("${arg}")
        skip_next=1
        ;;
      --*)
        translated_args+=("${arg}")
        ;;
      -*)
        translated_args+=("${arg}")
        ;;
      *)
        append_package_tokens "${arg}"
        ;;
    esac
  done

  if [[ ${#package_args[@]} -gt 0 ]]; then
    for arg in "${package_args[@]}"; do
      if ! is_repo_package_name "${arg}"; then
        exec "${REAL_PACMAN}" "$@"
      fi
    done

    case "${print_format}" in
      "%n")
        printf '%s\n' "${package_args[@]}"
        exit 0
        ;;
      "%n %v")
        for arg in "${package_args[@]}"; do
          version="$(lookup_installed_version "${arg}" || true)"
          if [[ -z "${version}" ]]; then
            exec "${REAL_PACMAN}" "$@"
          fi
          printf '%s %s\n' "${arg}" "${version}"
        done
        exit 0
        ;;
    esac

    exec "${REAL_PACMAN}" "${translated_args[@]}" "${package_args[@]}"
  fi
fi

exec "${REAL_PACMAN}" "$@"
