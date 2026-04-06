# 014 - E2E Test: Deploy web-app-dashboard to a Local Container

## User Story

As a developer, I want an end-to-end Playwright test that verifies a user can set up and deploy `web-app-dashboard` to a fresh local SSH target using the latest locally mounted infinito-nexus so that every CI run proves the full deploy flow works against a real container.

## Image Strategy

| Context | Job runner image |
|---------|-----------------|
| **Local development** | Built from the local `Dockerfile` (or `docker compose build`) so the latest local code is tested. |
| **CI/CD** | Uses the default image configured via `INFINITO_NEXUS_IMAGE` (e.g. `ghcr.io/kevinveenbirkenbach/infinito-debian:latest`); no local build required. |

The `Makefile` or compose profile MUST make this distinction explicit (e.g. via a `make test-local` vs. `make test` target, or an env flag `BUILD_LOCAL=1`).

## Scenario

The test runs against a **fresh workspace** and a **fresh SSH target container** (profile `test`).
The deployer stack uses the locally mounted infinito-nexus repository (`INFINITO_REPO_HOST_PATH=./infinito-nexus`) as the role source — no external role download occurs.
Any bug or code-quality issue discovered while implementing or running this test MUST be fixed and the affected code MUST be brought in line with the project coding rules (see [docs/contributing/code/](../contributing/code/)) before the criterion is marked done.

### Step-by-step click-through

1. **Open the deployer UI** at `http://localhost:3000` (or the configured port).
2. **Verify the start page** shows no existing workspaces (fresh state).
3. **Create a new workspace** via the "New Workspace" button; confirm a workspace ID is assigned and the workspace is selected.
4. **Navigate to the Store** (Software tab).
5. **Search for `dashboard`** in the search field and confirm the `web-app-dashboard` tile is visible.
6. **Select `web-app-dashboard`** by clicking its tile; confirm the tile is highlighted as selected.
7. **Navigate to Devices** (Server tab).
8. **Add a new server** with the following values:
   - Host: `127.0.0.1`
   - Port: `2222` (the `ssh-password` test container port, configurable via `TEST_SSH_PASSWORD_PORT`)
   - SSH user: `root`
   - Authentication: password (value: the fixed test-container password)
9. **Click "Test connection"** on the new server row; confirm ping and SSH both show success.
10. **Navigate to Workspace / Files**.
11. **Click "Generate Inventory"**; confirm the button is active and `inventory.yml` appears in the file browser.
12. **Enter the vault password** in the credentials dialog when prompted; confirm the dialog requires the password twice on first creation.
13. **Click "Generate Credentials"** for `web-app-dashboard`; confirm the file browser updates and no secrets appear in the SSE stream.
14. **Navigate to Deploy**.
15. **Confirm the server row** for `127.0.0.1` is listed and selectable (not already deployed).
16. **Click "Start deployment"**; confirm the terminal becomes active and log lines begin streaming.
17. **Wait for the deployment to complete**; confirm the final status shows success (no error lines, exit code 0).
18. **Open `http://localhost` (or the configured app port)** in the browser; confirm the dashboard is reachable and returns HTTP 200.

## Acceptance Criteria

### Environment & Image

- [ ] Locally, the job runner image is built from the local `Dockerfile` (e.g. via `make test-local` or `BUILD_LOCAL=1 make test`).
- [ ] In CI/CD, the default image (`INFINITO_NEXUS_IMAGE`) is used without a local build step.
- [ ] The distinction between local and CI image is explicit in the `Makefile` or compose configuration; no manual env editing is required.
- [ ] Test stack starts with `docker compose --profile test up -d` and all test containers are healthy before the test begins.
- [ ] The deployer uses the locally mounted infinito-nexus (`INFINITO_REPO_HOST_PATH=./infinito-nexus`) as the role source; no external role download occurs.

### Test Flow

- [ ] A fresh workspace is created at the start of the test; no prior workspace state is present.
- [ ] The `web-app-dashboard` role tile is findable via the store search.
- [ ] Selecting the role highlights the tile and the role appears in the deployment selection.
- [ ] The `ssh-password` test container accepts the connection (ping OK, SSH OK) after credentials are entered.
- [ ] "Generate Inventory" creates `inventory.yml` and at least one `host_vars/` file in the workspace file browser.
- [ ] "Generate Credentials" completes without exposing secrets in the UI, SSE stream, or browser console.
- [ ] The deployment start triggers the job runner and log lines appear in the terminal within 3 seconds.
- [ ] The deployment completes with exit code 0 and the terminal shows a success status.
- [ ] No plaintext passwords, vault passwords, or SSH credentials appear in the log stream or browser network tab.
- [ ] After deployment, `http://localhost` (or the configured port) returns HTTP 200.
- [ ] The entire test flow runs headless in CI with no real external network calls (all targets are local containers).
- [ ] The test is idempotent: re-running it after deleting the workspace produces the same result.
- [ ] Test containers are torn down after the test run.

### Code Quality

- [ ] All bugs and errors discovered while implementing or running this test are fixed before the criterion is marked done.
- [ ] All modified or newly written code conforms to the project coding rules (see [docs/contributing/code/](../contributing/code/)).
- [ ] No linting errors, type errors, or test warnings remain in the affected code paths.
