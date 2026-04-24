# 017 - Security Hardening: Job Isolation, Secret Lifecycle, Container & Transport Policy

## User Story

As an operator running the deployer against real infrastructure, I want every deployment to execute in a dedicated, isolated, short-lived container with a strict secret lifecycle, hardened transport, a minimal control plane, and verifiable masking so that a single compromised or buggy job cannot leak credentials, tamper with other jobs, or escape its sandbox.

## Scope

- This requirement consolidates cross-cutting security properties that are not owned by any single feature requirement:
  - job runner isolation,
  - container lifecycle control plane,
  - secret lifecycle and storage,
  - workspace isolation at the security boundary,
  - transport, auth, and CORS,
  - input validation and path safety,
  - supply chain / image integrity,
  - network egress enforcement,
  - container hardening,
  - cancellation & cleanup,
  - dependency hygiene.
- Masking and audit-logging rules are owned by [012-log.md](012-log.md) and [014-e2e-dashboard-deploy.md](014-e2e-dashboard-deploy.md); this file references them, MUST NOT duplicate them, and MUST NOT relax them.
- Vulnerability reporting is owned by [SECURITY.md](../../SECURITY.md) and is out of scope here.

## Threat Model

- **Assets**: SSH private keys, SSH passwords, vault master passwords, KDBX contents, generated application credentials, target-server access.
- **Primary actors**:
  - anonymous UI user of the local stack,
  - authenticated UI user behind OAuth2 Proxy (see [007-optional-auth-persistent-workspaces.md](007-optional-auth-persistent-workspaces.md)),
  - malicious input in role metadata, inventory, or uploaded ZIP,
  - compromised job runner (e.g. a role executing unexpected code),
  - network-adjacent attacker on the host.
- **Out of scope**: hardening of the target servers themselves, hardening of the Ansible roles under deployment, physical attacks on the host.

## Service UIDs

- `api` runs as UID `10001`, created in its Dockerfile with a matching `/etc/passwd` entry.
- `runner-manager` runs as UID `10003`, created in its Dockerfile.
- Runner containers run as UID `10002`, created in the runner image.
- A shared group `infinito-manager` with GID `10900` MUST exist in both `api` and `runner-manager` images; UID `10001` and UID `10003` MUST both be members of this group. It is the single mechanism for cross-service read access to the `manager-auth` volume.
- Volumes whose files must be read or written by a given service MUST be owned by that service's UID; files shared between `api` and `runner-manager` MUST use owner UID `10003`, group GID `10900`, mode `0440`.

## 1. Job Runner Isolation

### 1.1 One Container Per Deployment

- [x] Every accepted `POST /api/deployments` MUST start a dedicated job-runner container whose lifetime is bounded by that single job.
- [x] The API MUST NOT reuse a runner container across two jobs, even when both target the same host, workspace, or role set.
- [x] Parallel deployments from the same workspace MUST run in separate containers, not as multiple processes inside one runner.
- [x] A runner container MUST terminate (exit, not just idle) within 10 s after the job reaches a terminal state (`done`, `failed`, or `cancelled`).
- [x] A runner container MUST NOT accept any new workload command or new mount after its single job starts; only terminal signals issued by `runner-manager` for cancellation and cleanup are permitted.

### 1.2 Container Identity

- [x] Each runner container MUST carry labels that uniquely identify the owning job:
  - `infinito.deployer.job_id=<uuid>`,
  - `infinito.deployer.workspace_id=<id>`,
  - `infinito.deployer.role=job-runner`.
- [x] `runner-manager` MUST reject any operation on a runner whose `infinito.deployer.workspace_id` label does not match the `workspace_id` carried by the request. This MUST hold in anonymous and OAuth2-authenticated modes alike.

### 1.3 No Host Privilege

- [x] Runner containers MUST run as UID `10002` (non-root).
- [x] Runner containers MUST drop all Linux capabilities and MUST NOT re-add `CAP_NET_ADMIN`, `CAP_SYS_ADMIN`, `CAP_DAC_OVERRIDE`, or `CAP_SETUID`.
- [x] Runner containers MUST run with `--read-only` root filesystem, writable only on mounted job-workspace volumes and `/tmp` (tmpfs, size-capped at 64 MiB).
- [x] Runner containers MUST NOT have access to the Docker socket or to any container runtime API.
- [x] Runner containers MUST NOT use `--privileged`, `--pid=host`, `--network=host`, or bind-mount `/var/run/docker.sock`.

## 2. Container Lifecycle Control Plane

### 2.1 Dedicated runner-manager Service

- [x] A dedicated `runner-manager` service MUST exist in `docker-compose.yml`, running on the internal Compose network.
- [x] `/var/run/docker.sock` MUST be bind-mounted ONLY into `runner-manager`. The API, the web service, the database, and every runner MUST NOT have access to this socket.
- [x] `runner-manager` MUST expose a narrow internal HTTP API on `runner-manager:8001`. No port MUST be published to the host in production.
- [x] The internal API surface is exactly:
  - `POST /jobs` — create a runner for a job spec,
  - `DELETE /jobs/{job_id}` — cancel a running job,
  - `GET /jobs/{job_id}` — return status,
  - `GET /jobs?workspace_id=<id>&status=running` — list running jobs, used as the source of truth for concurrency limits,
  - `GET /jobs/{job_id}/logs` — stream stdout/stderr.
- [x] The API surface MUST NOT proxy arbitrary Docker commands and MUST NOT accept image names, volume mounts, or capability lists not declared in the job spec schema.
- [x] The job spec schema MUST be a Pydantic model with the explicit fields: `job_id` (UUIDv4), `workspace_id` (opaque ID), `runner_image` (image reference string; MUST be digest-pinned in CI and production, and MAY be tag-based only for the local source-directory build flow from [015-image-build-from-local-source.md](015-image-build-from-local-source.md)), `inventory_path` (workspace-relative), `secrets_dir` (host tmpfs path), `role_ids` (list of allowed-regex strings), `network_name` (string matching `^job-[0-9a-f\-]{36}$`), `labels` (dict of the three documented labels only). Any additional field MUST be rejected.

### 2.2 Authentication Between API and runner-manager

- [x] The API MUST authenticate to `runner-manager` with a shared token. The token MUST be read at request time from a file path provided by env `MANAGER_TOKEN_FILE` (default `/run/manager/token`). The token MUST NOT be hard-coded or logged.
- [x] A dedicated init service `init-manager-token` MUST run once per stack startup, generate a 256-bit random token (`openssl rand -hex 32`), and write it to the `manager-auth` named volume at `/auth/token` with mode `0440`, owner UID `10003`, group GID `10900` (`infinito-manager`). The init image MUST declare the same UID/GID entries so `chown 10003:10900` and `chmod 0440` succeed without a numeric-only fallback.
- [x] Both `api` and `runner-manager` MUST mount `manager-auth` read-only; the API reads via its `infinito-manager` (GID `10900`) group membership, the manager reads as owner UID `10003`.
- [x] `init-manager-token` MUST overwrite the token on every stack restart. Token rotation therefore happens on every `make up` / `make restart`.
- [x] `runner-manager` MUST reject any request missing or mismatching the token with HTTP `401`.

## 3. Secret Lifecycle

### 3.1 Storage

- [x] Generated application credentials MUST persist only in `secrets/credentials.kdbx` inside the workspace, consistent with existing `KeePassXC Credentials Vault` rules; any per-job copy outside the workspace MUST be ephemeral runtime transport material and MUST be deleted again at terminal state.
- [x] No plaintext password file MUST exist on disk outside the KDBX at any time, including during generation; intermediate buffers MUST reside only in process memory.
- [x] SSH private keys written to the workspace MUST have mode `0600` and are written by the `api` service running as UID `10001`.
- [x] The vault master password MUST NOT be persisted to regular disk by the API; ephemeral tmpfs staging under `/dev/shm` for subprocess compatibility is permitted and MUST be removed before the request returns.

### 3.2 Transport Into the Runner (tmpfs Convention)

Concrete path and file schema:

- [x] The API MUST materialize per-job secrets at `state/jobs/<job_id>/secrets/` on the host side.
- [x] This host-side staging directory MUST be owner-only (`0700`) and used only as short-lived API staging; `runner-manager` MUST then copy its contents into an 8 MiB tmpfs Docker volume mounted `noexec,nosuid,nodev` for the runner.
- [x] `runner-manager` MUST mount this directory into the runner container read-only at the target path `/run/secrets/infinito/`.
- [x] The following file layout MUST be used when the corresponding secret exists for the job:
  - `/run/secrets/infinito/ssh_key` — private key, mode `0400`, owner `10002`,
  - `/run/secrets/infinito/ssh_password` — plaintext SSH password, mode `0400`, owner `10002`,
  - `/run/secrets/infinito/vault_password` — vault master password, mode `0400`, owner `10002`,
  - `/run/secrets/infinito/credentials.kdbx` — ephemeral KDBX copy, mode `0400`, owner `10002`.
- [x] Runners MUST receive only the env variable `INFINITO_SECRETS_DIR=/run/secrets/infinito`. Individual secret values MUST NOT be passed via env, command-line arguments, or stdin.
- [x] Host-side staged secret files MUST be unlinked and the runner tmpfs secret volume MUST be removed no later than 5 s after the runner's terminal state is observed, regardless of success or failure.
- [x] No secret-bearing file MUST survive an API restart; on startup the API MUST purge orphaned secret directories from prior runs.

### 3.3 Ansible Plumbing (Bridge from Secret Files to Inventory)

The runner bootstrap is responsible for turning the files in `INFINITO_SECRETS_DIR` into Ansible-usable inventory variables, so that role authors never handle raw secrets.

- [x] The runner startup path MUST execute a hardened bootstrap before `ansible-playbook`.
- [x] The bootstrap MUST generate `/run/inventory/group_vars/all/_secrets.yml` on a tmpfs mount inside the runner, mode `0400`, owner `10002`.
- [x] The generated file MUST populate only the secret-bridge keys supported by the runner bootstrap, and only for secrets that exist:
  - `ansible_ssh_private_key_file` pointing at the tmpfs-mounted SSH key path,
  - `ansible_password` and `ansible_ssh_pass` via `lookup('file', '/run/secrets/infinito/ssh_password')`,
  - `ansible_become_pass` and `ansible_become_password` via the same `lookup('file', ...)` bridge when an SSH password exists,
  - `infinito_vault_password_file: /run/secrets/infinito/vault_password`.
- [x] The generated file MUST NOT contain any literal secret value; password-bearing vars MUST use `lookup('file', ...)`, while file-path vars MAY point directly to the tmpfs-mounted secret file.
- [x] The bootstrap MUST NOT write the generated file to any workspace volume or any path that is included in git autosave.
- [x] The bootstrap MUST unlink `_secrets.yml` on exit via a `trap` on `EXIT`, independent of success or failure.
- [x] Ansible's `ANSIBLE_VAULT_PASSWORD_FILE` env MUST be set to `/run/secrets/infinito/vault_password` when a vault password is present, so role authors can use `ansible-vault`-protected vars without touching the path directly.

### 3.4 In-memory Handling

- [x] The API MUST NOT persist plaintext secrets beyond job-scoped in-memory masking state; request persistence, logs, SSE, audit data, and error responses remain masked, and the job-scoped secret set MUST be dropped on terminal state.
- [x] Secret-handling code paths MUST release job-scoped secret references during terminal-state cleanup and SSE stream teardown before control returns to idle request handling.

### 3.5 Runner-Emitted Output

- [x] Secret masking defined in existing requirements (see [014-e2e-dashboard-deploy.md](014-e2e-dashboard-deploy.md) and [012-log.md](012-log.md)) MUST apply at three layers: runner stdout/stderr, API SSE emission, and persisted `job.log`.
- [x] A masking failure at any one layer MUST fail the test suite; downstream layers MUST NOT be relied on as the sole defence.
- [x] Masking MUST preserve the runner's server-side receive-timestamp prefix `[RX:<unix_ms>] ` (see [014-e2e-dashboard-deploy.md Test Harness Contract](014-e2e-dashboard-deploy.md)) verbatim at the start of every line; any masker that strips or rewrites this prefix breaks the 30 s latency measurement and MUST fail the security test suite.

## 4. Workspace Isolation

- [x] All filesystem access originating from an API request MUST be resolved through a single path-safety helper that rejects absolute paths, `..` traversal, and symlinks that escape the workspace root.
- [x] A request carrying `workspace_id=A` MUST NOT be able to read, list, write, rename, or delete any path owned by `workspace_id=B`, including via ZIP import/export, inventory-preview, or credentials endpoints.
- [x] Workspace IDs MUST be opaque and non-guessable (UUIDv4 or longer); sequential or time-based IDs are disallowed.
- [x] When OAuth2 Proxy is enabled, the API MUST refuse any workspace access whose persisted owner does not match the authenticated upstream identity.

## 5. Transport & Auth

### 5.1 CORS

- [x] The API MUST allow only the configured UI origin(s) read from env `ALLOWED_ORIGINS` (comma-separated); wildcard `*` MUST be rejected at startup with a fatal error.
- [x] Preflight responses MUST NOT include `Access-Control-Allow-Credentials: true` together with a wildcard origin under any configuration.

### 5.2 Content Security Policy

- [x] The web service MUST set a per-request CSP via Next.js middleware:
  ```
  default-src 'self';
  script-src 'self' 'nonce-<REQ_NONCE>';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  frame-src https://www.youtube.com https://www.youtube-nocookie.com;
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ```
- [x] `<REQ_NONCE>` MUST be a fresh 128-bit random value per request, propagated to inline `<script>` tags rendered by Next.
- [x] The CSP MUST NOT allow external icon CDNs. SimpleIcons lookups MUST continue to be performed and cached by the backend (see [Todo.md §1.3](Todo.md)) and served through the local origin.
- [x] API responses MUST set `X-Content-Type-Options: nosniff`.
- [x] API responses MUST set `Referrer-Policy: no-referrer` for endpoints that return secrets or credentials.

### 5.3 CSRF

- [x] When OAuth2 Proxy is enabled: session-cookie hardening (`Secure`, `HttpOnly`, `SameSite=Strict`) is owned by the proxy configuration and documented in [local.md](../contributing/testing/local.md); no additional CSRF token is required from the API in that mode.
- [x] When running anonymously: state-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) MUST require a double-submit token — the UI MUST read a `csrf` cookie (`SameSite=Strict`, `Secure`, not `HttpOnly`) and echo its value into an `X-CSRF` request header; the API MUST reject requests where cookie and header do not match. `Sec-*` header names are not permitted for browser-set request headers and MUST NOT be used here.
- [x] The `csrf` cookie MUST be a session cookie (no explicit `Expires`/`Max-Age`); it MUST be regenerated on every successful login (OAuth2 mode) or on first request in a new anonymous session.
- [x] Cookies set directly by the deployer stack MUST carry `Secure`, `HttpOnly` (except the `csrf` cookie), and `SameSite=Strict`.

### 5.4 Rate Limiting

- [x] Rate-limit key MUST be `(workspace_id, client_ip)` for all limited endpoints.
- [x] `POST /api/deployments` MUST be rate-limited: default 5 concurrent and 30 per hour per key; configurable via env `RATE_LIMIT_DEPLOY_*`.
- [x] `POST /api/workspaces/{id}/test-connection` MUST be rate-limited: default 10 per minute per key; configurable via env `RATE_LIMIT_TEST_CONN_*`.
- [x] The concurrency count MUST be computed by calling `runner-manager`'s `GET /jobs?workspace_id=<id>&status=running`. This is the sole source of truth; the API MUST NOT maintain a parallel in-memory counter that could drift.
- [x] The hourly/per-minute counters MUST be persisted in the existing API database in a table `rate_limit_events` with the following schema, which remains consistent across API restarts and multiple workers:
  - `workspace_id TEXT NOT NULL`,
  - `client_ip TEXT NOT NULL` (the canonical client address derived by the documented proxy-header policy; `unknown` when no address is resolvable),
  - `endpoint TEXT NOT NULL` (one of `deploy_hourly`, `test_conn_minute`; extensible by env),
  - `window_start TIMESTAMPTZ NOT NULL` (UTC, truncated to the window granularity: hour for `deploy_hourly`, minute for `test_conn_minute`),
  - `count INTEGER NOT NULL DEFAULT 0`,
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  - PRIMARY KEY `(workspace_id, client_ip, endpoint, window_start)`,
  - index `(endpoint, window_start)` for cleanup scans.
- [x] A background task in the API MUST delete rows whose `window_start` is older than `max(window_size) * 4` (default: 4 hours) every 10 minutes. The cleanup MUST NOT block request handling.
- [x] Counter increments MUST use an atomic upsert (`INSERT ... ON CONFLICT (…) DO UPDATE SET count = count + 1, updated_at = now()`) so concurrent workers stay consistent.
- [x] Rate-limit rejection MUST return `429` and MUST NOT leak whether a similar request succeeded for a different key.

## 6. Input Validation & Path Safety

- [x] All JSON request bodies MUST be validated by Pydantic models with explicit types; free-form `dict[str, Any]` MUST NOT be accepted on any endpoint that writes state.
- [x] Role IDs accepted by any endpoint MUST match `^[a-z0-9][a-z0-9\-_]{0,63}$` and MUST be verified against the in-memory role index before use.
- [x] YAML loading MUST use `yaml.safe_load`; `yaml.load` without a `SafeLoader` is banned.
- [x] JSON loading of workspace imports MUST cap document size (default 10 MiB, env `INPUT_MAX_BODY_BYTES`) and nesting depth (default 50, env `INPUT_MAX_NESTING`).
- [x] ZIP imports MUST reject entries whose resolved destination escapes the workspace root (classic Zip-Slip), symlink entries, and entries with mode bits granting group or world write.

## 7. Supply Chain & Image Integrity

- [x] In CI and in production-oriented paths, all external image inputs (`INFINITO_NEXUS_IMAGE`, runner image, Postgres image) MUST be referenced by immutable digest (`@sha256:...`), and the locally built `api`, `web`, `catalog`, and `runner-manager` images MUST use digest-pinned base images.
- [x] In local development, `docker compose build` / `--build` is permitted; the local `make` targets MUST emit a visible warning `WARN: unpinned local image <name>, digest pinning enforced only in CI/prod` when an unpinned image is used.
- [x] `INFINITO_NEXUS_IMAGE` MUST be pinned by digest in CI.
- [x] Python dependencies MUST be installed from a hash-checking lock in the production image; unlocked `pip install` is banned there.
- [x] Node dependencies MUST be installed via `npm ci` with a committed `package-lock.json`.
- [x] For SCA in this repository, "first-party dependencies" means packages declared directly in `apps/api/requirements.txt` or `apps/web/package.json`; "third-party" means their transitive closures.
- [x] SCA scans MUST use `pip-audit` for Python (run against the locked manifest) and `npm audit --audit-level=critical` for Node. Both MUST run on every PR as a CI job and MUST fail on any Critical CVE in first-party dependencies with no declared mitigation.

## 8. Network Egress Enforcement

### 8.0 Rollout Scope

- **Current shipped scope of this repository**: no `egress-proxy` service is deployed. Hardened deployments run only on per-job internal bridge networks and use the Compose-adjacent Mode A target-attachment path covered by the local and CI test flows.
- **Future hardening follow-up**: external-target SSH sidecars, per-role package-source allowlists, and API-wide outbound allowlists remain a separate future scope and are intentionally not part of this repository revision.

### 8.1 Per-Job Bridge Network

- [x] For every job, `runner-manager` MUST create a dedicated Docker bridge network named `job-<job_id>` with `internal: true`.
- [x] The runner container MUST be attached only to `job-<job_id>`; it MUST NOT be attached to the main Compose network.
- [x] On terminal state, `runner-manager` MUST remove `job-<job_id>` within 10 s, consistent with container cleanup.

### 8.1.1 Target Reachability Mode

- [x] **Mode A — Compose-adjacent target** (used by the `test` profile and the current local/CI hardened flows): `runner-manager` MUST attach the target service to `job-<job_id>` alongside the runner. The runner reaches the target by service name at SSH port 22 within `job-<job_id>`. No additional outbound route is opened.

### 8.2 Future External-Target Egress Hardening

- External-target SSH egress sidecars, per-role `meta/egress.yml` package-source allowlists, and API-wide outbound internet allowlists remain future hardening work outside the shipped Mode A runtime covered by this requirement revision.

## 9. Container Hardening (Stack-Wide)

- [x] No production request-handling service in `docker-compose.yml` MUST run as root at request-handling time. Services that require root during build or one-shot init MUST drop to their documented runtime user before serving traffic.
- [x] All runtime services MUST declare explicit `cap_drop: [ALL]` and re-add only capabilities they document as required.
- [x] All runtime services MUST set `security_opt: [no-new-privileges:true]`.
- [x] All runtime services MUST declare `tmpfs` or named volumes for any writable path; no runtime service MUST write into its image layer at runtime.
- [x] Healthchecks MUST exist for `api`, `web`, `db`, `catalog`, `runner-manager`, and MUST NOT expose sensitive fields in their response bodies.

## 10. Cancellation & Cleanup

- [x] `POST /api/deployments/{job_id}/cancel` MUST call `DELETE /jobs/{job_id}` on `runner-manager`, which MUST `SIGTERM` the runner within 5 s and escalate to `SIGKILL` after 10 s if still running.
- [x] Cancellation MUST unlink all secret-bearing files and remove the runner tmpfs secret volume within 5 s of the terminal state, consistent with §3.2.
- [x] Cancellation MUST remove the `job-<job_id>` network within 10 s. Any stray `ssh-egress-<job_id>` artifact remains subject to orphan sweep.
- [x] An orphan sweep MUST run on `runner-manager` startup and every 10 min thereafter, removing:
  - runner containers whose `job_id` has no corresponding active job record,
  - `job-*` networks without an associated active runner,
  - `ssh-egress-*` sidecars without an associated active runner,
  - `state/jobs/<job_id>/` directories whose job reached terminal state more than the retention window ago (default 7 days, env `JOB_RETENTION_DAYS`).
- [x] The orphan sweep MUST emit one audit event per removed artifact (see [012-log.md](012-log.md)).

## 11. Dependency & Test Hygiene

- [x] Lint (`make lint`) MUST fail on banned patterns: `eval(`, `yaml.load(` without SafeLoader, `shell=True` in `subprocess` calls, `--privileged` in any compose or shell script, `mode=0o777`.
- [x] A dedicated security test module MUST exist at `tests/python/integration/test_security_hardening.py` and MUST run on the host with access to the Docker socket. It MUST NOT execute inside the API container.
- [x] The test module MUST cover:
  - one-container-per-deploy invariant (two concurrent deploys → two distinct container IDs),
  - capability drop on runner (inspect `CapEff` via `docker inspect`),
  - read-only root on runner,
  - runner attached only to a `job-<id>` network with `internal: true` and no default bridge membership,
  - Mode A target reachability: target service is reachable from runner on `job-<id>`,
  - secret-file mode `0400`, directory mode `0700`, unlink-within-5 s after terminal state,
  - runner bootstrap creates `/run/inventory/group_vars/all/_secrets.yml` with only secret-path references, no literal secrets, and unlinks it on exit,
  - workspace-isolation cross-access returns `404` or `403`, never leaking existence,
  - Zip-Slip rejection on import,
  - rate-limit trigger on deployment creation (both hourly window via DB and concurrent count via `runner-manager`), including verification that `rate_limit_events` rows carry the documented primary key and that cleanup removes expired rows,
  - masking preserves the `[RX:<unix_ms>] ` prefix on every line across stdout, SSE, and persisted `job.log`,
  - CORS rejection of an unlisted origin,
  - CSP header presence and nonce freshness across two requests (two distinct 128-bit values),
  - CSRF double-submit rejection in anonymous mode,
  - `init-manager-token` rewrites `/auth/token` on stack restart.
- [x] `make test-perf` and `make e2e-dashboard-ci` MUST continue to pass with all above controls enabled; a control that can only be met by disabling an existing test is a failure.

## Acceptance Criteria

### Job Runner Isolation

- [x] Two concurrent deployments from the same workspace produce two distinct container IDs with matching `infinito.deployer.job_id` labels.
- [x] Each runner container exits within 10 s of its job's terminal state.
- [x] Runner containers run as UID `10002`, with `cap_drop: [ALL]`, `--read-only` root, no Docker socket, no `--privileged`, no host networking or PID.
- [x] `runner-manager` rejects any operation whose request `workspace_id` does not match the container's `infinito.deployer.workspace_id` label.

### Control Plane

- [x] `runner-manager` service exists in compose with `/var/run/docker.sock` mounted only there.
- [x] API, web, db, catalog, and all runners have no Docker socket access.
- [x] `runner-manager`'s API surface is limited to the five documented endpoints; Pydantic-validated job spec with allowlisted fields.
- [x] `init-manager-token` generates a 256-bit token on every stack startup; API and `runner-manager` both read it from the `manager-auth` named volume; missing/invalid token returns `401`.

### Secret Lifecycle

- [x] No plaintext password file exists outside the KDBX during or after deployment, except for ephemeral tmpfs/runtime staging that is removed again at terminal state.
- [x] Secrets reach the runner at exactly `/run/secrets/infinito/{ssh_key,ssh_password,vault_password,credentials.kdbx}` with mode `0400` on an 8 MiB tmpfs volume mounted `noexec,nosuid,nodev`.
- [x] Runner receives only `INFINITO_SECRETS_DIR`; no secret value appears in its env, args, or stdin.
- [x] Runner bootstrap emits `/run/inventory/group_vars/all/_secrets.yml` with only secret-path references and `lookup('file', ...)` bridges for password-bearing vars; the file is removed on exit.
- [x] `ANSIBLE_VAULT_PASSWORD_FILE` is set to the tmpfs vault-password path when a vault password is present.
- [x] The tmpfs secret volume and staged secret dir are cleaned within 5 s of terminal state and on API/runner-manager restart.
- [x] No plaintext secret appears in API logs, SSE streams, persisted `job.log`, or any `state/perf/016/*.json`.

### Workspace Isolation

- [x] Cross-workspace read/list/write/rename/delete attempts return `404` or `403` without disclosing the target resource's existence.
- [x] Workspace IDs are UUIDv4 (or longer, equally unguessable).
- [x] With OAuth2 Proxy enabled, requests for a workspace whose persisted owner differs from the upstream identity are rejected.

### Transport & Auth

- [x] API rejects CORS origins not in `ALLOWED_ORIGINS`; wildcard causes startup failure.
- [x] Web serves the documented CSP with a fresh per-request nonce and no external icon-CDN allowance.
- [x] Security headers (`X-Content-Type-Options`, `Referrer-Policy`) are present on the documented endpoints.
- [x] OAuth2 mode: proxy-side `SameSite=Strict` session-cookie hardening is documented; anonymous mode: double-submit CSRF (`csrf` cookie + `X-CSRF` header) is enforced; the `csrf` cookie is regenerated on new session.
- [x] Deployment creation is rate-limited by hourly DB-backed count and concurrent count via `runner-manager`; test-connection by per-minute DB count; all keyed on `(workspace_id, client_ip)`; `429` on limit.

### Input Validation

- [x] Endpoints reject untyped `dict[str, Any]` bodies.
- [x] Role IDs outside the allowed regex are rejected.
- [x] `yaml.safe_load` is used everywhere; CI lint fails on `yaml.load(` without SafeLoader.
- [x] Body size and nesting limits are enforced and configurable via env.
- [x] ZIP imports reject path-traversal, symlink, and world-writable entries.

### Supply Chain

- [x] All CI/production external image inputs are pinned by digest, and locally built runtime images use digest-pinned base images; unpinned runner/catalog/db refs are rejected when digest pinning is enforced.
- [x] Local `make` emits a visible warning on unpinned images.
- [x] Python install uses hash-checking lock in the production image.
- [x] Node install uses `npm ci`.
- [x] `pip-audit` and `npm audit --audit-level=critical` run per PR and fail on unmitigated Critical CVEs in first-party declarations.

### Network

- [x] Every job is attached to a dedicated `job-<id>` bridge network with `internal: true`; the runner has no other network membership.
- [x] In the current shipped scope, Compose-adjacent Mode A is the supported reachability path, and the runner does not gain a general outbound internet route.

### Stack Hardening

- [x] All runtime services declare `cap_drop: [ALL]` and `no-new-privileges:true`.
- [x] No production request-handling service runs as root.
- [x] Healthchecks exist for all documented services and do not leak sensitive data.

### Cancellation & Cleanup

- [x] Cancel via `runner-manager`: `SIGTERM` within 5 s, `SIGKILL` at 10 s.
- [x] Orphan sweep removes stale containers, `job-*` networks, `ssh-egress-*` sidecars, secret volumes, and workspace job dirs per retention window and emits audit events.

### Hygiene

- [x] `tests/python/integration/test_security_hardening.py` exists, runs on the host with Docker-socket access, and covers the listed current-scope controls (including CSP nonce freshness, CSRF double-submit rejection, token rotation, and Mode A reachability).
- [x] `make lint` fails on the banned patterns.
- [x] Existing `make test`, `make test-perf`, and `make e2e-dashboard-ci` pass unchanged with all controls enabled.
