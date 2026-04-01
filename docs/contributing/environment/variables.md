# Environment Variables

This page documents the environment variables that drive the development stack and test flows.

App-specific container variables live in `docker-compose.yml` or the `.env` file copied from `env.example`.

## Makefile Inputs

| Variable | Purpose | Default | Defined in |
|---|---|---|---|
| `DOCKER_COMPOSE` | Docker Compose command to use. | `docker compose` | [Makefile](../../../Makefile) |
| `COMPOSE_FILE` | Compose file to use. | `docker-compose.yml` | [Makefile](../../../Makefile) |
| `ENV_FILE` | Env file passed to Compose. | `.env` | [Makefile](../../../Makefile) |
| `VENV_DIR` | Python virtual environment path. | `.venv` | [Makefile](../../../Makefile) |
| `TEST_STATE_DIR` | State directory used during tests. | `$(PWD)/state` | [Makefile](../../../Makefile) |
| `EXAMPLE_WORKSPACE_DIR` | Source directory for workspace ZIP export. | `examples/workspace` | [Makefile](../../../Makefile) |
| `EXAMPLE_WORKSPACE_ZIP` | Output path for workspace ZIP export. | `examples/workspace-import.zip` | [Makefile](../../../Makefile) |

## Runtime

| Variable | Purpose |
|---|---|
| `PYTHONPATH` | Set to `$(PWD)/apps/api` so tests can import app packages directly. |
| `STATE_DIR` | Injected into test runs to point to the local state directory. |

## Notes

- Copy `env.example` to `.env` before starting the stack (`make setup` does this automatically).
- Do NOT commit `.env` to the repository — it is listed in `.gitignore`.
- Service-specific variables (database credentials, API keys) are defined in `env.example` with safe defaults for local development.
