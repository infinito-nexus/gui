# Integration Tests

This page is the SPOT for integration testing requirements, framework, and structure.
Run all tests with `make test`.

## Python Integration Tests

- You MUST use Python `unittest` as the test framework.
- Tests MUST live under `tests/python/integration/`.

### When to Write

- You MUST add or update integration tests when the change affects behavior across module or runtime boundaries.
- Write an integration test when the behavior you are verifying depends on two or more components working together — for example, an API endpoint interacting with the database layer or a service reading from the filesystem.

### Requirements

- You MUST NOT mock collaborators that are part of the integration boundary being tested. The point is to verify real interaction.
- You MUST NOT write tests that only assert a file contains a string.
- You SHOULD keep each test focused on one integration boundary.
- You SHOULD test realistic inputs that match what the application would receive at runtime.
- You MAY use `unittest.mock` to stub out external services or I/O that is genuinely outside the integration scope.

### How to Create

1. Identify the integration boundary (e.g. API service + database).
2. Create the matching test file under `tests/python/integration/` if it does not exist.
3. Subclass `unittest.TestCase`.
4. Use realistic inputs. Build hypotheses about cross-component behavior before writing assertions.
5. Run `make test` and verify all tests pass.

## Node Integration Tests

- Tests MUST live under `tests/node/integration/` and use the `.mjs` extension.
- Follow the same principles as Python integration tests — test real cross-component behavior.
