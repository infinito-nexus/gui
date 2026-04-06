# Lint

You MUST use these linting and quality tools where applicable:

- [ruff](https://github.com/astral-sh/ruff) — Python linting and formatting
- [ESLint](https://eslint.org/) — frontend JavaScript/TypeScript linting (`npm run lint` in `apps/web/`)
- TypeScript compiler — frontend type checking (`npm run typecheck` in `apps/web/`)

## Running Lint

- Python: `ruff check .` from the repository root (run automatically in CI via [ruff.yml](../../../../.github/workflows/ruff.yml))
- Frontend: `npm run lint` and `npm run typecheck` in `apps/web/`
- Max file length check: `./scripts/check-max-lines.sh` (run automatically in CI)

## Repository Lint Rules

You MUST apply these repo-wide rules when you add, move, or review files:

- Keep broad folders shallow when that helps readability. Direct children SHOULD stay at 12 or fewer items per folder.
- You SHOULD prefer smaller, more focused folders over dumping many unrelated files into one directory.

For refactoring guidance, see [Refactoring](../../flow/refactoring.md).
