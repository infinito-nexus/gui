# Setup Guide 🚀

This guide is the SPOT for local runtime setup, environment variables, database initialization, job runner configuration, and the SSH test environment.

For a quick overview, see the [README](../../../README.md). For contributor workflow and validation requirements, see [Development Environment Setup](../environment/setup.md) and [Testing and Validation](common.md).

## Prerequisites

- Docker Engine and Docker Compose v2 (`docker compose`)
- An optional local checkout of [Infinito.Nexus](https://github.com/kevinveenbirkenbach/infinito-nexus) only if you plan to mount a host repository into custom job runner containers via `JOB_RUNNER_REPO_HOST_PATH`

## One-Time Setup

```bash
git clone https://github.com/kevinveenbirkenbach/infinito-deployer
cd infinito-deployer
make setup
```

`make setup` performs the following steps:

- creates `.env` from `env.example` (if it does not exist)
- ensures the `./state` directory exists
- starts the full Docker Compose stack (including image builds)

The default stack seeds the required Infinito.Nexus repository content from `INFINITO_NEXUS_IMAGE`, so a host checkout is not required for the default setup.

## Environment Variables

Copy `env.example` to `.env` and adjust the following runtime-facing variables when needed:

| Variable | Purpose | Example |
|---|---|---|
| `INFINITO_NEXUS_IMAGE` | Source image used to seed the bundled Infinito.Nexus repository and the default job runner fallback | `ghcr.io/infinito-nexus/core/debian:latest` |
| `CORS_ALLOW_ORIGINS` | Allowed CORS origins for the API | `http://localhost:3000` |
| `NEXT_PUBLIC_API_BASE_URL` | Optional browser-side API base URL override; leave it empty to use the local `/api` proxy | `(empty)` |
| `POSTGRES_HOST` | Postgres hostname | `db` |
| `POSTGRES_PORT` | Postgres port | `5432` |
| `POSTGRES_DB` | Database name | `infinito_deployer` |
| `POSTGRES_USER` | Database user | `infinito` |
| `POSTGRES_PASSWORD` | Database password (test-only default — see [credentials.md](credentials.md)) | `infinito` |
| `STATE_HOST_PATH` | Host path for persistent state; `./state` works for local startup, but containerized deployment jobs require an absolute path | `./state` |
| `JOB_RUNNER_IMAGE` | Optional override for deployment job containers; falls back to `INFINITO_NEXUS_IMAGE` when unset | `(unset)` |
| `JOB_RUNNER_REPO_HOST_PATH` | Optional absolute host path to mount a repository into a custom runner container | `/absolute/path/to/infinito-nexus` |
| `JOB_RUNNER_DOCKER_BIN` | Optional Docker CLI override inside the API container | `docker` |

Notes:

- `NEXT_PUBLIC_API_BASE_URL` SHOULD stay empty for the default local stack so the web app can use the built-in `/api` proxy.
- `STATE_HOST_PATH` MAY stay relative for local startup, but it MUST be absolute before you run containerized deployment jobs from the API.
- Use `JOB_RUNNER_REPO_HOST_PATH` when a custom runner needs a host-mounted checkout.

## Database Initialization

Start only the database:

```bash
make db-up
```

Wait until Postgres is ready:

```bash
make db-wait
```

Initialize the requirements schema (idempotent):

```bash
make requirements-init
```

Open an interactive SQL shell:

```bash
make db-psql
```

## Job Runner

Deployments run in a dedicated container per job. Requirements:

- The default local stack MAY start with `STATE_HOST_PATH=./state`, but containerized deployment jobs MUST use an absolute `STATE_HOST_PATH`.
- The Docker socket mount MUST be enabled for the API container in `docker-compose.yml`.
- `JOB_RUNNER_REPO_HOST_PATH` SHOULD be set only when your runner image needs a host-mounted repository checkout.
- When `JOB_RUNNER_IMAGE` is unset, the runner falls back to `INFINITO_NEXUS_IMAGE`.

For stronger isolation, the job runner can be moved into a separate service that owns the Docker socket.

## OAuth2 Proxy Expectations

When the stack runs behind OAuth2 Proxy, the proxy remains responsible for the authenticated session cookie.

- The upstream session cookie MUST be configured with `Secure`, `HttpOnly`, and `SameSite=Strict`.
- Anonymous mode keeps using the deployer's `csrf` session cookie plus the `X-CSRF` header for double-submit protection.
- OAuth2 Proxy mode does not require an additional API-side CSRF token beyond the hardened proxy session cookie.

## Stack Commands

| Command | What it does |
|---|---|
| `make up` | Start the full stack. |
| `make down` | Stop and remove containers. |
| `make restart` | Restart the full stack. |
| `make logs` | Follow logs from all services. |
| `make db-logs` | Follow Postgres logs only. |
| `make refresh-catalog` | Reload the catalog (invokable apps) and restart the API. |

The SPOT for repository `make` targets is [makefile.md](../tools/makefile.md).

## SSH Test Environment

The repository ships a small SSH test stack with two services:

- `ssh-password` (password authentication)
- `ssh-key` (public key authentication)

Start and stop via `make`:

```bash
make test-env-up
make test-env-down
```

Alternatively via compose profile:

```bash
docker compose --profile test up -d --build
docker compose --profile test down
```

### Connecting

Both services answer on the host as well as inside the compose network. The user and password / key reference are listed in [credentials.md](credentials.md); the connect commands are:

```bash
# password auth (host port 2222)
ssh -p 2222 deploy@localhost

# key auth (host port 2223)
ssh -i apps/test/ssh-key/test_id_ed25519 -p 2223 deploy@localhost
```

If SSH asks about host-key verification, append `-o StrictHostKeyChecking=no`. From inside the compose network the hosts are `ssh-password` / `ssh-key` on container port `22`. The `ssh-key` service uses `apps/test/ssh-key/authorized_keys`, already populated with the embedded test public key.

### Legacy compose file (optional)

```bash
docker compose -f docker-compose.ssh-test.yml up -d --build
```

## OIDC E2E Test Stack

The repository ships a self-contained OIDC login flow for end-to-end testing of the OAuth2-Proxy auth contract from [requirement 007](../../requirements/007-optional-auth-persistent-workspaces.md). It pairs `oauth2-proxy` (same image as in production) with `oidc-mock` (a seeded dummy IdP), both gated behind the `test` Compose profile. See [requirement 020](../../requirements/020-oidc-e2e-via-dummy-provider.md) for the architecture.

`make test-env-up` brings up the full test profile, which includes the OIDC pair alongside the SSH test services. Login entry point on the host: <http://localhost:4180>. The proxy redirects to the mock IdP's `/Account/Login`; after submitting credentials, the callback returns to `:4180` with `X-Auth-Request-User` / `X-Auth-Request-Email` set on every upstream request.

### Seeded users and OIDC client

The seeded usernames, passwords, the OIDC client id / client secret, and the cookie-secret rotation policy are listed in [credentials.md](credentials.md). All values are hard-coded in [docker-compose.yml](../../../docker-compose.yml) under the `oidc-mock` and `oauth2-proxy` services.

### Notes

- Both services are in the `test` Compose profile only; `make up` does not start them, and only port `4180` is exposed on the host.
- Used by the Playwright spec at [apps/web/tests/oidc_login.spec.ts](../../../apps/web/tests/oidc_login.spec.ts) and as the auth lane for `make e2e-dashboard-ci-docker-oidc`.

## Example Workspace Import

The repository ships a ready-to-import workspace baseline at [examples/workspace/](../../../examples/workspace/) and a packaged archive at [examples/workspace-import.zip](../../../examples/workspace-import.zip). The baseline targets the `test-arch` container started by `make test-env-up`.

Rebuild the archive after editing any file under `examples/workspace/`:

```bash
make example-workspace-zip
```

Import it in the Web UI:

1. Start both stacks: `make up` and `make test-env-up`.
2. Open http://localhost:3000, sign in, and navigate to **Workspace → Import**.
3. Upload `examples/workspace-import.zip`.

The baseline contains:

| File | Purpose |
|---|---|
| `inventory.yml` | empty `all.children` so apps can be picked in the UI |
| `host_vars/test-arch.yml` | presets `ansible_host`, `ansible_user`, `ansible_port`, `DOMAIN_PRIMARY` for `test-arch` |
| `group_vars/all.yml` | disables SSH host-key checks for local runs |

Credentials are intentionally NOT stored in the workspace. Enter them in the UI when prompted; the values are listed in [credentials.md](credentials.md) under "Workspace Import".

## URLs After Startup

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API Health | http://localhost:8000/health |
