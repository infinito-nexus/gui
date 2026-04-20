# Committing 💾

- You MUST run `make autoformat` before every commit and stage every file it modified.
- You MUST run `make test` (see [Testing and Validation](../../contributing/testing/common.md)) before every commit when the staged change includes at least one non-`.md`/`.rst` file. If it fails, you MUST run `make clean` and rerun it.
- For markdown/reST-only changes you MAY skip `make test` unless the user explicitly requires it.
- You MUST NOT commit without explicit user confirmation. You MUST always ask.
- If validation warns about a staged file or component, you MUST ask the user whether to fix the warning first. You MUST keep the follow-up scoped to the staged files.
