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
| `POSTGRES_PASSWORD` | Database password | `infinito` |
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

### Password auth service

- Host (from API container): `ssh-password`
- Port (from API container): `22`
- User: `deploy`
- Password: `deploy`

Connect from host:

```bash
ssh -p 2222 deploy@localhost
```

Use in UI/API (container-to-container):

```
Host: ssh-password
Port: 22
User: deploy
Password: deploy
```

### Key auth service

- Host (from API container): `ssh-key`
- Port (from API container): `22`
- User: `deploy`
- Private key: `apps/test/ssh-key/test_id_ed25519`
- Public key: `apps/test/ssh-key/test_id_ed25519.pub`

Connect from host:

```bash
ssh -i apps/test/ssh-key/test_id_ed25519 -p 2223 deploy@localhost
```

If SSH asks about host key verification, bypass it for the test:

```bash
ssh -o StrictHostKeyChecking=no -i apps/test/ssh-key/test_id_ed25519 -p 2223 deploy@localhost
```

### Embedded test key (copy/paste)

Private key:

```text
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCigUtlFhiovSEc9m/iY5AFhogJBQ68Z50F4rni0Eyg8wAAAJAf/nTxH/50
8QAAAAtzc2gtZWQyNTUxOQAAACCigUtlFhiovSEc9m/iY5AFhogJBQ68Z50F4rni0Eyg8w
AAAEBR9gZgUzGGRDOPEelNGNYk4qCapNn0TKobNocdi1kQsKKBS2UWGKi9IRz2b+JjkAWG
iAkFDrxnnQXiueLQTKDzAAAADWluZmluaXRvLXRlc3Q=
-----END OPENSSH PRIVATE KEY-----
```

Public key:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKKBS2UWGKi9IRz2b+JjkAWGiAkFDrxnnQXiueLQTKDz infinito-test
```

### Notes

- These credentials are for local testing only.
- The `ssh-key` service uses `apps/test/ssh-key/authorized_keys`, already populated with the public key above.

### Legacy compose file (optional)

```bash
docker compose -f docker-compose.ssh-test.yml up -d --build
```

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

Credentials are intentionally NOT stored in the workspace. Enter them in the UI when prompted:

| Field | Value |
|---|---|
| auth method | `password` |
| password | `deploy` |

## URLs After Startup

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API Health | http://localhost:8000/health |
