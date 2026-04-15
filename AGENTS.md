# Agent Instructions

## Priority and Scope

- [CONTRIBUTING.md](CONTRIBUTING.md) is the SPOT for general contributor workflow, coding standards, testing, and review. You MUST read it and recursively scan all files it references under `docs/contributing/`.
- This file extends `CONTRIBUTING.md` with agent-specific execution instructions. In case of conflict, the rules in this file take precedence because they are more specific to automated execution.
- You MUST recursively scan all files referenced under `docs/agents/` to collect the full agent-specific execution flow.

## Reloading Instructions

If agent instructions change during a conversation, the agent MAY not pick up the changes automatically. To force a reload, send the following command:

> "Re-read AGENTS.md and apply all updated instructions."

## Make Invocations — Trailing Variables Only

When overriding Make variables, agents MUST append `VAR=value` pairs **after** the target, never as shell env-var prefixes before `make`. This keeps invocations matchable against the `Bash(make*)` permission pattern and avoids interactive prompts.

- ✅ `make e2e-dashboard-local INFINITO_NEXUS_SRC_DIR=... INFINITO_E2E_KEEP_STACK=1`
- ❌ `INFINITO_E2E_KEEP_STACK=1 make e2e-dashboard-local INFINITO_NEXUS_SRC_DIR=...`

Trailing `VAR=value` arguments are Make-native overrides and apply to the make invocation only. Use them for all environment-dependent parameters.

## For Humans

Human contributors working alongside AI agents MUST read [agents.md](docs/contributing/tools/agents.md).
