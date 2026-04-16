# Docker and Runtime Commands

Use this page for the Docker/runtime context around the project.
The canonical `make` command index lives in [makefile.md](makefile.md).

## Scope

- Use [makefile.md](makefile.md) when you want the concrete repository targets.
- Use [Testing and Validation](../testing/common.md) for lint, unit, and integration guidance.

## Notes

- The local runtime is driven from the repository root through Make targets.
- Keep Docker-specific explanations here and keep the command reference in [makefile.md](makefile.md).
- The stack uses Docker Compose v2. Use `docker compose` (not `docker-compose`), unless the `DOCKER_COMPOSE` variable is overridden.
