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

- [ ] Every accepted `POST /api/deployments` MUST start a dedicated job-runner container whose lifetime is bounded by that single job.
- [ ] The API MUST NOT reuse a runner container across two jobs, even when both target the same host, workspace, or role set.
- [ ] Parallel deployments from the same workspace MUST run in separate containers, not as multiple processes inside one runner.
- [ ] A runner container MUST terminate (exit, not just idle) within 10 s after the job reaches a terminal state (`done`, `failed`, or `cancelled`).
- [ ] A runner container MUST NOT accept any new command, signal, or mount after its single job starts.

### 1.2 Container Identity

- [ ] Each runner container MUST carry labels that uniquely identify the owning job:
  - `infinito.deployer.job_id=<uuid>`,
  - `infinito.deployer.workspace_id=<id>`,
  - `infinito.deployer.role=job-runner`.
- [ ] `runner-manager` MUST reject any operation on a runner whose `infinito.deployer.workspace_id` label does not match the `workspace_id` carried by the request. This MUST hold in anonymous and OAuth2-authenticated modes alike.

### 1.3 No Host Privilege

- [ ] Runner containers MUST run as UID `10002` (non-root).
- [ ] Runner containers MUST drop all Linux capabilities and MUST NOT re-add `CAP_NET_ADMIN`, `CAP_SYS_ADMIN`, `CAP_DAC_OVERRIDE`, or `CAP_SETUID`.
- [ ] Runner containers MUST run with `--read-only` root filesystem, writable only on mounted job-workspace volumes and `/tmp` (tmpfs, size-capped at 64 MiB).
- [ ] Runner containers MUST NOT have access to the Docker socket or to any container runtime API.
- [ ] Runner containers MUST NOT use `--privileged`, `--pid=host`, `--network=host`, or bind-mount `/var/run/docker.sock`.

## 2. Container Lifecycle Control Plane

### 2.1 Dedicated runner-manager Service

- [ ] A dedicated `runner-manager` service MUST exist in `docker-compose.yml`, running on the internal Compose network.
- [ ] `/var/run/docker.sock` MUST be bind-mounted ONLY into `runner-manager`. The API, the web service, the database, and every runner MUST NOT have access to this socket.
- [ ] `runner-manager` MUST expose a narrow internal HTTP API on `runner-manager:8001`. No port MUST be published to the host in production.
- [ ] The internal API surface is exactly:
  - `POST /jobs` — create a runner for a job spec,
  - `DELETE /jobs/{job_id}` — cancel a running job,
  - `GET /jobs/{job_id}` — return status,
  - `GET /jobs?workspace_id=<id>&status=running` — list running jobs, used as the source of truth for concurrency limits,
  - `GET /jobs/{job_id}/logs` — stream stdout/stderr.
- [ ] The API surface MUST NOT proxy arbitrary Docker commands and MUST NOT accept image names, volume mounts, or capability lists not declared in the job spec schema.
- [ ] The job spec schema MUST be a Pydantic model with the explicit fields: `job_id` (UUIDv4), `workspace_id` (opaque ID), `runner_image` (image reference string; MUST be digest-pinned in CI and production, and MAY be tag-based only for the local source-directory build flow from [015-image-build-from-local-source.md](015-image-build-from-local-source.md)), `inventory_path` (workspace-relative), `secrets_dir` (host tmpfs path), `role_ids` (list of allowed-regex strings), `network_name` (string matching `^job-[0-9a-f\-]{36}$`), `labels` (dict of the three documented labels only). Any additional field MUST be rejected.

### 2.2 Authentication Between API and runner-manager

- [ ] The API MUST authenticate to `runner-manager` with a shared token. The token MUST be read at request time from a file path provided by env `MANAGER_TOKEN_FILE` (default `/run/manager/token`). The token MUST NOT be hard-coded or logged.
- [ ] A dedicated init service `init-manager-token` MUST run once per stack startup, generate a 256-bit random token (`openssl rand -hex 32`), and write it to the `manager-auth` named volume at `/auth/token` with mode `0440`, owner UID `10003`, group GID `10900` (`infinito-manager`). The init image MUST declare the same UID/GID entries so `chown 10003:10900` and `chmod 0440` succeed without a numeric-only fallback.
- [ ] Both `api` and `runner-manager` MUST mount `manager-auth` read-only; the API reads via its `infinito-manager` (GID `10900`) group membership, the manager reads as owner UID `10003`.
- [ ] `init-manager-token` MUST overwrite the token on every stack restart. Token rotation therefore happens on every `make up` / `make restart`.
- [ ] `runner-manager` MUST reject any request missing or mismatching the token with HTTP `401`.

## 3. Secret Lifecycle

### 3.1 Storage

- [ ] Generated application credentials MUST be stored only in `secrets/credentials.kdbx` inside the workspace, consistent with existing `KeePassXC Credentials Vault` rules.
- [ ] No plaintext password file MUST exist on disk outside the KDBX at any time, including during generation; intermediate buffers MUST reside only in process memory.
- [ ] SSH private keys written to the workspace MUST have mode `0600` and owner `api` UID (`10001`).
- [ ] The vault master password MUST NOT be persisted to disk by the API; it MUST live only in the request-handling memory of the specific call that needs it.

### 3.2 Transport Into the Runner (tmpfs Convention)

Concrete path and file schema:

- [ ] The API MUST materialize per-job secrets at `state/jobs/<job_id>/secrets/` on the host side.
- [ ] This directory MUST be an in-memory tmpfs mount, size-capped at 8 MiB, mounted with `noexec,nosuid,nodev`, owner `api` UID, directory mode `0700`.
- [ ] `runner-manager` MUST mount this directory into the runner container read-only at the target path `/run/secrets/infinito/`.
- [ ] The following file layout MUST be used when the corresponding secret exists for the job:
  - `/run/secrets/infinito/ssh_key` — private key, mode `0400`, owner `10002`,
  - `/run/secrets/infinito/ssh_password` — plaintext SSH password, mode `0400`, owner `10002`,
  - `/run/secrets/infinito/vault_password` — vault master password, mode `0400`, owner `10002`,
  - `/run/secrets/infinito/credentials.kdbx` — ephemeral KDBX copy, mode `0400`, owner `10002`.
- [ ] Runners MUST receive only the env variable `INFINITO_SECRETS_DIR=/run/secrets/infinito`. Individual secret values MUST NOT be passed via env, command-line arguments, or stdin.
- [ ] Secret files MUST be unlinked and the tmpfs unmounted no later than 5 s after the runner's terminal state is observed, regardless of success or failure. Cleanup order: `umount` → `rm -rf state/jobs/<id>/secrets`.
- [ ] No secret-bearing file MUST survive an API restart; on startup the API MUST purge orphaned secret directories from prior runs.

### 3.3 Ansible Plumbing (Bridge from Secret Files to Inventory)

The runner entrypoint is responsible for turning the files in `INFINITO_SECRETS_DIR` into Ansible-usable inventory variables, so that role authors never handle raw secrets.

- [ ] The runner image MUST ship an entrypoint script `infinito-runner-entrypoint` that runs before `ansible-playbook`.
- [ ] The entrypoint MUST generate `/run/inventory/group_vars/all/_secrets.yml` on a tmpfs mount inside the runner, mode `0400`, owner `10002`.
- [ ] The generated file MUST populate only the following keys, and only for secrets that exist:
  - `ansible_ssh_private_key_file: /run/secrets/infinito/ssh_key`,
  - `ansible_ssh_pass: "{{ lookup('file', '/run/secrets/infinito/ssh_password') }}"`,
  - `ansible_become_pass: "{{ lookup('file', '/run/secrets/infinito/ssh_password') }}"` when `use_become_from_ssh=true` is declared in the job spec, else omitted,
  - `infinito_vault_password_file: /run/secrets/infinito/vault_password`.
- [ ] The generated file MUST NOT contain any literal secret value; it MUST only reference paths via `lookup('file', ...)`.
- [ ] The entrypoint MUST NOT write the generated file to any workspace volume or any path that is included in git autosave.
- [ ] The entrypoint MUST unlink `_secrets.yml` on exit via a `trap` on `EXIT`, independent of success or failure.
- [ ] Ansible's `ANSIBLE_VAULT_PASSWORD_FILE` env MUST be set to `/run/secrets/infinito/vault_password` when a vault_password is present, so role authors can use `ansible-vault`-protected vars without touching the path directly.

### 3.4 In-memory Handling

- [ ] The API MUST NOT place plaintext secrets in any long-lived cache, in any ASGI middleware trace, or in any exception traceback.
- [ ] Any exception path that handles a secret MUST explicitly drop references to the secret buffer before propagating.

### 3.5 Runner-Emitted Output

- [ ] Secret masking defined in existing requirements (see [014-e2e-dashboard-deploy.md](014-e2e-dashboard-deploy.md) and [012-log.md](012-log.md)) MUST apply at three layers: runner stdout/stderr, API SSE emission, and persisted `job.log`.
- [ ] A masking failure at any one layer MUST fail the test suite; downstream layers MUST NOT be relied on as the sole defence.
- [ ] Masking MUST preserve the runner's server-side receive-timestamp prefix `[RX:<unix_ms>] ` (see [014-e2e-dashboard-deploy.md Test Harness Contract](014-e2e-dashboard-deploy.md)) verbatim at the start of every line; any masker that strips or rewrites this prefix breaks the 30 s latency measurement and MUST fail the security test suite.

## 4. Workspace Isolation

- [ ] All filesystem access originating from an API request MUST be resolved through a single path-safety helper that rejects absolute paths, `..` traversal, and symlinks that escape the workspace root.
- [ ] A request carrying `workspace_id=A` MUST NOT be able to read, list, write, rename, or delete any path owned by `workspace_id=B`, including via ZIP import/export, inventory-preview, or credentials endpoints.
- [ ] Workspace IDs MUST be opaque and non-guessable (UUIDv4 or longer); sequential or time-based IDs are disallowed.
- [ ] When OAuth2 Proxy is enabled, the API MUST refuse any workspace access whose persisted owner does not match the authenticated upstream identity.

## 5. Transport & Auth

### 5.1 CORS

- [ ] The API MUST allow only the configured UI origin(s) read from env `ALLOWED_ORIGINS` (comma-separated); wildcard `*` MUST be rejected at startup with a fatal error.
- [ ] Preflight responses MUST NOT include `Access-Control-Allow-Credentials: true` together with a wildcard origin under any configuration.

### 5.2 Content Security Policy

- [ ] The web service MUST set a per-request CSP via Next.js middleware:
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
- [ ] `<REQ_NONCE>` MUST be a fresh 128-bit random value per request, propagated to inline `<script>` tags rendered by Next.
- [ ] The CSP MUST NOT allow external icon CDNs. SimpleIcons lookups MUST continue to be performed and cached by the backend (see [Todo.md §1.3](Todo.md)) and served through the local origin.
- [ ] API responses MUST set `X-Content-Type-Options: nosniff`.
- [ ] API responses MUST set `Referrer-Policy: no-referrer` for endpoints that return secrets or credentials.

### 5.3 CSRF

- [ ] When OAuth2 Proxy is enabled: session cookies MUST carry `Secure`, `HttpOnly`, and `SameSite=Strict`; no additional CSRF token is required.
- [ ] When running anonymously: state-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) MUST require a double-submit token — the UI MUST read a `csrf` cookie (`SameSite=Strict`, `Secure`, not `HttpOnly`) and echo its value into a `Sec-CSRF` request header; the API MUST reject requests where cookie and header do not match.
- [ ] The `csrf` cookie MUST be a session cookie (no explicit `Expires`/`Max-Age`); it MUST be regenerated on every successful login (OAuth2 mode) or on first request in a new anonymous session.
- [ ] Cookies set by the stack MUST carry `Secure`, `HttpOnly` (except the `csrf` cookie), and `SameSite=Strict`.

### 5.4 Rate Limiting

- [ ] Rate-limit key MUST be `(workspace_id, client_ip)` for all limited endpoints.
- [ ] `POST /api/deployments` MUST be rate-limited: default 5 concurrent and 30 per hour per key; configurable via env `RATE_LIMIT_DEPLOY_*`.
- [ ] `POST /api/workspaces/{id}/test-connection` MUST be rate-limited: default 10 per minute per key; configurable via env `RATE_LIMIT_TEST_CONN_*`.
- [ ] The concurrency count MUST be computed by calling `runner-manager`'s `GET /jobs?workspace_id=<id>&status=running`. This is the sole source of truth; the API MUST NOT maintain a parallel in-memory counter that could drift.
- [ ] The hourly/per-minute counters MUST be persisted in the existing API database in a table `rate_limit_events` with the following schema, which remains consistent across API restarts and multiple workers:
  - `workspace_id TEXT NOT NULL`,
  - `client_ip TEXT NOT NULL` (the canonical client address derived by the documented proxy-header policy; `unknown` when no address is resolvable),
  - `endpoint TEXT NOT NULL` (one of `deploy_hourly`, `test_conn_minute`; extensible by env),
  - `window_start TIMESTAMPTZ NOT NULL` (UTC, truncated to the window granularity: hour for `deploy_hourly`, minute for `test_conn_minute`),
  - `count INTEGER NOT NULL DEFAULT 0`,
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  - PRIMARY KEY `(workspace_id, client_ip, endpoint, window_start)`,
  - index `(endpoint, window_start)` for cleanup scans.
- [ ] A background task in the API MUST delete rows whose `window_start` is older than `max(window_size) * 4` (default: 4 hours) every 10 minutes. The cleanup MUST NOT block request handling.
- [ ] Counter increments MUST use an atomic upsert (`INSERT ... ON CONFLICT (…) DO UPDATE SET count = count + 1, updated_at = now()`) so concurrent workers stay consistent.
- [ ] Rate-limit rejection MUST return `429` and MUST NOT leak whether a similar request succeeded for a different key.

## 6. Input Validation & Path Safety

- [ ] All JSON request bodies MUST be validated by Pydantic models with explicit types; free-form `dict[str, Any]` MUST NOT be accepted on any endpoint that writes state.
- [ ] Role IDs accepted by any endpoint MUST match `^[a-z0-9][a-z0-9\-_]{0,63}$` and MUST be verified against the in-memory role index before use.
- [ ] YAML loading MUST use `yaml.safe_load`; `yaml.load` without a `SafeLoader` is banned.
- [ ] JSON loading of workspace imports MUST cap document size (default 10 MiB, env `INPUT_MAX_BODY_BYTES`) and nesting depth (default 50, env `INPUT_MAX_NESTING`).
- [ ] ZIP imports MUST reject entries whose resolved destination escapes the workspace root (classic Zip-Slip), symlink entries, and entries with mode bits granting group or world write.

## 7. Supply Chain & Image Integrity

- [ ] In CI and in production compose overlays, all images for `api`, `web`, `catalog`, `db`, `runner-manager`, and the runner image MUST be referenced by immutable digest (`@sha256:...`). Moving tags (`:latest`, `:main`) are banned in CI and production.
- [ ] In local development, `docker compose build` / `--build` is permitted; the local `make` targets MUST emit a visible warning `WARN: unpinned local image <name>, digest pinning enforced only in CI/prod` when an unpinned image is used.
- [ ] `INFINITO_NEXUS_IMAGE` MUST be pinned by digest in CI.
- [ ] Python dependencies MUST be installed from a hash-checking lock in the production image; unlocked `pip install` is banned there.
- [ ] Node dependencies MUST be installed via `npm ci` with a committed `package-lock.json`.
- [ ] "First-party dependencies" = packages declared directly in `pyproject.toml` or `package.json`. "Third-party" = transitive closures.
- [ ] SCA scans MUST use `pip-audit` for Python (run against the locked manifest) and `npm audit --audit-level=critical` for Node. Both MUST run on every PR as a CI job and MUST fail on any Critical CVE in first-party dependencies with no declared mitigation.

## 8. Network Egress Enforcement

### 8.0 Rollout Phases

- **Phase 1** (current scope of this requirement): no `egress-proxy` service is deployed. Runners have no outbound internet route. Only Mode A (Compose-adjacent target) and Mode B (SSH egress sidecar on TCP-22 only) are permitted. Package installs that originate from the target host over SSH remain possible because the outbound traffic leaves the target, not the runner.
- **Phase 2** (out of scope for this requirement, tracked separately): an `egress-proxy` service is added and may be attached to `job-<job_id>` as the runner's only non-SSH external route, enforcing per-role allowlists from `roles/<id>/meta/egress.yml`.
- References to "Phase 1" elsewhere in this document mean the state described above and imply no `egress-proxy` container exists.

### 8.1 Per-Job Bridge Network

- [ ] For every job, `runner-manager` MUST create a dedicated Docker bridge network named `job-<job_id>` with `internal: true`.
- [ ] The runner container MUST be attached only to `job-<job_id>`; it MUST NOT be attached to the main Compose network.
- [ ] On terminal state, `runner-manager` MUST remove `job-<job_id>` within 10 s, consistent with container cleanup.

### 8.1.1 Target Reachability Modes

Target hosts listed in the job's inventory MUST be reachable only through one of the two documented modes:

- **Mode A — Compose-adjacent target** (used by the `test` profile and any scenario where the target runs as a Compose service): `runner-manager` MUST attach the target service to `job-<job_id>` alongside the runner. The runner reaches the target by service name at SSH port 22 within `job-<job_id>`. No internet route is opened.

- **Mode B — External target via SSH egress sidecar** (used for production deployments to hosts that are not Compose services): `runner-manager` MUST attach a disposable sidecar `ssh-egress-<job_id>` to both `job-<job_id>` and an external bridge network. The sidecar MUST:
  - be built from `alpine:3.20` (digest-pinned in CI/prod) with `iptables-nft` and `iproute2` installed; no SSH client or interactive shell beyond `/bin/sh`,
  - run as UID `10004` with `cap_drop: [ALL]` and `cap_add: [NET_ADMIN]` (required for applying iptables rules; no other capabilities),
  - receive its allowlist via a read-only config file `/etc/egress/allowlist.json` written by `runner-manager` at container creation, containing the resolved `(ip, port=22)` tuples derived from the job's inventory hosts (DNS resolution MUST happen in `runner-manager`, not in the sidecar, and MUST fail the job if any name does not resolve),
  - apply at entrypoint a deterministic ruleset: default `DROP` on `INPUT`, `FORWARD`, `OUTPUT`; accept `INPUT` only from the runner IP on `job-<job_id>`; accept `OUTPUT` only to allowlisted `(ip, 22/tcp)` tuples; log dropped packets via `-j NFLOG --nflog-group 17` for audit capture,
  - accept inbound TCP only from the runner container IP on `job-<job_id>`,
  - forward only TCP-22 to IP addresses resolved from names in the job's inventory and nowhere else,
  - log every accepted and denied connection as an audit event (see [012-log.md](012-log.md)),
  - exit and be removed together with the runner.

- The runner MUST NOT receive credentials for any target that is not covered by one of these two modes; jobs whose inventory contains such hosts MUST be rejected at submission time with a clear validation error.

### 8.2 Package-Source Access

- [ ] When a role declares package-source requirements (e.g. APT, PyPI), those requirements MUST be listed in `roles/<id>/meta/egress.yml` with host + port + protocol.
- [ ] An optional `egress-proxy` service MAY be attached to `job-<job_id>` as the runner's only non-SSH external route; if present, it MUST enforce the allowlist from the job's role set and log every denied connection as an audit event.
- [ ] In Phase 1 (no `egress-proxy` deployed), required packages MUST be pre-baked into the runner image for the supported role set. In Mode A and Mode B, runners whose playbooks attempt package installs from the target side continue to work because those installs originate from the target host, not the runner; only runner-side outbound is blocked.

### 8.3 API and runner-manager Egress

- [ ] The `api` container MUST NOT initiate outbound connections to the public internet during request handling, except to endpoints explicitly allowlisted (catalog sync, SimpleIcons backend fetch, OAuth2 issuer if configured).
- [ ] `runner-manager` MUST NOT have outbound internet access; it only talks to the Docker socket and its internal callers.

## 9. Container Hardening (Stack-Wide)

- [ ] No production service in `docker-compose.yml` MUST run as root at request-handling time. Services that require root at start MUST drop to their documented UID via entrypoint.
- [ ] All services MUST declare explicit `cap_drop: [ALL]` and re-add only capabilities they document as required.
- [ ] All services MUST set `security_opt: [no-new-privileges:true]`.
- [ ] All services MUST declare `tmpfs` or named volumes for any writable path; no service MUST write into its image layer at runtime.
- [ ] Healthchecks MUST exist for `api`, `web`, `db`, `catalog`, `runner-manager`, and MUST NOT expose sensitive fields in their response bodies.

## 10. Cancellation & Cleanup

- [ ] `POST /api/deployments/{job_id}/cancel` MUST call `DELETE /jobs/{job_id}` on `runner-manager`, which MUST `SIGTERM` the runner within 5 s and escalate to `SIGKILL` after 10 s if still running.
- [ ] Cancellation MUST unlink all secret-bearing files and unmount the job tmpfs within 5 s of the terminal state, consistent with §3.2.
- [ ] Cancellation MUST remove the `job-<job_id>` network and any `ssh-egress-<job_id>` sidecar within 10 s.
- [ ] An orphan sweep MUST run on `runner-manager` startup and every 10 min thereafter, removing:
  - runner containers whose `job_id` has no corresponding active job record,
  - `job-*` networks without an associated active runner,
  - `ssh-egress-*` sidecars without an associated active runner,
  - `state/jobs/<job_id>/` directories whose job reached terminal state more than the retention window ago (default 7 days, env `JOB_RETENTION_DAYS`).
- [ ] The orphan sweep MUST emit one audit event per removed artifact (see [012-log.md](012-log.md)).

## 11. Dependency & Test Hygiene

- [ ] Lint (`make lint`) MUST fail on banned patterns: `eval(`, `yaml.load(` without SafeLoader, `shell=True` in `subprocess` calls, `--privileged` in any compose or shell script, `mode=0o777`.
- [ ] A dedicated security test module MUST exist at `tests/python/integration/test_security_hardening.py` and MUST run on the host with access to the Docker socket. It MUST NOT execute inside the API container.
- [ ] The test module MUST cover:
  - one-container-per-deploy invariant (two concurrent deploys → two distinct container IDs),
  - capability drop on runner (inspect `CapEff` via `docker inspect`),
  - read-only root on runner,
  - runner attached only to a `job-<id>` network with `internal: true` and no default bridge membership,
  - Mode A target reachability: target service is reachable from runner on `job-<id>`,
  - Mode B egress sidecar: sidecar accepts only TCP-22 to the configured inventory host,
  - secret-file mode `0400`, directory mode `0700`, unlink-within-5 s after terminal state,
  - runner entrypoint creates `/run/inventory/group_vars/all/_secrets.yml` with only path references, no literal secrets, and unlinks it on exit,
  - workspace-isolation cross-access returns `404` or `403`, never leaking existence,
  - Zip-Slip rejection on import,
  - rate-limit trigger on deployment creation (both hourly window via DB and concurrent count via `runner-manager`), including verification that `rate_limit_events` rows carry the documented primary key and that cleanup removes expired rows,
  - Mode B sidecar capability profile: only `NET_ADMIN` retained, default-drop ruleset active, allowlist contains only inventory-derived `(ip, 22/tcp)` tuples,
  - masking preserves the `[RX:<unix_ms>] ` prefix on every line across stdout, SSE, and persisted `job.log`,
  - CORS rejection of an unlisted origin,
  - CSP header presence and nonce freshness across two requests (two distinct 128-bit values),
  - CSRF double-submit rejection in anonymous mode,
  - `init-manager-token` rewrites `/auth/token` on stack restart.
- [ ] `make test-perf` and `make e2e-dashboard-ci` MUST continue to pass with all above controls enabled; a control that can only be met by disabling an existing test is a failure.

## Acceptance Criteria

### Job Runner Isolation

- [ ] Two concurrent deployments from the same workspace produce two distinct container IDs with matching `infinito.deployer.job_id` labels.
- [ ] Each runner container exits within 10 s of its job's terminal state.
- [ ] Runner containers run as UID `10002`, with `cap_drop: [ALL]`, `--read-only` root, no Docker socket, no `--privileged`, no host networking or PID.
- [ ] `runner-manager` rejects any operation whose request `workspace_id` does not match the container's `infinito.deployer.workspace_id` label.

### Control Plane

- [ ] `runner-manager` service exists in compose with `/var/run/docker.sock` mounted only there.
- [ ] API, web, db, catalog, and all runners have no Docker socket access.
- [ ] `runner-manager`'s API surface is limited to the five documented endpoints; Pydantic-validated job spec with allowlisted fields.
- [ ] `init-manager-token` generates a 256-bit token on every stack startup; API and `runner-manager` both read it from the `manager-auth` named volume; missing/invalid token returns `401`.

### Secret Lifecycle

- [ ] No plaintext password file exists outside the KDBX at any point during or after deployment.
- [ ] Secrets reach the runner at exactly `/run/secrets/infinito/{ssh_key,ssh_password,vault_password,credentials.kdbx}` with mode `0400` on an 8 MiB tmpfs mounted `noexec,nosuid,nodev`.
- [ ] Runner receives only `INFINITO_SECRETS_DIR`; no secret value appears in its env, args, or stdin.
- [ ] Runner entrypoint emits `/run/inventory/group_vars/all/_secrets.yml` with only `lookup('file', ...)` references; the file is removed on exit.
- [ ] `ANSIBLE_VAULT_PASSWORD_FILE` is set to the tmpfs vault-password path when a vault password is present.
- [ ] Tmpfs is unmounted and cleaned within 5 s of terminal state and on API/runner-manager restart.
- [ ] No plaintext secret appears in API logs, SSE streams, persisted `job.log`, or any `state/perf/016/*.json`.

### Workspace Isolation

- [ ] Cross-workspace read/list/write/rename/delete attempts return `404` or `403` without disclosing the target resource's existence.
- [ ] Workspace IDs are UUIDv4 (or longer, equally unguessable).
- [ ] With OAuth2 Proxy enabled, requests for a workspace whose persisted owner differs from the upstream identity are rejected.

### Transport & Auth

- [ ] API rejects CORS origins not in `ALLOWED_ORIGINS`; wildcard causes startup failure.
- [ ] Web serves the documented CSP with a fresh per-request nonce and no external icon-CDN allowance.
- [ ] Security headers (`X-Content-Type-Options`, `Referrer-Policy`) are present on the documented endpoints.
- [ ] OAuth2 mode: `SameSite=Strict` session cookie enforced; anonymous mode: double-submit CSRF (`csrf` cookie + `Sec-CSRF` header) enforced; `csrf` cookie regenerated on new session.
- [ ] Deployment creation is rate-limited by hourly DB-backed count and concurrent count via `runner-manager`; test-connection by per-minute DB count; all keyed on `(workspace_id, client_ip)`; `429` on limit.

### Input Validation

- [ ] Endpoints reject untyped `dict[str, Any]` bodies.
- [ ] Role IDs outside the allowed regex are rejected.
- [ ] `yaml.safe_load` is used everywhere; CI lint fails on `yaml.load(` without SafeLoader.
- [ ] Body size and nesting limits are enforced and configurable via env.
- [ ] ZIP imports reject path-traversal, symlink, and world-writable entries.

### Supply Chain

- [ ] All CI/production images are pinned by digest; unpinned images fail CI.
- [ ] Local `make` emits a visible warning on unpinned images.
- [ ] Python install uses hash-checking lock in the production image.
- [ ] Node install uses `npm ci`.
- [ ] `pip-audit` and `npm audit --audit-level=critical` run per PR and fail on unmitigated Critical CVEs in first-party declarations.

### Network

- [ ] Every job is attached to a dedicated `job-<id>` bridge network with `internal: true`; the runner has no other network membership.
- [ ] Mode A (Compose target) and Mode B (SSH egress sidecar) are the only supported target reachability paths; jobs with out-of-policy hosts are rejected at submission.
- [ ] SSH egress sidecar forwards only TCP-22 to inventory hosts and audits every connection attempt.
- [ ] In Phase 1, outbound internet from the runner fails unless an `egress-proxy` is deployed and allowlisted.
- [ ] API outbound is limited to the documented allowlist.
- [ ] `runner-manager` has no outbound internet access.

### Stack Hardening

- [ ] All services declare `cap_drop: [ALL]` and `no-new-privileges:true`.
- [ ] No production service runs as root at request-handling time.
- [ ] Healthchecks exist for all documented services and do not leak sensitive data.

### Cancellation & Cleanup

- [ ] Cancel via `runner-manager`: `SIGTERM` within 5 s, `SIGKILL` at 10 s.
- [ ] Orphan sweep removes stale containers, `job-*` networks, `ssh-egress-*` sidecars, and workspace job dirs per retention window and emits audit events.

### Hygiene

- [ ] `tests/python/integration/test_security_hardening.py` exists, runs on the host with Docker-socket access, and covers the listed controls (including CSP nonce freshness, CSRF double-submit rejection, token rotation, and Mode A/B reachability).
- [ ] `make lint` fails on the banned patterns.
- [ ] Existing `make test`, `make test-perf`, and `make e2e-dashboard-ci` pass unchanged with all controls enabled.
