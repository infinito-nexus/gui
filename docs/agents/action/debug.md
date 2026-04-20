# Debugging 🐞

- On a local failure, you MUST debug from the live local output and logs (`make logs`); for the retry loop you MUST follow [iteration.md](iteration.md).
- On a CI failure, you MUST follow [CI Failures](../../contributing/flow/debugging/ci.md) and you MUST treat the downloaded `*job-logs.txt` / `*.log` files as the source of truth.
- A long-running run that the user has not asked you to steer away from MUST be left to finish; you MUST NOT interrupt it.
