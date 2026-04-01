# Unit Tests

This page is the SPOT for unit testing requirements, framework, and structure.
Run all tests with `make test`.

## Python Unit Tests

- You MUST use Python `unittest` as the test framework for backend tests.
- Tests MUST live under `tests/python/unit/`.
- Mirror the source tree: a file at `apps/api/services/foo.py` gets its tests at `tests/python/unit/test_foo.py`.

### Requirements

- You MUST add or update unit tests for every `*.py` file you touch.
- Each test MUST cover one isolated behavior. Do not test multiple concerns in a single test method.
- You MUST NOT write tests that only assert a file contains a string.
- You SHOULD name test methods after the behavior they verify, not the function name alone (e.g. `test_returns_empty_list_when_no_items`).
- You SHOULD cover edge cases — empty inputs, missing keys, boundary values — not only the happy path.
- You MAY use `unittest.mock` to isolate the unit under test from external state or I/O.

### How to Create

1. Identify the module under test (e.g. `apps/api/services/foo.py`).
2. Create the matching test file under `tests/python/unit/` if it does not exist.
3. Subclass `unittest.TestCase`.
4. Write one method per behavior. Build hypotheses before writing assertions.
5. Run `make test` and verify all tests pass.

## Node Unit Tests

- You MUST use Node's built-in `node:test` runner for frontend unit tests.
- Tests MUST live under `tests/node/unit/` and use the `.mjs` extension.
- Mirror the source tree where practical.

### Requirements

- You MUST add or update Node tests for every frontend utility or component logic you touch.
- Each test MUST cover one isolated behavior.
- You SHOULD cover edge cases and not only the happy path.

### How to Create

1. Create the matching test file under `tests/node/unit/` with a `.mjs` extension.
2. Import the module under test.
3. Write one `test()` block per behavior.
4. Run `make test` and verify all tests pass.
