# Iteration 🔁

## Loop 🔁

One iteration = one attempted change, from the first edit to the closing verification. Inside an iteration you MAY run many fast edit-fix cycles; the iteration is only finished when the closing verification passes.

1. Unless the user explicitly says to reuse the existing setup, you MUST start once with `make setup` to establish a clean baseline (copies `.env` from `env.example`, creates `state/`, and starts the stack).
2. Edit-fix cycles inside the iteration:
   - You MUST use `make restart` as the default edit-fix-redeploy step.
   - For frontend-only changes, you MUST use `make web-sync` instead of a full restart. This rebuilds and syncs the Next.js app into the running `web` container without cycling the whole stack.
   - For catalog-only changes, you MUST use `make refresh-catalog` instead of a full restart.
   - You MUST NOT rerun `make setup` merely because a step failed or code changed. That restarts the stack unnecessarily.
   - If the same failure still reproduces on the restart path and you want to rule out stale state, you MAY run `make clean` followed by `make setup` once, then you MUST return to `make restart`.
3. Closing verification — MUST be the last step of every iteration:
   - You MUST run `make e2e-dashboard-local`. This is the authoritative regression gate for any change touching the UI, API, workspace store, job runner, or SSE stream.
   - On failure, the iteration is NOT done. You MUST return to step 2 and iterate further. You MUST NOT mark requirement criteria done on the basis of a partial smoke check when the dashboard E2E has not passed on the final state.
   - Only after a green `make e2e-dashboard-local` run MAY you consider the iteration complete and move on.

## Database 🗄️

- You MUST use `make db-up` and `make db-wait` to start and verify the Postgres service in isolation.
- You MAY use `make db-psql` to open an interactive psql session for ad-hoc inspection.
- You SHOULD use `make db-logs` to tail Postgres logs when a database issue is suspected.

## Inspect 🔎

- Before you redeploy, you MUST complete all available inspections first. You MUST check the live local output (`make logs`), container logs, and current application state so the original state stays visible.
- To inspect files or run commands inside a running container, you MUST use `docker compose exec <service> bash` or `docker compose exec -T <service> sh -c '<cmd>'`.
- To compare workspace permissions inside the `api` container vs on the host filesystem, you MUST use `make debug-workspace-perms WORKSPACE_ID=<id>` instead of running raw `docker exec` + `docker run -v ... alpine` pairs by hand.
