.PHONY: setup env dirs up down logs ps refresh-catalog db-up db-stop db-logs db-wait db-psql requirements-init ensure-local-runner-image test-arch test-env-up test-env-down test-up web-sync venv install test test-perf clean example-workspace-zip e2e-dashboard-local e2e-dashboard-local-docker e2e-dashboard-ci e2e-dashboard-ci-docker lint lint-python lint-shell autoformat autoformat-python autoformat-shell warn-local-unpinned-images pre-commit-install pre-commit-run playwright-build debug-workspace-perms repair-workspace-perms break-workspace-perms api-smoke-deployment api-smoke-deployment-full

# Use docker compose v2 by default; override via env if needed:
#   make setup DOCKER_COMPOSE="docker-compose"
DOCKER_COMPOSE ?= docker compose
COMPOSE_FILE   ?= docker-compose.yml
ENV_FILE       ?= .env
EFFECTIVE_ENV_FILE = $(if $(wildcard $(ENV_FILE)),$(ENV_FILE),env.example)
DOCKER_SOCKET_PATH ?= /var/run/docker.sock
# Resolve the docker.sock GID via a throwaway container probe so the value
# matches what every other container sees on user-namespaced / sandboxed
# docker setups. Host-side `stat` returns a translated gid (e.g. 65534)
# there, while compose hands `user: 10003:${DOCKER_SOCKET_GID}` to
# runner-manager — a mismatched primary gid breaks docker.sock access and
# surfaces as `POST /api/deployments → 500 permission denied while trying
# to connect to the docker API at unix:///var/run/docker.sock`.
export DOCKER_SOCKET_GID ?= $(shell bash scripts/util/resolve-docker-socket-gid.sh "$(DOCKER_SOCKET_PATH)")
CI_INFINITO_NEXUS_IMAGE ?= ghcr.io/infinito-nexus/core/debian@sha256:b494b40a45823fbefea7936c20f512582496a2e977a5c5ad3511775e98e83023
CI_JOB_RUNNER_IMAGE ?= ghcr.io/infinito-nexus/core/arch@sha256:9d6c7709caab53eeb1f227a1002f06df29990dfa0c4d41ca7cb84594c081f2cb
CI_POSTGRES_IMAGE ?= postgres@sha256:4327b9fd295502f326f44153a1045a7170ddbfffed1c3829798328556cfd09e2

VENV_DIR       ?= .venv
PYTHON         := $(VENV_DIR)/bin/python
PIP            := $(VENV_DIR)/bin/pip
RUFF           := $(VENV_DIR)/bin/ruff
PRE_COMMIT     := $(VENV_DIR)/bin/pre-commit

# Make tests import the app packages
export PYTHONPATH := $(PWD)/apps/api

# Keep state in repo-local directory for tests (no /state permission issues)
TEST_STATE_DIR := $(PWD)/state
# Always export STATE_HOST_PATH as an absolute path: the API container
# resolves it via Path(host_path).is_absolute() and 500s on relative
# values. env.example ships `./state` (relative) so a CI run that has no
# .env override would otherwise hit
#   POST /api/deployments → 500
#   {"detail":"STATE_HOST_PATH must be an absolute path for containerized jobs"}
# on the first deployment. Compose env vars beat --env-file values, so
# this overrides whatever env.example/.env have.
export STATE_HOST_PATH := $(TEST_STATE_DIR)
EXAMPLE_WORKSPACE_DIR ?= examples/workspace
EXAMPLE_WORKSPACE_ZIP ?= examples/workspace-import.zip

setup: env dirs up
	@echo "✔ Setup completed and stack is up."

env:
	@if [ ! -f "$(ENV_FILE)" ]; then \
		echo "→ Creating $(ENV_FILE) from env.example"; \
		cp env.example "$(ENV_FILE)"; \
	else \
		echo "→ $(ENV_FILE) already exists, skipping"; \
	fi

dirs:
	@mkdir -p state
	@echo "→ Ensured state/ directory exists"

warn-local-unpinned-images:
	@set -e; \
	resolve_from_env() { \
		key="$$1"; \
		value="$$(printenv "$$key" 2>/dev/null || true)"; \
		if [ -z "$$value" ] && [ -f "$(EFFECTIVE_ENV_FILE)" ]; then \
			value="$$(awk -F= -v key="$$key" '$$1 == key { sub(/^[^=]*=/, "", $$0); value=$$0 } END { print value }' "$(EFFECTIVE_ENV_FILE)")"; \
		fi; \
		printf '%s' "$$value"; \
	}; \
	warn_if_unpinned() { \
		image="$$1"; \
		if [ -n "$$image" ] && ! printf '%s' "$$image" | grep -Eq '@sha256:[0-9a-f]{64}$$'; then \
			echo "WARN: unpinned local image $$image, digest pinning enforced only in CI/prod"; \
		fi; \
	}; \
	catalog_image="$$(resolve_from_env INFINITO_NEXUS_IMAGE)"; \
	runner_image="$$(resolve_from_env JOB_RUNNER_IMAGE)"; \
	if [ -z "$$runner_image" ]; then runner_image="$$catalog_image"; fi; \
	db_image="$$(resolve_from_env POSTGRES_IMAGE)"; \
	if [ -z "$$db_image" ]; then db_image="postgres:16-alpine"; fi; \
	warn_if_unpinned "$$catalog_image"; \
	if [ "$$runner_image" != "$$catalog_image" ]; then warn_if_unpinned "$$runner_image"; fi; \
	warn_if_unpinned "$$db_image"

up:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@bash scripts/ensure-local-runner-image.sh "$(EFFECTIVE_ENV_FILE)"
	@echo "→ Starting stack via compose ($(COMPOSE_FILE), env=$(EFFECTIVE_ENV_FILE))"
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build --remove-orphans

down:
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" down

logs:
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" logs -f --tail=200

restart: down up

ps:
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" ps

db-up:
	@echo "→ Starting Postgres (db)"
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d db

db-stop:
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" stop db

db-logs:
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" logs -f --tail=200 db

db-wait:
	@echo "→ Waiting for Postgres to become ready"
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T db sh -lc 'for i in $$(seq 1 60); do pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" >/dev/null 2>&1 && echo "✔ Postgres is ready." && exit 0; sleep 1; done; echo "✖ Postgres not ready after 60s"; exit 1'

db-psql:
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" exec db sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

# Compare workspace permissions inside the api container vs on the host
# filesystem. Helps diagnose "Inventory sync failed: HTTP 500".
# Usage: make debug-workspace-perms WORKSPACE_ID=<id>
debug-workspace-perms:
	@if [ -z "$(WORKSPACE_ID)" ]; then echo "✖ WORKSPACE_ID is required (e.g. make debug-workspace-perms WORKSPACE_ID=a8bb35e5adc8)"; exit 2; fi
	@DOCKER_COMPOSE="$(DOCKER_COMPOSE)" COMPOSE_FILE="$(COMPOSE_FILE)" ENV_FILE="$(ENV_FILE)" \
		bash scripts/workspace-perms/debug.sh "$(WORKSPACE_ID)"

# Test-only: deliberately corrupt one workspace dir back to the
# pre-hardening root:root mode 0755 state so we can verify init-state-perms
# (or `make repair-workspace-perms`) self-heals it on the next stack start.
# Usage: make break-workspace-perms WORKSPACE_ID=<id>
break-workspace-perms:
	@if [ -z "$(WORKSPACE_ID)" ]; then echo "✖ WORKSPACE_ID is required (e.g. make break-workspace-perms WORKSPACE_ID=a8bb35e5adc8)"; exit 2; fi
	@bash scripts/workspace-perms/break.sh "$(WORKSPACE_ID)"

# One-shot migration: re-own any workspace directory that is still root-owned
# (created before the api container was hardened to non-root user) so the api
# (uid 10001, gid 10900) can write atomic temp files into it again. Otherwise
# the inventory PUT endpoint loops with HTTP 500
# `[Errno 13] Permission denied: .inventory.yml.<hash>.tmp`.
# Idempotent: only touches dirs not already owned by 10001:10900.
repair-workspace-perms:
	@bash scripts/workspace-perms/repair.sh

# Smoke-test POST /api/deployments end-to-end against the currently running
# stack from inside the docker-compose network. Useful when the host shell
# cannot reach 127.0.0.1:8000 (sandboxed/network-namespaced terminals)
# and you need the actual error body of a 500 to debug it.
# Usage: make api-smoke-deployment [HOST=ssh-password PLAYBOOK=playbooks/security_wait.yml]
HOST     ?= ssh-password
PLAYBOOK ?= playbooks/security_wait.yml
api-smoke-deployment:
	@bash scripts/api-smoke/trigger-deployment.sh --host "$(HOST)" --playbook "$(PLAYBOOK)"

# Like api-smoke-deployment but also waits for the deployment to reach
# `running` and reads a few SSE events. Mirrors what test_security_hardening
# and test_sse_scalability do post-POST, so a green local run is a strong
# signal CI integration tests will reach the same checkpoint.
# Usage: make api-smoke-deployment-full [HOST=ssh-password PLAYBOOK=playbooks/security_wait.yml]
api-smoke-deployment-full:
	@bash scripts/api-smoke/trigger-deployment.sh --host "$(HOST)" --playbook "$(PLAYBOOK)" --wait

requirements-init: db-up db-wait
	@echo "→ Ensuring requirements tables exist"
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" run --rm --no-deps --build api python -c 'from services.server_requirements import WorkspaceServerRequirementsService; WorkspaceServerRequirementsService().list_requirements("bootstrap"); print("✔ requirements schema ready")'

refresh-catalog:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --force-recreate catalog
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" restart api

ensure-local-runner-image:
	@bash scripts/ensure-local-runner-image.sh "$(EFFECTIVE_ENV_FILE)"

web-sync:
	@echo "→ Syncing web sources into running container"
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d web
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T web sh -lc 'rm -rf /tmp/web-src && mkdir -p /tmp/web-src'
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" cp apps/web/. web:/tmp/web-src
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T web sh -lc 'cd /tmp/web-src && npm ci && npm run build'
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T web sh -lc 'rm -rf /app/.next /app/public /app/server.js /app/package.json /app/node_modules; mkdir -p /app/.next; cp -a /tmp/web-src/.next/standalone/. /app/; cp -a /tmp/web-src/.next/static /app/.next/; cp -a /tmp/web-src/public /app/public'
	@$(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" restart web
	@echo "✔ Web container refreshed."

test-arch:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@$(MAKE) --no-print-directory ensure-local-runner-image
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build test-arch

test-env-up:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@$(MAKE) --no-print-directory ensure-local-runner-image
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build

test-env-down:
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" down

# Start the minimal test stack (api db catalog runner-manager web) under the test profile.
# Pass image overrides via env, e.g.:
#   INFINITO_NEXUS_IMAGE=infinito-debian:latest JOB_RUNNER_IMAGE=infinito-debian:latest make test-up
TEST_UP_SERVICES ?= api db catalog runner-manager web
test-up:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@$(MAKE) --no-print-directory ensure-local-runner-image
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build $(TEST_UP_SERVICES)

venv:
	@test -d "$(VENV_DIR)" || python -m venv "$(VENV_DIR)"
	@$(PIP) install -U pip setuptools wheel

install: venv
	@$(PIP) install '.[dev]'

test: dirs install
	@echo "→ Running Python unit tests"
	@STATE_DIR="$(TEST_STATE_DIR)" $(PYTHON) -m unittest discover -s tests/python/unit -p "test_*.py" -t . -v
	@echo "→ Running Python integration tests"
	@modules=$$(find tests/python/integration -maxdepth 1 -name 'test_*.py' ! -name 'test_perf_*.py' -printf '%f\n' 2>/dev/null | sed 's/\.py$$//' | sed 's/^/tests.python.integration./'); \
	if [ -n "$$modules" ]; then \
		STATE_DIR="$(TEST_STATE_DIR)" $(PYTHON) -m unittest $$modules -v; \
	else \
		echo "→ (no python integration tests)"; \
	fi
	@echo "→ Running Node unit tests"
	@STATE_DIR="$(TEST_STATE_DIR)" node --test tests/node/unit/*.mjs
	@echo "→ Running Node integration tests"
	@if ls tests/node/integration/*.mjs >/dev/null 2>&1; then STATE_DIR="$(TEST_STATE_DIR)" node --test tests/node/integration/*.mjs; else echo "→ (no node integration tests)"; fi

test-perf: dirs
	@set -e; \
	if [ ! -x "$(PYTHON)" ]; then \
		echo "✖ Missing $(PYTHON). Run 'make install' once before 'make test-perf'."; \
		exit 1; \
	fi; \
	"$(PYTHON)" -c 'import httpx, psycopg, yaml' >/dev/null 2>&1 || { \
		echo "✖ Python perf dependencies are missing in $(VENV_DIR). Run 'make install' first."; \
		exit 1; \
	}; \
	$(MAKE) --no-print-directory ensure-local-runner-image; \
	started_here=0; \
	running_services="$$(COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" ps --services --filter status=running)"; \
	if ! printf '%s\n' "$$running_services" | grep -qx api || \
	   ! printf '%s\n' "$$running_services" | grep -qx runner-manager || \
	   ! printf '%s\n' "$$running_services" | grep -qx web || \
	   ! printf '%s\n' "$$running_services" | grep -qx ssh-password; then \
		echo "→ Starting test stack for perf harness"; \
		$(MAKE) test-up TEST_UP_SERVICES="api db catalog runner-manager web ssh-password"; \
		started_here=1; \
	fi; \
	mkdir -p state/perf/016; \
	echo "→ Running Python perf tests"; \
	STATE_DIR="$(TEST_STATE_DIR)" $(PYTHON) -m unittest tests.python.integration.test_perf_role_index tests.python.integration.test_perf_sse_scalability -v; \
	echo "→ Running dashboard perf Playwright spec"; \
	if [ ! -d apps/web/node_modules ]; then (cd apps/web && npm ci); fi; \
	if ! find "$$HOME/.cache/ms-playwright" -maxdepth 1 -type d -name 'chromium-*' -print -quit 2>/dev/null | grep -q .; then \
		(cd apps/web && npx playwright install chromium >/dev/null); \
	fi; \
	(cd apps/web && PLAYWRIGHT_BASE_URL="http://127.0.0.1:$${WEB_PORT:-3000}" npx playwright test -c playwright.dashboard.config.ts tests/dashboard-perf.spec.ts); \
	echo "→ Verifying perf result artifacts"; \
	STATE_DIR="$(TEST_STATE_DIR)" $(PYTHON) scripts/verify_perf_artifacts.py; \
	if [ "$$started_here" = "1" ]; then \
		echo "→ Tearing down perf test stack"; \
		COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(EFFECTIVE_ENV_FILE)" -f "$(COMPOSE_FILE)" down; \
	fi

clean:
	@rm -rf "$(VENV_DIR)" state
	@echo "→ Removed .venv/ and state/"

example-workspace-zip:
	@command -v zip >/dev/null 2>&1 || { echo "✖ zip command not found"; exit 1; }
	@test -d "$(EXAMPLE_WORKSPACE_DIR)" || { echo "✖ Missing $(EXAMPLE_WORKSPACE_DIR)"; exit 1; }
	@mkdir -p "$(dir $(EXAMPLE_WORKSPACE_ZIP))"
	@rm -f "$(EXAMPLE_WORKSPACE_ZIP)"
	@cd "$(EXAMPLE_WORKSPACE_DIR)" && zip -rq "$(abspath $(EXAMPLE_WORKSPACE_ZIP))" .
	@echo "✔ Created $(EXAMPLE_WORKSPACE_ZIP)"

e2e-dashboard-local:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@INFINITO_NEXUS_SRC_DIR="$(INFINITO_NEXUS_SRC_DIR)" ./scripts/e2e/dashboard/run.sh local

# Fully reproducible e2e run with no host dependencies other than Docker.
# Builds the stack via the regular local flow but runs Playwright inside a
# locally-built Microsoft Playwright + docker-cli image that is attached to
# the docker-compose network. Useful when the host cannot publish/reach
# docker port mappings (sandboxed/network-namespaced terminals, restricted
# CI runners) or has a glibc that does not match the playwright image.
#
# The first run builds infinito-deployer-playwright:latest from
# apps/test/playwright/Dockerfile (~1 min). Subsequent runs reuse the image.
#
# Usage:
#   make e2e-dashboard-local-docker INFINITO_NEXUS_SRC_DIR=/abs/path/to/infinito-nexus
#
# Optional overrides:
#   INFINITO_E2E_PLAYWRIGHT_BASE_IMAGE  (default: mcr.microsoft.com/playwright:v1.55.1-jammy)
#   INFINITO_E2E_PLAYWRIGHT_IMAGE       (default: infinito-deployer-playwright:latest)
e2e-dashboard-local-docker:
	@$(MAKE) --no-print-directory warn-local-unpinned-images
	@INFINITO_NEXUS_SRC_DIR="$(INFINITO_NEXUS_SRC_DIR)" \
		INFINITO_E2E_PLAYWRIGHT_DOCKER=1 \
		./scripts/e2e/dashboard/run.sh local

e2e-dashboard-ci:
	@./scripts/e2e/dashboard/run.sh ci

# CI variant of e2e-dashboard-local-docker: pulls the registry-pinned
# Infinito.Nexus images instead of building from source, but otherwise runs
# the same Playwright-in-docker flow so it works in sandboxed/network-namespaced
# terminals where the host cannot reach docker port mappings.
#
# Usage:
#   make e2e-dashboard-ci-docker
e2e-dashboard-ci-docker:
	@INFINITO_E2E_PLAYWRIGHT_DOCKER=1 \
		./scripts/e2e/dashboard/run.sh ci

# Build the Playwright + docker-cli image used by e2e-dashboard-local-docker.
# Override base image or output tag via:
#   make playwright-build PLAYWRIGHT_BASE=mcr.microsoft.com/playwright:v1.55.1-jammy PLAYWRIGHT_IMAGE=infinito-deployer-playwright:latest
PLAYWRIGHT_BASE  ?= mcr.microsoft.com/playwright:v1.55.1-jammy
PLAYWRIGHT_IMAGE ?= infinito-deployer-playwright:latest
playwright-build:
	@echo "→ Building Playwright+docker-cli image ($(PLAYWRIGHT_IMAGE)) from $(PLAYWRIGHT_BASE)"
	@docker build \
		--build-arg "PLAYWRIGHT_BASE=$(PLAYWRIGHT_BASE)" \
		-t "$(PLAYWRIGHT_IMAGE)" \
		apps/test/playwright

# Lint = check-only, fails on any issue or formatting drift.
# Autoformat = applies autofix and reformatting in place.
# Both operate on tracked sources only (git ls-files respects .gitignore).
lint: lint-python lint-shell

lint-python:
	@echo "→ ruff check"
	@files=$$(git ls-files '*.py' '*.pyi' | rg -v '^e2e/repo-cache/' || true); \
	if [ -n "$$files" ]; then \
		$(RUFF) check $$files; \
	else \
		echo "→ (no tracked Python files)"; \
	fi
	@echo "→ ruff format --check"
	@files=$$(git ls-files '*.py' '*.pyi' | rg -v '^e2e/repo-cache/' || true); \
	if [ -n "$$files" ]; then \
		$(RUFF) format --check $$files; \
	else \
		echo "→ (no tracked Python files)"; \
	fi
	@echo "→ banned-pattern check"
	@failed=0; \
	check_pattern() { \
		label="$$1"; \
		pattern="$$2"; \
		shift 2; \
		paths="$$@"; \
		if rg -n -- "$$pattern" $$paths >/dev/null; then \
			echo "✖ banned $$label usage found in tracked sources"; \
			rg -n -- "$$pattern" $$paths; \
			failed=1; \
		else \
			echo "→ no banned $$label usage found"; \
		fi; \
	}; \
	check_pattern "yaml.load(" "yaml\\.load\\(" apps tests; \
	check_pattern "eval(" "\\beval\\(" apps tests; \
	check_pattern "shell=True" "shell=True" apps tests; \
	check_pattern "mode=0o777" "mode\\s*=\\s*0o777" apps tests; \
	sh_files=$$(git ls-files '*.sh' | rg -v '^e2e/repo-cache/' || true); \
	check_pattern "privileged container flags" "(--privileged|privileged:[[:space:]]*true)" docker-compose.yml docker-compose.ssh-test.yml $$sh_files; \
	if [ "$$failed" -ne 0 ]; then exit 1; fi

lint-shell:
	@echo "→ shellcheck (tracked *.sh)"
	@files=$$(git ls-files '*.sh'); \
	if [ -n "$$files" ]; then \
		shellcheck -x $$files; \
	else \
		echo "→ (no tracked *.sh files)"; \
	fi
	@if command -v shfmt >/dev/null 2>&1; then \
		echo "→ shfmt --diff (tracked *.sh)"; \
		files=$$(git ls-files '*.sh'); \
		if [ -n "$$files" ]; then shfmt -i 2 -ci -d $$files; fi; \
	else \
		echo "→ (shfmt not installed, skipping format check)"; \
	fi

autoformat: autoformat-python autoformat-shell

autoformat-python:
	@echo "→ ruff check --fix"
	@files=$$(git ls-files '*.py' '*.pyi' | rg -v '^e2e/repo-cache/' || true); \
	if [ -n "$$files" ]; then \
		$(RUFF) check $$files --fix; \
	else \
		echo "→ (no tracked Python files)"; \
	fi
	@echo "→ ruff format"
	@files=$$(git ls-files '*.py' '*.pyi' | rg -v '^e2e/repo-cache/' || true); \
	if [ -n "$$files" ]; then \
		$(RUFF) format $$files; \
	else \
		echo "→ (no tracked Python files)"; \
	fi

autoformat-shell:
	@if command -v shfmt >/dev/null 2>&1; then \
		echo "→ shfmt -w (tracked *.sh)"; \
		files=$$(git ls-files '*.sh'); \
		if [ -n "$$files" ]; then shfmt -i 2 -ci -w $$files; fi; \
	else \
		echo "→ (shfmt not installed, skipping)"; \
	fi

pre-commit-install:
	@$(PIP) install --quiet "pre-commit>=3.7"
	@$(PRE_COMMIT) install

pre-commit-run:
	@$(PRE_COMMIT) run --all-files
