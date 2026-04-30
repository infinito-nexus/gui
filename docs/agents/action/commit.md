# Committing 💾

- You MUST run `make autoformat` before every commit and stage every file it modified.
- `make lint` and `make test-unit` are enforced automatically by the repo's pre-commit hooks (see [.pre-commit-config.yaml](../../../.pre-commit-config.yaml) and [Testing and Validation](../../contributing/testing/common.md)). Run `make pre-commit-install` once per checkout to enable them. The hooks MUST stay container-free so they can run on any developer shell — `make test-unit` covers Python and Node unit tests; the broader `make test` (with integration) is the responsibility of CI and any manual pre-push verification. Agents MUST NOT bypass these hooks (no `--no-verify`); on hook failure, you MUST fix the underlying cause and create a new commit (see [Iteration-Loop Commit Gate](#iteration-loop-commit-gate-)).
- You MUST NOT commit without explicit user confirmation. You MUST always ask.
- If validation warns about a staged file or component, you MUST ask the user whether to fix the warning first. You MUST keep the follow-up scoped to the staged files.

## Iteration-Loop Commit Gate 🛑

Loop = any of:
- user prompt matches `/iteriere/`, `/iterate/`, `/until (green|all (pass|fixed))/`, `/fix (all|both|the) (failing|remaining) /`
- active session is in `/loop` self-pacing mode
- TodoWrite list has ≥ 2 `pending` or `in_progress` items the agent itself enqueued for the current request

While Loop is active:

- The agent MUST NOT call `git commit` (no `git add` + `git commit`, no `--amend`, no PR-creating commands).
- The agent MUST hold every diff in the working tree (or staged-only is fine, just no commit).
- The agent MUST NOT push, MUST NOT create PRs, MUST NOT tag.

Loop exits (commit gate opens) when ALL are true:

- Every TodoWrite item is `completed`.
- The closing verification is green:
  - default: `make e2e-dashboard-local` (see [iteration.md](iteration.md))
  - or whatever the user pinned for this loop ("until perf is green", "until all 3 CI jobs pass")
- The user has not redirected the loop in the most recent turn.

After exit:

- ONE batched commit covering the whole iteration. Same pre-commit rules as above (autoformat, hook-enforced lint + test-unit, ask).
- Multiple commits MAY be created only if the staged tree splits cleanly along independent concerns AND each split commit is itself green against the closing verification.

Hard overrides (commit gate opens immediately, named scope only):

- User says `commite` / `commit now` / `commit jetzt` / `commite die gestagten dateien` → commit current staging only.
- User explicitly phases the work ("first fix X, commit, then fix Y") → commit at each named phase boundary.
- Destructive cleanup is required to unblock the loop (e.g. branch reset). Surface and ask.

Self-check before any `git commit`:

1. Am I inside a Loop as defined above? If yes and no override fired → STOP, do not commit.
2. Did I just say "passes locally" without running the closing verification on the final state? If yes → STOP, run it first.
3. Is the staged diff strictly smaller than the working tree? If yes and the working-tree-only changes are part of the same loop → STOP, integrate them or unstage the partial commit.

## Local Verification Gate 🔬

Trigger (any one):
- commit message would contain `fix`, `bug`, `regress`, `fail`
- change references a CI run URL or a failing test name
- user prompt matches `/fix|behebe|löse|solve|debug/`

Sequence — MUST run in order; `git commit` blocked until all steps emit a recorded outcome.

1. Run the exact failing scenario locally with the fix applied → MUST observe pass.
   - unit/integration: run the named test (`python -m unittest <module.Class.test>`) — it MUST be green.
   - CI-only failure: simulate CI conditions before running — `mv .env .env.bak`; `export <pinned *_IMAGE vars from workflow>`; `docker rmi <image CI pulls fresh>`; then run the equivalent local target (`make test`, `make api-smoke-deployment-full`, etc.).
   - local run blocked (sandbox netns, ARM-only, missing hardware) → MUST record the exact block in the commit body; MAY skip step 1 for that block only.

2. Run regression scope:
   - Makefile / shared script → `make test`.
   - stack/compose/runner → `make api-smoke-deployment-full` against fresh stack.
   - workflow `.yml` → structural check (`make -np | grep <var>`, `make -n <target>`).

3. Commit body MUST contain a `Verified locally:` block. Format:
   ```
   Verified locally:
     - <fix-applied scenario cmd> → OK
     - <regression cmd> → <count> OK
   ```
   Reader MUST be able to re-run from the commit alone.

Self-check — answer all "yes" or STOP:
- Ran the exact failing scenario with fix applied and observed pass? (or sandbox-block recorded)
- Ran regression scope?
- `Verified locally:` block in commit body re-runnable?

Override: user types `commite` / `commit now` / `commite trotzdem` AFTER this gate fires → commit allowed, body MUST list each skipped step and why.
