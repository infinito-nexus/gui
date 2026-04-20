# Development 🧑‍💻

- You MUST treat [CONTRIBUTING.md](../../../CONTRIBUTING.md) as the SPOT for the general development workflow, testing, and review.
- You MUST start from the smallest change that can be validated locally; you MUST expand only when requirements demand it.
- You MUST keep implementation, local validation, and test coverage in sync.
- You MUST keep backend logic in `apps/api/` and frontend logic in `apps/web/`. You MUST NOT mix responsibilities across the boundary.

## Tests 🧪

- You MUST add or update tests for every code file you touch — see [Unit Tests](../../contributing/code/tests/unit.md) and [Integration Tests](../../contributing/code/tests/integration.md).
- For frontend changes, you MUST update or add Node tests under `tests/node/`.

## Documentation 📝

- You MUST capture open development work in `TODO.md` so remaining items stay visible.
- The root `README.md` describes what the project does. When a TODO is completed, you MUST promote the finished capability into `README.md` and remove the TODO entry.

## Bugs and Warnings 🐛

- You MUST treat warnings about the concrete implementation, wiring, or runtime behavior as bugs and fix them. You MUST NOT normalize them.
- If a warning points to an intentional exception, you MUST make the exception explicit and leave a visible follow-up.

## Review 👀

- You MUST verify end-to-end behavior, not just that the code compiles or starts.
- You SHOULD fix the real bug rather than comment around it.

## Debugging 🐞

- On failure, you MUST switch to [debug.md](debug.md). For the local retry loop you MUST follow [iteration.md](iteration.md).
