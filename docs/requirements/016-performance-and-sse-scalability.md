# 016 - Dashboard Warm-Cache Performance & SSE Viewer Scalability

## User Story

As an operator, I want the role-index API and the dashboard view to meet warm-cache latency bounds and the deployment log stream to stay stable under multiple concurrent viewers so that the UI feels responsive and one user watching a deployment cannot break the experience for others.

## Scope

- This requirement covers two non-functional properties of the running deployer stack:
  - warm-cache response time of the role-index API and the dashboard view that consumes it,
  - stability of the SSE deployment-log endpoint under N concurrent viewers attached to the same job.
- Cold-start latency, network transport tuning, browser rendering outside the documented measurement path, and production CDN behaviour are explicitly out of scope.
- Viewers that attach to different jobs concurrently are in scope only insofar as they do not interfere with each other's streams.

## Reference Hardware

- All absolute thresholds in this document target the CI runner class **GitHub Actions `ubuntu-latest` on public repositories** (4 vCPU, 16 GiB RAM, SSD-backed). Private-repo runners (2 vCPU, 7 GiB) are out of scope; re-evaluate thresholds before using them.
- Tests MUST apply the same absolute thresholds on local machines. Tests MUST NOT auto-scale thresholds to local hardware.
- Local runs on slower machines MAY fail these thresholds; that is treated as a local-environment limitation, not a bug.
- If the CI runner class is changed, thresholds in this file MUST be re-evaluated in the same PR.

## Test Placement & Invocation

- Role-index performance test: `tests/python/integration/test_perf_role_index.py` (Python `unittest` + `httpx`).
- SSE scalability test: `tests/python/integration/test_perf_sse_scalability.py` (Python `unittest` + `httpx` async + `asyncio`).
- Dashboard first-paint test: `apps/web/tests/dashboard-perf.spec.ts` (Playwright, reuses `playwright.dashboard.config.ts`).
- A new Make target `test-perf` MUST:
  - bring up the `test` Compose profile via `make test-up`,
  - run the two Python perf tests,
  - run the Playwright perf spec via the existing dashboard config,
  - tear the stack down only if it was started by the target,
  - exit non-zero on any threshold violation.
- `test-perf` MUST be wired into CI as a dedicated job using the same runner class declared in Reference Hardware.

## Prerequisites

- The Web app MUST expose `data-testid="role-tile"` on every rendered role tile in the dashboard view. This attribute is the canonical selector used by the Playwright measurement and MUST NOT be removed by layout refactors without updating this requirement.
- Clients measure the role-index API from Python on the host (not inside a container) via `httpx` against `http://localhost:${API_PORT}` where `API_PORT` is the host-published port of the `api` service in the `test` Compose profile. Measuring from inside the Compose network is out of scope, because it does not reflect the browser's real path.

## Warm-Cache Definition

- A cache is "warm" when the role index has been loaded at least once after the last relevant source change and no cache-invalidating event has occurred since.
- A measurement run MUST issue at least **5 non-measured warm-up requests** before recording any sample.
- Cache invalidation sources that MUST reset warm state before measurement:
  - `roles/list.json` mtime change,
  - `roles/categories.yml` mtime change,
  - TTL expiry of the in-memory index.
- Tests MUST NOT modify source files between warm-up and measurement.

## Performance Targets

### Role-index API

- [ ] `GET /api/roles` p95 < 200 ms on a warm cache over a sample of exactly 200 sequential requests issued from the Python test process on the host against `http://localhost:${API_PORT}`.
- [ ] `GET /api/roles/{role_id}` p95 < 100 ms on a warm cache over a sample of exactly 200 sequential requests, each using a role ID selected uniformly from the indexed set, against the same host-local endpoint.
- [ ] No measured request exceeds 1 000 ms on a warm cache.

### Dashboard view

- [ ] The dashboard route shows role tiles in the DOM within 1 000 ms of `page.goto`, measured by Playwright waiting for the locator `[data-testid="role-tile"]` to have count ≥ 1 on a warm cache.
- [ ] Measurement runs against the local UI build served by the `web` service in the `test` Compose profile; no production CDN, no service worker, no external font/CSS hosts.
- [ ] The browser context is freshly created per measurement (no bfcache reuse across samples).

## SSE Viewer Scalability

### Load-Generator Job

- [ ] A test fixture playbook at `tests/fixtures/perf/emit_lines.yml` MUST exist.
- [ ] The playbook MUST emit at least 120 log lines over at least 60 s via `ansible.builtin.debug` with a `ansible.builtin.pause: seconds: 0.5` cadence.
- [ ] The playbook MUST run successfully against the `ssh-password` test target from [014-e2e-dashboard-deploy.md](014-e2e-dashboard-deploy.md).
- [ ] The scalability test MUST use this playbook and MUST NOT depend on any real role's runtime behaviour.

### Load Profile

- [ ] The scalability test MUST attach exactly 10 concurrent viewers to the same running deployment job via `GET /api/deployments/{job_id}/logs`.
- [ ] All 10 viewers MUST remain connected until the job reaches a terminal state (`done` event) or 120 s have elapsed, whichever comes first.
- [ ] A late-joining (11th) viewer MUST attach at t ≥ 30 s after job start and MUST remain until the terminal state.

### Stability Assertions

- [ ] The API process does not crash, restart, or log unhandled exceptions during or after the load profile. The test MUST assert `docker compose ps api` reports state `running` with the same start time before and after the run.
- [ ] No viewer connection is closed by the server before the terminal `done` event, unless the client initiates the disconnect. Any server-initiated close during the run is a failure.
- [ ] While the load profile is active, `GET /api/roles` issued every 5 s from outside the viewer set MUST continue to meet its warm-cache p95 target measured over the active window.

### Coherent-Stream Contract

- [ ] Every payload received by every viewer MUST parse as a valid SSE event (framed by `\n\n`, each line in `event:|data:|id:|retry:` form or a blank terminator).
- [ ] Every `data:` payload MUST be valid JSON and its `type` field MUST be one of `log`, `status`, `done`.
- [ ] If the payload includes a numeric `seq`, `seq` MUST be monotonically non-decreasing within a single viewer's received stream.
- [ ] No viewer MUST receive an `event: error` frame during a successful run.
- [ ] The late-joining viewer MUST receive only events emitted at or after its attachment timestamp until the terminal state. Historic replay is not required; if replay is present it MUST respect the masking rules from existing requirements.

### Latency Under Load

- [ ] The 30-second runner-emission-to-UI-rendering bound from [014-e2e-dashboard-deploy.md](014-e2e-dashboard-deploy.md) (Test Harness Contract) MUST continue to hold for every viewer throughout the load profile.
- [ ] The test MUST measure per-line delay between `emit_lines.yml` emission (inferred from the playbook's monotonically increasing line counter) and viewer reception, and MUST fail the run if any single line exceeds 30 s for any viewer.

### Memory Assertions

- [ ] Baseline memory is the max of `docker stats --no-stream --format '{{.MemUsage}}'` on the `api` container sampled once per second during the 30 s immediately before the scalability scenario starts.
- [ ] Post-test memory is sampled at the same cadence during the 60 s immediately after the last viewer disconnects.
- [ ] Post-test max MUST be ≤ baseline max × 1.2.
- [ ] Values MUST be parsed to MiB (binary).

## Test Harness Contract

- All three tests MUST run inside or against the existing `test` Compose profile; no dedicated perf environment is introduced.
- All three tests MUST run headless in CI and MUST NOT require external network access.
- Raw measurements (per-request timings, per-viewer per-line delays, memory samples) MUST be written to `state/perf/016/<test-name>.json` with schema:
  - `samples: [{name, value_ms | value_mib, timestamp}]`,
  - `summary: {p50, p95, p99, max, count}` for timing tests,
  - `thresholds: {<name>: {target, observed, status}}`,
  - `status: "pass" | "fail"`.
- The Make target MUST exit non-zero if any `status: "fail"` is present in any output file.
- Per-test output files MUST also be surfaced as CI artifacts when the job fails.

## Acceptance Criteria

### Harness & Placement

- [ ] `tests/python/integration/test_perf_role_index.py` exists and runs under the existing unittest runner.
- [ ] `tests/python/integration/test_perf_sse_scalability.py` exists and runs under the existing unittest runner.
- [ ] `apps/web/tests/dashboard-perf.spec.ts` exists and runs under the existing Playwright dashboard config.
- [ ] `tests/fixtures/perf/emit_lines.yml` exists and satisfies the Load-Generator Job rules.
- [ ] `make test-perf` exists, orchestrates the three tests as specified, and exits non-zero on any threshold violation.
- [ ] CI runs `make test-perf` as a dedicated job on the reference runner class.

### Role-index Performance

- [ ] Warm-cache `GET /api/roles` p95 < 200 ms is measured over 200 samples and asserted in CI.
- [ ] Warm-cache `GET /api/roles/{role_id}` p95 < 100 ms is measured over 200 samples and asserted in CI.
- [ ] No warm-cache request exceeds 1 000 ms during the measurement run.
- [ ] Cache invalidation on `roles/list.json` mtime change is verified: the first post-invalidation request may exceed the warm target; subsequent requests meet it again.

### Dashboard Load

- [ ] Playwright waits for `[data-testid="role-tile"]` count ≥ 1 within 1 000 ms on a warm cache and fails the run if the bound is violated.
- [ ] The dashboard measurement uses the `test` Compose profile's `web` service.
- [ ] Each sample uses a fresh browser context.

### SSE Scalability

- [ ] The scalability test attaches exactly 10 concurrent viewers plus one late-joiner to a job running `emit_lines.yml`.
- [ ] No viewer is disconnected by the server before the `done` event.
- [ ] During the load profile, `GET /api/roles` continues to meet its warm-cache p95 target.
- [ ] Post-test API memory max ≤ baseline max × 1.2 within the post-test sampling window.
- [ ] Every viewer's received stream satisfies the Coherent-Stream Contract.
- [ ] Every line's emission-to-reception delay is ≤ 30 s for every viewer.

### Observability

- [ ] Each test writes `state/perf/016/<test-name>.json` matching the documented schema.
- [ ] `make test-perf` surfaces output files as CI artifacts on failure.
- [ ] Failure messages name the specific violated threshold, observed value, and sample context.

### Security

- [ ] Masking rules from existing requirements continue to hold for every viewer under load; no plaintext secret, vault password, or SSH key material appears in any SSE stream or in any `state/perf/016/*.json` output during the scalability test.
