#!/usr/bin/env bash
set -euo pipefail

exec /usr/local/bin/docker compose "$@"
