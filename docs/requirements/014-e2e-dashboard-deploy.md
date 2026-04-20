# 014 - E2E Test: Deploy web-app-dashboard to a Local Container

## User Story

As a developer, I want a headless Playwright end-to-end test that drives the real deployer UI against the local Docker Compose test stack and verifies that `web-app-dashboard` can be deployed to the local `ssh-password` target using the intended infinito source for the current mode so that every CI run proves the full deploy flow against a real SSH-accessible container.

## Test Mode

- This requirement covers the **anonymous workspace flow** only.
- Persistent workspace listing, the authenticated "New workspace" button, and reload persistence are already covered by [007-optional-auth-persistent-workspaces.md](007-optional-auth-persistent-workspaces.md).
- In anonymous mode, the UI MUST auto-create a fresh workspace on first load.
- "Fresh state" therefore MUST mean:
  - a clean browser context,
  - no visible persistent workspace list or switcher,
  - a newly assigned workspace ID in the Inventory panel after the page bootstraps.

## Local Target Contract

- The deployment target for this requirement MUST be the `ssh-password` service from the Docker Compose `test` profile.
- Because connection checks and deployment execution run from containers inside the Compose network, the canonical target values for the happy path MUST be:
  - Host: `ssh-password`
  - Port: `22`
  - SSH user: `deploy`
  - Authentication: password
  - Password: `deploy`
- The host-side port mapping `127.0.0.1:${TEST_SSH_PASSWORD_PORT:-2222}` is a debugging convenience for humans and MUST NOT be used as the canonical host/port inside the UI or API for this test.
- If the final deployed dashboard is asserted from the host browser, the test profile MUST expose a dedicated HTTP port for the deployed target via an explicit env variable.
- If the final deployed dashboard is not exposed to the host, the test harness MUST perform the final HTTP 200 assertion from a process attached to the same Docker network as the deployed target.

## Source and Image Strategy

### Local development

- Local execution MUST use the local `./infinito-nexus` checkout as the role source for both:
  - catalog generation,
  - containerized deployment jobs.
- Local execution MUST use a locally built job-runner image from the relevant `Dockerfile`, not only a prebuilt registry image.
- The local helper command MUST resolve any repo path that needs to be absolute for containerized jobs automatically. Manual `.env` editing MUST NOT be required.
- Local execution MUST fail fast with a clear error if `./infinito-nexus` is missing or empty.

### CI/CD

- CI execution MUST use the default image configured via `INFINITO_NEXUS_IMAGE`.
- CI execution MUST NOT depend on a host-mounted local checkout.
- CI execution MUST NOT require manual environment mutation.

### Invocation

- The repository MUST expose explicit entry points for:
  - local dashboard E2E execution,
  - CI dashboard E2E execution.
- The exact command names are implementation-defined, but they MUST be documented and wired into CI.

## Test Harness Contract

- The happy-path Playwright test MUST exercise the real frontend, API, workspace storage, job runner, SSE log stream, and SSH target.
- The happy-path test MUST NOT stub or mock these local deployer endpoints:
  - `/api/roles`
  - `/api/workspaces`
  - `/api/workspaces/{workspace_id}/generate-inventory`
  - `/api/workspaces/{workspace_id}/test-connection`
  - `/api/workspaces/{workspace_id}/credentials`
  - `/api/deployments`
  - `/api/deployments/{job_id}/logs`
- The test harness MAY use non-browser helpers to:
  - start and stop the Compose stack,
  - wait for health checks,
  - run the final network-local HTTP assertion when the deployed app is not host-exposed,
  - collect traces, logs, or artifacts on failure.
- The test MUST run headless in CI.
- The test MUST NOT require any real external network calls for its happy path.
- The live log stream MUST be delivered in realtime. The delay between a log event being emitted by the job runner and being rendered in the UI MUST NOT exceed 30 seconds, and the test MUST verify this bound explicitly. Clock source for this measurement: the playbook MUST emit a monotonic counter and the playbook-start wall-clock timestamp in its first line; the runner's stdout writer MUST prepend a server-side receive timestamp to every line (format `[RX:<unix_ms>] ...`); the UI harness compares the server-side receive timestamp to the harness's own `Date.now()` at the moment the line is rendered. This isolates the runtime-to-UI leg from Ansible's own scheduling jitter.

## Scenario

The test runs against:

- a clean browser context,
- an anonymous session,
- a fresh auto-created workspace,
- a fresh `docker compose --profile test up -d` stack,
- the `ssh-password` local target,
- the configured infinito source for the current mode.

Any bug or code-quality issue discovered while implementing or running this test MUST be fixed before this requirement is marked done.

### Step-by-step click-through

- [x] 1. Start the deployer stack and the `test` profile; wait until all required services are healthy before the browser test begins.
- [x] 2. Open the deployer UI at `http://127.0.0.1:3000` or the configured web port in a clean browser context.
- [x] 3. Verify the anonymous start state:
   - no persistent workspace list or workspace switcher is visible,
   - a new workspace ID is assigned automatically in the Inventory section.
- [x] 4. Navigate to **Software**.
- [x] 5. Search for `dashboard` and confirm the `web-app-dashboard` tile is visible.
- [x] 6. Select `web-app-dashboard` and confirm the role becomes selected in the UI.
- [x] 7. Navigate to **Hardware**.
- [x] 8. Switch from **Customer** mode to **Expert** mode and confirm the expert-mode warning dialog.
- [x] 9. Add a new server and enter the canonical target values from the Local Target Contract.
- [x] 10. Commit the connection fields and credentials; confirm the UI reports successful connectivity.
- [x] 11. If the success details are shown in a detail view instead of inline, confirm both `Ping` and `SSH` report success there.
- [x] 12. Navigate to **Inventory**.
- [x] 13. Wait for inventory creation to complete; confirm `inventory.yml` appears and at least one matching `host_vars/<alias>.yml` file exists.
- [x] 14. Open `Credentials` -> `App credentials`.
- [x] 15. Choose the generate action for the selected app.
- [x] 16. On the first vault creation for the workspace, confirm the credentials-vault dialog requires the master password twice before continuing.
- [x] 17. Finish credential generation and confirm the file browser updates while no secrets appear in the visible UI.
- [x] 18. Navigate to **Setup**.
- [x] 19. Confirm the `ssh-password` target row is listed, not already deployed, and selectable.
- [x] 20. Start the deployment using the deploy action on the Setup screen.
- [x] 21. Confirm the live terminal/log view becomes active and starts receiving log lines within 3 seconds.
- [x] 22. Wait until the deployment finishes successfully; confirm success status and exit code `0`.
- [x] 23. Perform the final dashboard reachability check:
   - use the host-exposed HTTP endpoint when the test profile publishes one, or
   - use the network-local test harness path otherwise.
- [x] 24. Confirm the deployed dashboard responds with HTTP `200`.

## Acceptance Criteria

### Environment and Source

- [x] Local execution uses the local `./infinito-nexus` checkout as the role source for both catalog generation and deployment jobs.
- [x] Local execution uses a locally built job-runner image instead of only a registry image.
- [x] Local execution resolves required absolute host paths automatically; no manual `.env` editing is required.
- [x] Local execution fails fast with a clear error when `./infinito-nexus` is missing or empty.
- [x] CI execution uses `INFINITO_NEXUS_IMAGE` without depending on a host-mounted local checkout.
- [x] The repository exposes explicit local and CI entry points for this dashboard E2E flow.
- [x] The test stack starts with `docker compose --profile test up -d` and all required test containers are healthy before the browser flow begins.
- [x] Test containers are torn down after the test run.

### Harness Rules

- [x] The happy-path Playwright test uses the real local API, workspace store, job runner, SSE log stream, and SSH target instead of mocked happy-path responses.
- [x] The happy-path test does not stub the core deployer endpoints involved in roles, workspaces, inventory creation, connection testing, credentials, deployment creation, or deployment logs.
- [x] The entire flow runs headless in CI with no real external network calls.
- [x] The test harness may use non-browser helpers only for stack orchestration, health waiting, final network-local HTTP assertion, and artifact capture.

### Workspace and UI Flow

- [x] A clean anonymous browser session starts with no visible persistent workspace list and an auto-created fresh workspace ID.
- [x] The `web-app-dashboard` role tile is findable via the Software search.
- [x] Selecting `web-app-dashboard` visibly marks it as selected in the UI.
- [x] The Hardware flow explicitly switches to Expert mode before manual SSH details are entered.
- [x] The `ssh-password` test container accepts the canonical connection values `ssh-password:22` with `deploy/deploy`.
- [x] Successful connectivity is visible in the UI, and where detailed connection output is shown it reports both `Ping` OK and `SSH` OK.
- [x] Inventory creation completes and produces `inventory.yml` plus at least one matching `host_vars/<alias>.yml` file in the workspace.
- [x] App credentials are generated through the Inventory `Credentials` -> `App credentials` flow.
- [x] On first vault creation, the master-password dialog requires the password twice before credential generation proceeds.
- [x] Credential generation completes without exposing plaintext secrets in the visible UI, browser console, browser network payloads, or SSE stream.
- [x] The Setup screen lists the target row as selectable and not already deployed before deployment starts.
- [x] Starting deployment activates the live terminal/log view and emits log lines within 3 seconds.
- [ ] Live log streaming is realtime: the measured delay between a runner-emitted log event and its UI rendering never exceeds 30 seconds, and the test fails the run if the bound is violated.
- [x] The deployment completes with exit code `0` and a visible success state.
- [x] The final deployed dashboard responds with HTTP `200` via the deterministic endpoint defined by the test stack or harness.
- [ ] Re-running the test from a fresh anonymous browser context and fresh workspace state produces the same successful result.

### Security and Quality

- [x] No plaintext SSH passwords, vault passwords, private keys, or generated credentials appear in logs, SSE events, browser console output, or browser network payloads.
- [ ] All bugs or warnings (inside the deployer-repository) discovered while implementing this flow are fixed before the requirement is marked done.
- [x] All modified or newly written code conforms to the project coding rules.
- [x] No lint errors, type errors, or test warnings remain in the affected code paths.

## Temporary Debug Artifacts

The following changes are iteration-only diagnostics added while hunting intermittent connection and streaming failures during this requirement. They MUST be reverted before this requirement is marked done.

| Location | Change | Purpose | Revert target |
|---|---|---|---|
| [apps/api/main.py](../../apps/api/main.py) | `_trace_requests` HTTP middleware that prints `TRACE: IN/OUT/ERR` with timings to stderr for `/credentials`, `/test-connection`, `/connection`, `/primary-domain` request paths | Diagnose hanging requests on credential and connection-test paths during E2E iteration | Remove the middleware and the `logger = logging.getLogger("api.trace")` line; keep CORS + router wiring |
| [apps/api/Dockerfile](../../apps/api/Dockerfile) | `uvicorn ... --timeout-keep-alive 120` (24× the default 5s) | Prevent keep-alive drops while debugging long deploy streams | Drop the `--timeout-keep-alive 120` flag from the `CMD` |

Rules:

- These artifacts MUST NOT be committed outside of an E2E-iteration branch.
- Once the final E2E run is green (`Final status: Succeeded`, exit `0`, dashboard `HTTP 200`), a cleanup commit MUST revert both items before the requirement is checked off.
- Re-adding either item in the future REQUIRES a new entry in this table with a concrete revert deadline.
