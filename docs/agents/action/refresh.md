# Refresh Containers After Edits 🔄

After every source edit that affects code running inside a container, the agent MUST run the matching refresh target **before** declaring the edit complete or running verification against the live stack. Host-side edits are NOT auto-synced into the running containers, so skipping this step leads to verifying stale code.

For the canonical edit-fix-redeploy loop and the closing verification gate, the SPOT is [iteration.md](iteration.md). This file is the rule; `iteration.md` is the workflow.

## Refresh Matrix 🧭

| Edit scope | Required refresh | Why |
|---|---|---|
| `apps/api/**` (Python, FastAPI, services) | `make restart` | Python source is baked into the `api` image; restart cycles the container so the new code is loaded. |
| `apps/web/**` (Next.js, React, CSS) | `make web-sync` | Rebuilds and syncs the Next.js app into the running `web` container without cycling the whole stack. |
| Role catalog (`apps/api/services/role_index/**`, `roles/**`) | `make refresh-catalog` | Rebuilds the catalog index without a full stack restart. |
| `Dockerfile` / `docker-compose.yml` / build context for any image | `make restart` | Compose detects the image-context change and rebuilds; a plain restart without rebuild would run stale layers. |
| `scripts/e2e/**` (harness shell scripts) | No live container | Picked up on the next harness invocation. |
| Workflows (`.github/workflows/**`), repo docs (`docs/**`, `README.md`), top-level scripts not exercised by the running stack | No refresh needed | Not consumed by any running container. |

## Rules 📏

- The agent MUST NOT run e2e tests, smoke checks, or any verification that exercises the live stack until the matching refresh has completed successfully.
- The agent MUST NOT use `make setup` as the refresh path. `setup` is for establishing a clean baseline once per session — see [iteration.md](iteration.md).
- When an edit spans multiple scopes (e.g. an `apps/api/**` change AND an `apps/web/**` change in the same iteration), the agent MUST run both targets. Order: backend first (`make restart`), then frontend (`make web-sync`), so the web layer syncs against an already-restarted API.
- If a refresh target fails, the agent MUST treat that as the current failure to debug — not a transient warning to retry. See [debug.md](debug.md).
- If no Make target fits the edit scope, the agent MUST add a new Make target rather than running raw `docker compose ...` ad hoc. See [CLAUDE.md](../../../CLAUDE.md) (Stack & Compose Operations).
