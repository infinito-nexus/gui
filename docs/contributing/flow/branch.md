# Branch

## CI Impact

The branch prefix MUST match the type of change. The [PR workflow](pull-request.md) uses it to classify the scope and decide which CI pipeline to run.

| Branch prefix | Scope | Matching files | CI behavior |
|---|---|---|---|
| `agent` | Changes to agent instructions or prompts | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/agents/*` | Lightweight scope — no test suite required. |
| `documentation` | Documentation-only changes | `**/*.md` (outside agent paths) | Lightweight scope — no test suite required. |
| `feature` | New features or enhancements | `*` | Runs the full CI pipeline. |
| `fix` | Bug fixes | `*` | Runs the full CI pipeline. |

## Naming Conventions

The description MUST use `kebab-case` (lowercase words separated by hyphens) and SHOULD be short enough to read at a glance.

The full branch name MUST follow one of the patterns below:

| Case | Pattern | Example |
|---|---|---|
| General feature | `feature/<topic>` | `feature/workspace-import` |
| Fix | `fix/<topic>/<ticket-id>` | `fix/deploy-timeout/gh-42` |
| Documentation | `documentation/<topic>` | `documentation/contributing-setup` |
| Agent | `agent/<topic>` | `agent/improve-commit-instructions` |

`feature`, `documentation`, and `agent` branches MUST NOT reference a ticket ID.
