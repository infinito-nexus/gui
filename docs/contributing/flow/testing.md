# Testing and Validation

Use the real commands from the repository. Run them from the repository root.
This page is the SPOT for local validation requirements and command scope. Other documents MAY summarize validation commands, but they MUST defer to this page for when a check is required.

This repository uses several test and validation types:

- `Lint` catches style, formatting, and type problems early.
- `Unit tests` verify isolated logic.
- `Integration tests` verify behavior across module or runtime boundaries.
- `Combined validation` runs all tests together.
- `Frontend quality` covers lint, typecheck, and end-to-end tests for the web app.

## Validation Commands

| Category | Command | What it does | When to use it |
|---|---|---|---|
| Python lint | `ruff check .` | Runs ruff lint checks for all Python files. | Use this when you changed Python code. |
| Frontend lint | `npm run lint` (in `apps/web/`) | Runs ESLint on the frontend. | Use this when you changed frontend code. |
| Frontend typecheck | `npm run typecheck` (in `apps/web/`) | Runs TypeScript type checking. | Use this when you changed TypeScript code. |
| Combined validation | `make test` | Runs Python unit tests, Python integration tests, Node unit tests, and Node integration tests when present. | Use this whenever a change touches at least one file that is not `.md` or `.rst`. Documentation-only and agent-only changes MAY skip the test suite unless you are explicitly asked to run it. |
| Frontend e2e | `npm run test:e2e` (in `apps/web/`) | Runs Playwright end-to-end tests. | Use this when you changed frontend flows. |

Before you open a Pull Request, you MUST run the validation required for your change type from this page.

## Testing Standards

For test-type-specific requirements, framework, and creation procedures see:

- [Unit Tests](../code/tests/unit.md)
- [Integration Tests](../code/tests/integration.md)
- [Lint](../code/tests/lint.md)
