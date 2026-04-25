#!/usr/bin/env bash
# Smoke-test POST /api/deployments end-to-end against the currently running
# stack from inside the docker-compose network. Useful when the host shell
# cannot reach 127.0.0.1:8000 (sandboxed/network-namespaced terminals)
# and you need the actual API response body / status to debug a 500.
#
# Steps (matches what test_security_hardening does):
#   1. prime CSRF cookie    (GET  /api/workspaces)
#   2. create workspace     (POST /api/workspaces)
#   3. generate inventory   (POST /api/workspaces/<id>/inventory)
#   4. create deployment    (POST /api/deployments)
#
# Prints each response so a 500 surfaces with its error body. Idempotent
# — every run creates a new workspace.
#
# Usage:
#   scripts/api-smoke/trigger-deployment.sh [--host <alias>] [--playbook <path>]
#
# Defaults: host=ssh-password, playbook=playbooks/security_wait.yml.
set -euo pipefail

host="ssh-password"
playbook="playbooks/security_wait.yml"
selected_roles="[]"
network="infinito-deployer"
api_host="api"
api_port="8000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      host="$2"
      shift 2
      ;;
    --playbook)
      playbook="$2"
      shift 2
      ;;
    --selected-roles)
      selected_roles="$2"
      shift 2
      ;;
    --network)
      network="$2"
      shift 2
      ;;
    --api-host)
      api_host="$2"
      shift 2
      ;;
    --api-port)
      api_port="$2"
      shift 2
      ;;
    *)
      echo "✖ unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

api_url="http://${api_host}:${api_port}"

docker run --rm --network "${network}" \
  -e API_URL="${api_url}" \
  -e DEPLOY_HOST="${host}" \
  -e PLAYBOOK="${playbook}" \
  -e SELECTED_ROLES="${selected_roles}" \
  alpine:latest sh -lc '
    set -e
    apk add --no-cache --quiet curl jq >/dev/null 2>&1
    cookies=/tmp/c

    echo "→ 1/4 prime CSRF cookie via GET ${API_URL}/api/workspaces"
    curl -fsS -c "${cookies}" -H "Origin: http://127.0.0.1:3000" \
      "${API_URL}/api/workspaces" >/dev/null
    csrf=$(awk "/csrf/ {print \$NF}" "${cookies}")
    if [ -z "${csrf}" ]; then
      echo "✖ no csrf cookie returned" >&2
      exit 1
    fi
    echo "  csrf=${csrf}"

    echo "→ 2/4 POST ${API_URL}/api/workspaces"
    ws=$(curl -fsS -b "${cookies}" -H "X-CSRF: ${csrf}" \
      -H "Origin: http://127.0.0.1:3000" \
      -H "Content-Type: application/json" \
      -X POST "${API_URL}/api/workspaces" -d "{}" | jq -r .workspace_id)
    if [ -z "${ws}" ] || [ "${ws}" = "null" ]; then
      echo "✖ workspace creation failed" >&2
      exit 1
    fi
    echo "  workspace_id=${ws}"

    echo "→ 3a/4 PUT ${API_URL}/api/workspaces/${ws}/files/${PLAYBOOK} (write playbook)"
    pb=$(curl -s -o /tmp/pb.json -w "%{http_code}" -b "${cookies}" \
      -H "X-CSRF: ${csrf}" -H "Origin: http://127.0.0.1:3000" \
      -H "Content-Type: application/json" \
      -X PUT "${API_URL}/api/workspaces/${ws}/files/${PLAYBOOK}" \
      -d "{\"content\":\"- hosts: all\\n  gather_facts: false\\n  tasks: []\\n\"}")
    echo "  status=${pb}"
    head -c 200 /tmp/pb.json
    echo

    echo "→ 3b/4 POST ${API_URL}/api/workspaces/${ws}/generate-inventory"
    inv=$(curl -s -o /tmp/inv.json -w "%{http_code}" -b "${cookies}" \
      -H "X-CSRF: ${csrf}" -H "Origin: http://127.0.0.1:3000" \
      -H "Content-Type: application/json" \
      -X POST "${API_URL}/api/workspaces/${ws}/generate-inventory" \
      -d "{\"alias\":\"target\",\"host\":\"${DEPLOY_HOST}\",\"port\":22,\"user\":\"integration\",\"auth_method\":\"password\",\"selected_roles\":[\"web-app-dashboard\"]}")
    echo "  status=${inv}"
    head -c 500 /tmp/inv.json
    echo

    echo "→ 4/4 POST ${API_URL}/api/deployments"
    body=$(printf "{\"workspace_id\":\"%s\",\"host\":\"%s\",\"port\":22,\"user\":\"integration\",\"auth\":{\"method\":\"password\",\"password\":\"x\"},\"selected_roles\":%s,\"playbook_path\":\"%s\",\"limit\":\"target\"}" \
      "${ws}" "${DEPLOY_HOST}" "${SELECTED_ROLES}" "${PLAYBOOK}")
    dep=$(curl -s -o /tmp/dep.json -w "%{http_code}" -b "${cookies}" \
      -H "X-CSRF: ${csrf}" -H "Origin: http://127.0.0.1:3000" \
      -H "Content-Type: application/json" \
      -X POST "${API_URL}/api/deployments" -d "${body}")
    echo "  status=${dep}"
    cat /tmp/dep.json
    echo
'
