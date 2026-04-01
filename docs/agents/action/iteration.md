# Iteration

Use this page when you are iterating on a local change during debugging or development.

## Loop

- Unless the user explicitly says to reuse the existing setup, start once with `make setup` to establish a clean baseline (copies `.env` from `env.example`, creates `state/`, and starts the stack).
- After that, use `make restart` for the default edit-fix-redeploy loop.
- Do NOT rerun `make setup` just because a step failed or you changed code. That restarts the stack unnecessarily and burns time.
- For frontend-only changes, use `make web-sync` instead of a full restart. This rebuilds and syncs the Next.js app into the running `web` container without cycling the whole stack.
- For catalog-only changes, use `make refresh-catalog` instead of a full restart.
- If the same failure still reproduces on the restart path and you want to rule out stale state, use `make clean` followed by `make setup` once.
- After that targeted clean-rebuild, return to `make restart` for subsequent iterations.

## Database

- Use `make db-up` and `make db-wait` to start and verify the Postgres service in isolation.
- Use `make db-psql` to open an interactive psql session for ad-hoc inspection.
- Use `make db-logs` to tail Postgres logs when a database issue is suspected.

## Inspect

- Before you redeploy, you MUST complete all available inspections first. Check the live local output (`make logs`), container logs, and current application state so the original state stays visible.
- To inspect files or run commands inside a running container, use `docker compose exec <service> bash` or `docker compose exec -T <service> sh -c '<cmd>'`.
