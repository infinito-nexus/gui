# Committing

- You MUST run `make test` as the standard combined validation from [Testing and Validation](../../contributing/flow/testing.md) before every commit whenever the staged change includes at least one file that is not `.md` or `.rst`, unless you are explicitly instructed not to.
- If that validation fails, you MUST run `make clean` and rerun it.
- You MUST skip the standard validation only for markdown/reStructuredText-only changes unless you are explicitly instructed to run it.
- You MUST commit only after all required checks pass.
- You MUST NOT commit automatically without explicit confirmation from the user. ALWAYS ask before committing.

## Warnings

- If the standard validation warns about a staged file or component, you MUST ask whether to fix that warning before you continue.
- Keep the follow-up limited to the components touched by staged files so the change stays focused.
