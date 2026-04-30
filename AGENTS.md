# Agent Instructions

## Priority and Scope

- [CONTRIBUTING.md](CONTRIBUTING.md) is the SPOT for general contributor workflow, coding standards, testing, and review. You MUST read it and recursively scan all files it references under `docs/contributing/`.
- This file extends `CONTRIBUTING.md` with agent-specific execution instructions. In case of conflict, the rules in this file take precedence because they are more specific to automated execution.
- You MUST recursively scan all files referenced under `docs/agents/` to collect the full agent-specific execution flow.

## Reloading Instructions

If agent instructions change during a conversation, the agent MAY not pick up the changes automatically. To force a reload, send the following command:

> "Re-read AGENTS.md and apply all updated instructions."

## Scope and Cross-Repo Edits

- You MUST confine all file modifications to the current repository (the one containing this `AGENTS.md`).
- Other repositories visible in the environment (e.g. sibling checkouts listed as "Additional working directories") are READ-ONLY for reference and inspection.
- If a task appears to require changes in another repository, you MUST stop and ask the user for explicit confirmation before editing, committing, or pushing there.
- This rule overrides any sandbox `allowWrite` entry that would otherwise permit cross-repo writes.

## Infinito Nexus Core Image — Source of Truth

- The SPOT for the Infinito Nexus core image code is <https://s.infinito.nexus/code>. You MUST consult this URL whenever you need to analyze or reference core image behavior.
- You MUST NOT use any local Infinito Nexus checkout (e.g. sibling `infinito-nexus/` directories) for analysis unless the user explicitly instructs you to.
- Reason: local checkouts may contain in-progress, experimental, or otherwise unfinished code that does not reflect the released core image. Treating them as authoritative can lead to wrong conclusions.

## Make Invocations — Trailing Variables Only

When overriding Make variables, agents MUST append `VAR=value` pairs **after** the target, never as shell env-var prefixes before `make`. This keeps invocations matchable against the `Bash(make*)` permission pattern and avoids interactive prompts.

- ✅ `make e2e-dashboard-local INFINITO_NEXUS_SRC_DIR=... INFINITO_E2E_KEEP_STACK=1`
- ❌ `INFINITO_E2E_KEEP_STACK=1 make e2e-dashboard-local INFINITO_NEXUS_SRC_DIR=...`

Trailing `VAR=value` arguments are Make-native overrides and apply to the make invocation only. Use them for all environment-dependent parameters.

## Refresh Containers After Edits

After every source edit that affects code running inside a container, the agent MUST run the matching refresh target (`make restart`, `make web-sync`, `make refresh-catalog`, …) **before** declaring the edit complete or running any verification against the live stack. Host-side edits are NOT auto-synced into running containers; skipping this step verifies stale code.

The full matrix and rules are in [refresh.md](docs/agents/action/refresh.md).

## Network Failures — Fix Causes, Not Symptoms

- When a failure appears network-related (for example DNS resolution errors, routing problems, TLS handshake timeouts, registry/index access failures, proxy issues, CA trust problems, IPv4/IPv6 reachability problems, or firewall/NAT interference), agents MUST identify the root cause and the affected layer instead of only treating the visible symptom.
- Agents MUST first collect concrete evidence: the exact failing command, the exact error text, whether the failure is DNS, TCP, TLS, HTTP, registry, Git, or container-runtime related, and whether it reproduces from the host, container, or both.
- Before adding any workaround, agents SHOULD reproduce the problem with direct diagnostic commands from the affected layer whenever feasible.
- Agents MUST fix the root cause when it is solvable within this repository or its runtime configuration. Durable fixes such as correcting DNS configuration, routes, proxy settings, CA trust, service endpoints, firewall rules, or container-network wiring are preferred over patching tests or application logic around the failure.
- Agents MUST NOT treat repeated retries, longer timeouts, disabled checks, caches, mirrors, fallback logic, or unrelated workaround code as a sufficient fix unless the root cause has already been identified, documented, and explicitly marked as unresolved external dependency or temporary mitigation.
- If the root cause cannot be fixed autonomously from within this repository, or requires host-level or external infrastructure changes, the agent MUST say explicitly that the issue is external, stop presenting the symptom as solved, and provide concrete diagnostic or remediation commands the user can run. Prefer actionable commands with expected intent, for example: `ip route`, `ip -6 route`, `resolvectl status`, `curl -4 -I https://registry-1.docker.io/v2/`, `curl -6 -I https://registry-1.docker.io/v2/`, `docker pull <image>`, `ss -tpn`, or `journalctl -u docker --since "15 min ago"`.
- Any temporary workaround that remains necessary during investigation MUST be labeled clearly as a workaround, including what it mitigates, why the real root cause is still unresolved, and what the next manual step is if user intervention is required.

## For Humans

Human contributors working alongside AI agents MUST read [common.md](docs/contributing/tools/agents/common.md) and the agent permission model in [security.md](docs/contributing/tools/agents/security.md).
