# Setup Guide 🚀

This guide is the SPOT for local runtime setup, environment variables, database initialization, job runner configuration, and the SSH test environment.

For a quick overview, see the [README](../README.md). For contributor workflow and validation requirements, see [Development Environment Setup](contributing/environment/setup.md) and [Testing and Validation](contributing/flow/testing.md).

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
| `INFINITO_NEXUS_IMAGE` | Source image used to seed the bundled Infinito.Nexus repository and the default job runner fallback | `ghcr.io/kevinveenbirkenbach/infinito-debian:latest` |
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
- `INFINITO_REPO_HOST_PATH` is NOT part of the default runtime path. Use `JOB_RUNNER_REPO_HOST_PATH` when a custom runner needs a host-mounted checkout.

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

The SPOT for repository `make` targets is [makefile.md](contributing/tools/makefile.md).

## SSH Test Environment

The repository ships a small SSH test stack for testing deployment flows:

```bash
make test-env-up
```

See [Test.md](../Test.md) for credentials and usage.

Stop the test environment:

```bash
make test-env-down
```

## URLs After Startup

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API Health | http://localhost:8000/health |
