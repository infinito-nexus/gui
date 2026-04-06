# Pull Request

## Branch Naming

Branch names MUST follow the naming conventions defined in [branch.md](branch.md). The branch prefix MUST match the type of change.

## Templates

You MUST pick the template that matches your change.

| Change type | Template |
|---|---|
| New feature or enhancement | [feature.md](../../../.github/PULL_REQUEST_TEMPLATE/feature.md) |
| Bug fix | [fix.md](../../../.github/PULL_REQUEST_TEMPLATE/fix.md) |
| Documentation-only changes | [documentation.md](../../../.github/PULL_REQUEST_TEMPLATE/documentation.md) |
| Agent instruction changes (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/agents/*`) | [agents.md](../../../.github/PULL_REQUEST_TEMPLATE/agents.md) |

## Validation Scope

[Testing and Validation](testing.md) is the SPOT for local validation requirements. This page defines Pull Request templates and CI scope.

## Forking Flow

Before marking a PR as **ready for review**, the required local validation from [Testing and Validation](testing.md) and the required CI in your fork MUST be green.

| Change type | Required CI |
|---|---|
| Backend Python changes | MUST pass `make test` and ruff lint |
| Frontend changes | MUST pass lint, typecheck, and relevant e2e tests |
| Documentation-only | Lightweight gate — no CI test suite required |
| Agent-only (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/agents/*`) | Lightweight gate — no CI test suite required |

## Drafts

You SHOULD open a Pull Request as a **draft** while your change is still in progress.

- You MUST mark the PR **ready for review** before requesting a review.
- If you continue working on the PR after marking it ready, you MUST convert it back to a **draft** before pushing new commits.

## Checklist

Before you open a Pull Request:

- The required local validation and required CI in your fork MUST be green.
- Your branch MUST be up to date with `main`.
- Your change SHOULD be small and focused.
- Relevant documentation MUST be updated.
- Screenshots, logs, or migration notes SHOULD be attached when they help review the change.
