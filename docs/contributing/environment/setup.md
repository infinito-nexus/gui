# Development Environment Setup

Use the repository's real setup flow. [makefile.md](../tools/makefile.md) is the SPOT for contributor-facing `make` targets, and [Testing and Validation](../flow/testing.md) is the SPOT for validation requirements.

## Prerequisites

- Docker and Docker Compose v2
- Python 3.10+
- Node.js 20+
- `make`

## Bootstrap

Run these commands from the repository root:

```bash
make setup
```

`make setup` copies `env.example` to `.env` (if not present), creates the `state/` directory, and starts the full stack.

### Bootstrap Commands

| Phase | Command | What it does |
|---|---|---|
| Full setup | `make setup` | Creates `.env`, ensures `state/`, and starts the stack. |
| Start stack | `make up` | Starts the stack (builds images if missing). |
| Stop stack | `make down` | Stops and removes containers. |
| Restart stack | `make restart` | Stops and starts the stack. |
| Follow logs | `make logs` | Tails logs from all running services. |

## Test Environment

The repository includes a small SSH test stack for testing deployment flows:

- See [Test.md](../../../Test.md) for credentials and usage.
- Start with `make test-env-up`, stop with `make test-env-down`.

## Full Development Flow

| Step | Command | Purpose |
|---|---|---|
| 1 | `make setup` | Bootstrap the environment and start the stack. |
| 2 | `make test` | Run the combined validation when [Testing and Validation](../flow/testing.md) requires it. |
| 3 | `make logs` | Follow live service output. |
| 4 | `make down` | Stop the stack when done. |
