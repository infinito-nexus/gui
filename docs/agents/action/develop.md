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

## Inline-Script Extraction Rule 📜

`*.yml` (CI workflows, GitHub Actions, docker-compose) and `Makefile` files MUST stay thin glue. They MUST NOT carry substantive shell, python, or other scripting logic inline.

Trigger: an inline `run:` / Makefile recipe / compose `command:` block contains ANY of:

- more than 5 non-blank, non-comment lines, OR
- a `for` / `while` / `case` block, OR
- a multi-statement `if`/`elif`/`else` chain, OR
- shell-quoting that needs `$$`, `\\`, or nested heredocs, OR
- inline python / awk / sed scripts longer than one line.

When the trigger fires:

- Shell logic MUST be extracted to a file under `scripts/<area>/<verb>.sh` (e.g. `scripts/ci/dump-container-logs.sh`, `scripts/workspace-perms/repair.sh`). The script MUST start with `#!/usr/bin/env bash`, `set -euo pipefail`, and a usage header comment.
- Python logic MUST be extracted to a file under `scripts/<area>/<verb>.py` OR into the relevant `apps/api/` package and called via the existing CLI / `python -m` entry point.
- The `*.yml` / `Makefile` site MUST then call the extracted script with one line (`bash scripts/<area>/<verb>.sh "$ARG"`), passing arguments explicitly. No re-implementing the same logic in two places.

The extracted script MUST be tracked, executable, and covered by `make lint` (shellcheck + shfmt for `.sh`, ruff for `.py`).

This rule overrides any temptation to keep "just one quick `for` loop" inline. Two callers ⇒ shared script. One caller now ⇒ shared script anyway, because shellcheck/shfmt does not run on inline yml/Make blocks.
