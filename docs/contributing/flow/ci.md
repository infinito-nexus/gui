# Continuous Integration 🔄

This document is the SPOT for CI pipeline structure and GitHub job scope used in infinito-deployer.

## Overview 🗺️

CI is triggered automatically on every push and pull request. The pipeline is composed of reusable workflow files under the [workflow directory](../../../.github/workflows/). The central coordinator is [ci.yml](../../../.github/workflows/ci.yml).

## Entry Points 🚪

| Trigger | Workflow | Description |
|---|---|---|
| Push or pull request | [ci.yml](../../../.github/workflows/ci.yml) | Runs lint and tests in parallel. |

## Pipeline Jobs 🏗️

| Job | Workflow | What it does |
|---|---|---|
| `lint-ruff` | [ruff.yml](../../../.github/workflows/ruff.yml) | Runs ruff on all Python files. |
| `max-lines` | [tests.yml](../../../.github/workflows/tests.yml) | Enforces maximum file length via `scripts/check-max-lines.sh`. |
| `test` | [tests.yml](../../../.github/workflows/tests.yml) | Runs `make test` (Python unit + integration + Node unit + integration tests when present). |
| `web-quality` | [tests.yml](../../../.github/workflows/tests.yml) | Runs `npm run lint` and `npm run typecheck` in `apps/web/`. |
| `web-e2e` | [tests.yml](../../../.github/workflows/tests.yml) | Runs Playwright end-to-end tests in `apps/web/`. |

## Concurrency 🔀

- PR pipelines use `cancel-in-progress: true` so only the newest run per ref is active.
