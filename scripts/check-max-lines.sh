#!/usr/bin/env bash
set -euo pipefail

MAX_LINES="${MAX_LINES:-500}"

if ! [[ "$MAX_LINES" =~ ^[0-9]+$ ]]; then
  echo "MAX_LINES must be a positive integer, got: $MAX_LINES" >&2
  exit 2
fi

declare -a patterns=(
  '*.ts' '*.tsx' '*.js' '*.jsx'
  '*.py' '*.sh' '*.go' '*.rs'
  '*.java' '*.rb' '*.php'
  '*.c' '*.cpp' '*.h' '*.hpp'
)

declare -a violations=()

while IFS= read -r -d '' file; do
  case "$file" in
    apps/web/node_modules/* | apps/web/.next/* | .venv/* | state/* | infinito-nexus/*)
      continue
      ;;
  esac

  [[ -f "$file" ]] || continue

  line_count="$(wc -l <"$file" | tr -d ' ')"
  if ((line_count > MAX_LINES)); then
    violations+=("$line_count\t$file")
  fi
done < <(git ls-files -z -- "${patterns[@]}")

if ((${#violations[@]} > 0)); then
  echo "Files exceeding ${MAX_LINES} lines:" >&2
  printf '%b\n' "${violations[@]}" | sort -nr >&2
  exit 1
fi

echo "OK: all tracked code files are <= ${MAX_LINES} lines."
