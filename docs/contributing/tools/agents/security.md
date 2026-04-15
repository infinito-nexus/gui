## Agent Security Model

This document explains the permission entries in [.claude/settings.json](../../../../.claude/settings.json) and their security impact. The file configures what Claude Code may run without an interactive prompt, what requires confirmation, and what is forbidden outright.

Patterns use shell-style wildcards: `*` matches any substring. Matching is against the literal command string, not against a parsed AST — compound commands (`&&`, `|`, redirects) may match partially or not at all.

### Legend

- **Low** — read-only, side-effect free, or strictly scoped to local repo state.
- **Medium** — modifies local filesystem, starts long-lived processes, or reaches the network on allow-listed targets.
- **High** — can overwrite shared state, exfiltrate data, or affect other processes/containers.
- **Critical** — destructive or privilege-escalating; gated via `deny` or `ask`.

### `permissions.allow`

| Pattern | Purpose | Security Impact |
|---|---|---|
| `Read` | Read any file (subject to `sandbox.denyRead`) | Low — secret dirs (`~/.ssh`, `~/.gnupg`, `~/.kube`, `~/.aws`, `~/.config/gcloud`) are denied separately. Anything else on disk is readable. |
| `Edit` | Modify existing files | Medium — scoped to `sandbox.filesystem.allowWrite` (`.`, `/tmp`). |
| `Write` | Create/overwrite files | Medium — same sandbox scope as `Edit`. |
| `Bash(git status*)` / `git log*` / `git diff*` / `git branch*` / `git fetch*` | Repo inspection | Low — read-only on local repo; `fetch` reaches configured remotes. |
| `Bash(git add*)` / `git checkout*` / `git stash*` | Staging and working-tree manipulation | Medium — can lose uncommitted local changes via `checkout`/`stash`. |
| `Bash(git -C:*)` | Git against another working tree | Medium — scope depends on target path. |
| `Bash(make*)` | All Make targets | Medium — arbitrary shell via Makefile; trust surface = the Makefile itself. |
| `Bash(act*)` | Run GitHub Actions locally | Medium — spawns Docker containers with workflow code. |
| `Bash(python*)` / `python3*` | Arbitrary Python execution | High — full language runtime; any local file is reachable unless blocked by sandbox. |
| `Bash(pip show*)` / `pip list*` | Inspect installed packages | Low. |
| `Bash(pip install*)` | Install Python packages | High — fetches arbitrary code from PyPI and executes setup hooks. |
| `Bash(pytest*)` | Run Python tests | Medium — executes test code. |
| `Bash(node*)` / `npm*` / `npx*` | Node.js runtime + package manager | High — `npm`/`npx` fetch and execute arbitrary npm registry code (lifecycle scripts). |
| `Bash(docker run*)` | Start new containers | High — containers can mount host paths and share networks unless flags restrict them. |
| `Bash(docker pull*)` / `docker build*` / `docker images*` / `docker info*` / `docker ps*` / `docker inspect*` / `docker logs*` | Image and container inspection | Low–Medium — `pull`/`build` fetch/produce images; rest is read-only. |
| `Bash(docker create*)` / `docker export*` | Container creation and filesystem export | Medium — creates state without running it. |
| `Bash(docker rm*)` / `docker rmi*` | Remove containers/images | Medium — destructive on Docker state only. |
| `Bash(docker restart*)` | Restart existing containers | Medium — brief downtime; no new state. |
| `Bash(docker compose*)` | Full Compose orchestration | High — can start, stop, rebuild, and wipe any service defined in `docker-compose.yml`. |
| `Bash(docker exec*)` | Run commands inside containers | High — effectively shell access inside services. |
| `Bash(sleep*)` | Delay | Low. |
| `Bash(grep*)` / `find*` / `ls*` / `cat*` / `head*` / `tail*` / `wc*` / `sort*` / `jq*` | Read-only inspection utilities | Low — subject to `sandbox.denyRead`. |
| `Bash(sed -n *.log)` | Print ranges from log files | Low — constrained to non-edit mode (`-n`) and `.log` suffix. |
| `Bash(tar*)` | Archive create/extract | Medium — can write anywhere inside `allowWrite`. |
| `Bash(mkdir*)` / `cp*` / `mv*` / `rmdir*` | Filesystem manipulation | Medium — sandbox `allowWrite` applies. |
| `Bash(tee /tmp/*.log)` | Write logs to `/tmp` | Low — scoped to `/tmp/*.log`. |
| `Bash(chmod +x *.sh)` | Make shell scripts executable | Medium — permission-only, but enables later execution. |
| `Bash(netstat*)` | Network/socket inspection | Low — read-only. |
| `Bash(fuser*)` | Port/file user lookup; can kill with `-k` | Medium — `-k` terminates processes. |
| `Bash(pkill*)` | Kill processes by name pattern | High — can kill any non-root user process; wide-ranging wildcards are easy to mistype. |
| `WebSearch` | Web search via Claude tooling | Low–Medium — content is fetched for context. |
| `WebFetch(domain:*)` | Fetch allow-listed domains only | Low — scoped per domain; see list in settings. |

### `permissions.deny`

| Pattern | Reason |
|---|---|
| `Bash(git push --force*)` | Overwrites remote history; unrecoverable without reflog access on the remote. |
| `Bash(git reset --hard*)` | Destroys uncommitted work silently. |
| `Bash(rm -rf*)` | Irreversible recursive delete; common footgun. |
| `Bash(sudo*)` | Prevents privilege escalation to root. |

### `permissions.ask`

Commands that require explicit user confirmation at call time:

| Pattern | Reason |
|---|---|
| `Bash(git commit*)` | Creates durable repo state; message and staged scope warrant review. |
| `Bash(git push*)` | Publishes state to a remote; visible to others. |
| `Bash(curl*)` | Arbitrary HTTP; can exfiltrate data or fetch untrusted payloads. |

### `sandbox`

| Field | Value | Effect |
|---|---|---|
| `filesystem.allowWrite` | `.`, `/tmp` | Writes outside these paths fail regardless of `allow`. |
| `filesystem.denyRead` | `~/.ssh`, `~/.gnupg`, `~/.kube`, `~/.aws`, `~/.config/gcloud` | Secret/credential directories are unreadable even via `Read` or `cat*`. |
| `permissions.additionalDirectories` | `/tmp` | Extends tool scope beyond the project root. |

### Notes for Reviewers

- Permission patterns match command strings prefix-style with `*` wildcards. They do **not** parse shell syntax — env-var prefixes (`FOO=bar make ...`) do not match `Bash(make*)`. See [AGENTS.md](../../../../AGENTS.md) for the trailing-variable rule.
- `deny` takes precedence over `allow`, but compound commands (e.g. `make foo && rm -rf /tmp/x`) may bypass `deny` matching in edge cases. Keep destructive flags out of allow-list patterns where possible.
- Broad wildcards (`Bash(pkill*)`, `Bash(python*)`, `Bash(npm*)`) are accepted trade-offs for developer velocity. Tighten them if this repo is used by less-trusted agents.
