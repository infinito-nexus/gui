.PHONY: setup env dirs up down logs ps refresh-catalog db-up db-stop db-logs db-wait db-psql requirements-init test-arch test-env-up test-env-down test-up web-sync venv install test clean example-workspace-zip e2e-dashboard-local e2e-dashboard-ci lint lint-python lint-shell autoformat autoformat-python autoformat-shell

# Use docker compose v2 by default; override via env if needed:
#   make setup DOCKER_COMPOSE="docker-compose"
DOCKER_COMPOSE ?= docker compose
COMPOSE_FILE   ?= docker-compose.yml
ENV_FILE       ?= .env

VENV_DIR       ?= .venv
PYTHON         := $(VENV_DIR)/bin/python
PIP            := $(VENV_DIR)/bin/pip
RUFF           := $(VENV_DIR)/bin/ruff

# Make tests import the app packages
export PYTHONPATH := $(PWD)/apps/api

# Keep state in repo-local directory for tests (no /state permission issues)
TEST_STATE_DIR := $(PWD)/state
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

up:
	@echo "→ Starting stack via compose ($(COMPOSE_FILE), env=$(ENV_FILE))"
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build --remove-orphans

down:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" down

logs:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" logs -f --tail=200

restart: down up

ps:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" ps

db-up:
	@echo "→ Starting Postgres (db)"
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d db

db-stop:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" stop db

db-logs:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" logs -f --tail=200 db

db-wait:
	@echo "→ Waiting for Postgres to become ready"
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T db sh -lc 'for i in $$(seq 1 60); do pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" >/dev/null 2>&1 && echo "✔ Postgres is ready." && exit 0; sleep 1; done; echo "✖ Postgres not ready after 60s"; exit 1'

db-psql:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" exec db sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

requirements-init: db-up db-wait
	@echo "→ Ensuring requirements tables exist"
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" run --rm --no-deps --build api python -c 'from services.server_requirements import WorkspaceServerRequirementsService; WorkspaceServerRequirementsService().list_requirements("bootstrap"); print("✔ requirements schema ready")'

refresh-catalog:
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --force-recreate catalog
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" restart api

web-sync:
	@echo "→ Syncing web sources into running container"
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d web
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T web sh -lc 'rm -rf /tmp/web-src && mkdir -p /tmp/web-src'
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" cp apps/web/. web:/tmp/web-src
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T web sh -lc 'cd /tmp/web-src && npm ci && npm run build'
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" exec -T web sh -lc 'rm -rf /app/.next /app/public /app/server.js /app/package.json /app/node_modules; mkdir -p /app/.next; cp -a /tmp/web-src/.next/standalone/. /app/; cp -a /tmp/web-src/.next/static /app/.next/; cp -a /tmp/web-src/public /app/public'
	@$(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" restart web
	@echo "✔ Web container refreshed."

test-arch:
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build test-arch

test-env-up:
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d --build

test-env-down:
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" down

# Start the minimal test stack (api db catalog web) under the test profile.
# Pass image overrides via env, e.g.:
#   INFINITO_NEXUS_IMAGE=infinito-debian:latest JOB_RUNNER_IMAGE=infinito-debian:latest make test-up
TEST_UP_SERVICES ?= api db catalog web
test-up:
	@COMPOSE_PROFILES=test $(DOCKER_COMPOSE) --env-file "$(ENV_FILE)" -f "$(COMPOSE_FILE)" up -d $(TEST_UP_SERVICES)

venv:
	@test -d "$(VENV_DIR)" || python -m venv "$(VENV_DIR)"
	@$(PIP) install -U pip setuptools wheel

install: venv
	@$(PIP) install '.[dev]'

test: dirs install
	@echo "→ Running Python unit tests"
	@STATE_DIR="$(TEST_STATE_DIR)" $(PYTHON) -m unittest discover -s tests/python -p "test_*.py" -t . -v
	@echo "→ Running Python integration tests"
	@if ls tests/python/integration/test_*.py >/dev/null 2>&1; then STATE_DIR="$(TEST_STATE_DIR)" $(PYTHON) -m unittest discover -s tests/python/integration -p "test_*.py" -t . -v; else echo "→ (no python integration tests)"; fi
	@echo "→ Running Node unit tests"
	@STATE_DIR="$(TEST_STATE_DIR)" node --test tests/node/unit/*.mjs
	@echo "→ Running Node integration tests"
	@if ls tests/node/integration/*.mjs >/dev/null 2>&1; then STATE_DIR="$(TEST_STATE_DIR)" node --test tests/node/integration/*.mjs; else echo "→ (no node integration tests)"; fi

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
	@INFINITO_NEXUS_SRC_DIR="$(INFINITO_NEXUS_SRC_DIR)" ./scripts/e2e/dashboard/run.sh local

e2e-dashboard-ci:
	@./scripts/e2e/dashboard/run.sh ci

# Lint = check-only, fails on any issue or formatting drift.
# Autoformat = applies autofix and reformatting in place.
# Both operate on tracked sources only (git ls-files respects .gitignore).
lint: lint-python lint-shell

lint-python:
	@echo "→ ruff check"
	@$(RUFF) check .
	@echo "→ ruff format --check"
	@$(RUFF) format --check .

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
	@$(RUFF) check . --fix
	@echo "→ ruff format"
	@$(RUFF) format .

autoformat-shell:
	@if command -v shfmt >/dev/null 2>&1; then \
		echo "→ shfmt -w (tracked *.sh)"; \
		files=$$(git ls-files '*.sh'); \
		if [ -n "$$files" ]; then shfmt -i 2 -ci -w $$files; fi; \
	else \
		echo "→ (shfmt not installed, skipping)"; \
	fi
