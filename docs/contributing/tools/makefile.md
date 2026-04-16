# Makefile Commands

Use these commands from the repository root. This is the SPOT for `make` targets in infinito-deployer.
[Testing and Validation](../testing/common.md) is the SPOT for when validation commands are required.

## Stack Management

| Category | Command | What it does | When to use it |
|---|---|---|---|
| Full setup | `make setup` | Creates `.env` from `env.example` (if missing), ensures `state/` exists, and starts the stack. | Use this on a fresh checkout or after `make clean`. |
| Start stack | `make up` | Starts the stack via Docker Compose, building images if needed. | Use this to bring the development stack online. |
| Stop stack | `make down` | Stops and removes containers. | Use this for a clean shutdown. |
| Restart stack | `make restart` | Stops and starts the stack. | Use this after configuration changes. |
| Follow logs | `make logs` | Tails logs from all running services (last 200 lines). | Use this to monitor the running stack. |
| Check status | `make ps` | Lists running containers and their state. | Use this to see what is running. |

## Database

| Category | Command | What it does | When to use it |
|---|---|---|---|
| Start database | `make db-up` | Starts only the Postgres service. | Use this when you only need the database. |
| Stop database | `make db-stop` | Stops the Postgres service. | Use this to stop the database without stopping the whole stack. |
| Database logs | `make db-logs` | Tails Postgres logs. | Use this when debugging database issues. |
| Wait for database | `make db-wait` | Blocks until Postgres is ready to accept connections. | Use this in scripts that depend on the database being available. |
| Open psql | `make db-psql` | Opens an interactive psql session. | Use this for ad-hoc database inspection. |
| Init requirements | `make requirements-init` | Starts the database, waits for it, and ensures the requirements schema exists. | Use this to bootstrap the requirements store. |

## Frontend

| Category | Command | What it does | When to use it |
|---|---|---|---|
| Sync web build | `make web-sync` | Rebuilds the Next.js app and syncs it into the running `web` container. | Use this after frontend changes to avoid a full stack restart. |
| Refresh catalog | `make refresh-catalog` | Recreates the catalog container and restarts the API. | Use this after catalog configuration changes. |

## Testing

| Category | Command | What it does | When to use it |
|---|---|---|---|
| Install dependencies | `make install` | Creates `.venv` and installs Python dependencies. | Use this before running tests on a fresh checkout. |
| Run all tests | `make test` | Runs Python unit tests, Python integration tests, Node unit tests, and Node integration tests when present. | Use this when [Testing and Validation](../testing/common.md) requires combined validation, or when you want the full local suite. |
| Start test env | `make test-env-up` | Starts the SSH test environment (compose test profile). | Use this when testing SSH-based deployment flows. |
| Stop test env | `make test-env-down` | Stops the SSH test environment. | Use this to clean up the test environment. |
| Start arch test | `make test-arch` | Starts the architecture test container. | Use this for architecture validation. |

## Utilities

| Category | Command | What it does | When to use it |
|---|---|---|---|
| Create `.env` | `make env` | Copies `env.example` to `.env` if not present. | Use this when `.env` is missing. |
| Ensure `state/` | `make dirs` | Creates the `state/` directory. | Use this when the state directory is missing. |
| Clean | `make clean` | Removes `.venv/` and `state/`. | Use this for a clean slate before `make setup`. |
| Create workspace ZIP | `make example-workspace-zip` | Packages `examples/workspace/` into `examples/workspace-import.zip`. | Use this to update the bundled example workspace. |

## Notes

- Override the Compose command with `DOCKER_COMPOSE="docker-compose" make <target>` if Docker Compose v1 is required.
- Override the Compose file with `COMPOSE_FILE=other.yml make <target>`.
- Override the env file with `ENV_FILE=.env.local make <target>`.
