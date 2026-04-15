# CLAUDE.md

## Startup — MUST DO at the Start of Every Conversation

You MUST read `AGENTS.md` and follow all instructions in it at the start of every conversation before doing anything else. Do NOT skip this, even for short or simple requests.

## Interaction Rules

- Questions MUST NOT lead to modifications, manipulation of files, code, or state.
- Only explicit commands MAY trigger modifications or manipulation.

## Code Execution

- You SHOULD run permitted commands directly on the host.
- For commands that are NOT permitted on the host, you MUST run them inside the application containers instead. Use `make up` to start the stack, then use `docker compose exec <service> bash` to open a shell inside the container.
- Host-side source edits are NOT automatically synced into the running `api` container.
- The SPOT for refresh and redeploy behavior after local edits is [Iteration](docs/agents/action/iteration.md). Use `make restart` for the default edit-fix-redeploy loop and `make web-sync` for frontend-only changes.
- This avoids permission prompts and keeps the workflow uninterrupted.

### Stack & Compose Operations — Use Makefile Targets

All stack/container orchestration MUST go through `make` targets, never raw `docker compose` or `docker run` invocations. Raw compose calls — especially with env-var prefixes or shell pipes — do not match the allow-list patterns and trigger permission prompts, breaking the workflow.

| Intent | Command |
|---|---|
| Start full dev stack | `make up` |
| Stop full dev stack | `make down` |
| Restart after edits | `make restart` |
| Sync frontend changes | `make web-sync` |
| Start full test stack (profile=test, all services, `--build`) | `make test-env-up` |
| Stop test stack | `make test-env-down` |
| Start minimal test subset (`api db catalog web`) | `make test-up` |
| Override images for test stack | `INFINITO_NEXUS_IMAGE=... JOB_RUNNER_IMAGE=... make test-up` |
| Override service subset | `TEST_UP_SERVICES="api db" make test-up` |
| Inspect / logs / ps | `make logs`, `make ps` |
| Open shell in service | `docker compose exec <service> bash` (allowed) |

If no target fits, **add a new Makefile target** rather than running `docker compose ...` ad hoc.

## Documentation

See [code.claude.com](https://code.claude.com/docs/en/overview) for further information. For human contributor guidance on working with agents, see [agents.md](docs/contributing/tools/agents.md).
