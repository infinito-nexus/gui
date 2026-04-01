# Debugging

Use the failure source to decide how to debug:

- If the failure happened during a local run, you MUST debug from the live local output and local logs (`make logs`).
- If the failure comes from GitHub CI, you MUST follow [CI Failures](../../contributing/flow/debugging/ci.md) and work from the downloaded `*job-logs.txt` or `*.log` files.
- If a run is still progressing and the user has not asked you to change course, you MUST wait for the long-running run to finish instead of interrupting it.

## Local Failures

### Retry Loop

For the shared local retry loop, you MUST follow [Iteration](iteration.md).

## GitHub and CI Logs

- You MUST inspect relevant logs in `*job-logs.txt` or `*.log`.
- You MUST treat the downloaded GitHub logs as the source of truth for CI failures.
