# CI Failures and Debugging 🐛

If CI fails, follow a clean debugging workflow:

1. Export the raw failing logs from GitHub Actions.
2. Save them locally as `job-logs.txt`.
3. Decide whether the failure belongs to your branch or to something unrelated.
4. Fix related failures in the same branch.
5. Open an issue for unrelated failures instead of mixing them into your branch.

## Important 🚨

- You MUST NOT debug from screenshots alone. Use raw logs.
- You MUST NOT commit log files to the repository.

## Manual CI Reruns 🎯

You SHOULD use targeted reruns instead of triggering the full pipeline when only one job is suspected.

- Use the GitHub Actions UI to rerun only the failing job.
- Check if the failure is flaky before committing a fix.
