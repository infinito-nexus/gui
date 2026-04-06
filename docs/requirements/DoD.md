# Definition of Done (DoD)

A feature, milestone, or change is **Done** when **all** criteria below are met.

---

## 1. Functional Completion

* All defined **Acceptance Criteria** are fully satisfied.
* Feature works **end-to-end** (UI → API → Runner → State/Logs).
* Error cases are handled gracefully (no unhandled 4xx/5xx from user input).

---

## 2. Testing (Mandatory)

### Unit Tests

* Unit tests exist for all new or changed logic.
* Covered paths:

  * Happy path
  * Edge cases
  * Error handling
  * Secret masking / redaction
* Tests are deterministic and isolated (mock FS, subprocess, env, time).
* All unit tests pass locally and in CI.

### Integration Tests

* Role index loading & filtering (incl. cache invalidation).
* Workspace lifecycle (create → edit → ZIP export).
* Credential generation (`infinito create credentials`).
* Deployment jobs (start, state transitions, cancel).
* SSE log streaming (ordering + masking).

Alles klar — hier ist die **präzisierte, nicht-allgemeine** Fassung, klar auf **Frontend-Logik und UI-Elemente** fokussiert:

### UI Tests (Playwright – Required)

* UI behavior is covered by automated **Playwright** tests.
* Tests focus **exclusively on frontend logic and UI elements**, not backend correctness.
* Covered aspects include:

  * Rendering of core UI components (tiles, forms, dialogs, status indicators).
  * User interactions (click, select, input, toggle) and resulting UI state changes.
  * Client-side filtering, search, and selection state persistence.
  * Visibility and enable/disable logic of buttons and steps (e.g. inventory-first flow).
  * Navigation between views and tabs without page reloads.
  * Live views correctly attaching to streams (connection established indicator).
* Tests assert **DOM state, CSS classes, text content, and UI transitions**.
* Network calls may be stubbed or mocked where appropriate.
* Tests run headless and are fully CI-compatible.
* No real secrets are used; any credentials are mocked or generated per test run.

---

## 3. Security

* Secrets never appear in:

  * Logs
  * SSE streams
  * API responses
  * ZIP exports
* Secrets are stored only **job/workspace-local and temporarily**.
* Strict input validation (paths, JSON/YAML, IDs).
* Correct file permissions (e.g. SSH keys `0600`).
* CORS restricted to the UI origin.

---

## 4. Stability & Performance

* `/api/roles` is fast on warm cache (target <200ms).
* SSE supports multiple viewers without crashes or leaks.
* API restarts do not corrupt running or finished jobs.
* Job state transitions are consistent and tested.

---

## 5. Observability

* Logs are readable and “docker-like”.
* Clear job states and status events.
* Failures include actionable error messages (no secrets).

---

## 6. Code Quality

* Linting, formatting, and type checks pass.
* No unused code, dead flags, or unresolved TODOs.
* Code is modular and maintainable.

---

## 7. Documentation

* README and setup instructions are up to date.
* `env.example` is complete.
* Security model is documented.
* API documented via OpenAPI (Swagger).

---

## 8. Release Readiness

* CI pipeline is fully green (Unit, Integration, **Playwright UI tests**).
* Changelog / release notes updated.
* No secrets or state files committed.
