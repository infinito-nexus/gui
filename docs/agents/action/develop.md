# Development

## System

- You MUST use [CONTRIBUTING.md](../../../CONTRIBUTING.md) as the SPOT for the general development workflow, testing, review, and the code and development guides.
- Start from the smallest change that can be validated locally, then expand only when the requirements or behavior demand it.
- Keep the implementation, local validation, and test coverage in sync so the change can be reviewed without guessing the intent.

## New Features and Bug Fixes

- You MUST add or update tests for every code file you touch — see [Unit Tests](../../contributing/code/tests/unit.md) and [Integration Tests](../../contributing/code/tests/integration.md).
- For frontend changes, update or add Node tests under `tests/node/` accordingly.
- Keep backend logic in `apps/api/` and frontend logic in `apps/web/` — do not mix responsibilities across the boundary.

### Documentation

- Capture open development requirements in a `TODO.md` file so remaining work stays visible.
- Keep the root `README.md` as the clear description of what the project does.
- When a TODO is completed, you MUST promote the finished capability into `README.md` and remove the TODO entry.

## Bugs and Warnings

- You MUST treat warnings about the concrete implementation, wiring, or runtime behavior as bugs that should be fixed.
- Do NOT leave implementation warnings unresolved just because they are inconvenient.
- If a warning points to an intentional exception, make the exception explicit and keep the follow-up visible.

## Debugging

- When a development run fails, you MUST switch to [Debugging](debug.md) and follow the local or GitHub-log path that matches the failure source.
- For the shared local retry loop during debugging or development, you MUST follow [Iteration](iteration.md).
- Keep long-running runs alive and wait for them to finish unless the user explicitly asks you to steer away from them.

## Review Focus

- You MUST verify that the change behaves correctly end to end, not just whether it compiles or starts.
- Prefer fixing the real bug over adding a comment that explains it away.
- Treat temporary warnings as a signal to remove the underlying problem later, not as a reason to normalize the exception.
