### Vision Summary — *Infinito Deployer* (WIP)

**Infinito Deployer** is a web-based deployment dashboard that transforms the **Infinito.Nexus role ecosystem** into a **guided, observable, and repeatable deployment experience**.

When a user opens the dashboard, they are immediately presented with a **catalog of deployable applications**, displayed as **clean, visual tiles**. Each tile represents an Ansible role and clearly communicates its **maturity level** (pre-alpha, alpha, beta, stable), **supported deployment targets** (universal, server, workstation), and **identity** via an automatically resolved logo (derived from role metadata or a smart fallback).

From this catalog, users can **filter, search, and select applications** without needing to understand the underlying Ansible structure. Once selected, they configure **where and how** the deployment should run:

* target host (localhost, IP address, or domain),
* user and authentication method (password or SSH key),
* and the workspace inventory files (inventory.yml, host_vars, group_vars).

Before execution, the system **uses the workspace inventory** that is visible and editable in the UI. This makes the process transparent and auditable rather than implicit or opaque.

When deployment starts, the platform executes **the same CLI and Ansible commands** used by experienced operators, but exposes them through a **live, Docker-like web terminal**. Users can observe each step in real time, cancel safely, and trust that secrets are masked and never leaked.

At its core, Infinito Deployer does **not replace** Infinito.Nexus—it **orchestrates it**:

* the CLI remains the single source of truth,
* inventories remain reproducible,
* deployments remain deterministic.

The result is a bridge between **infrastructure-as-code discipline** and **human-friendly operations**:
a single interface where complex, multi-role deployments become **discoverable, explainable, and safely executable**—for experts and non-experts alike.

---

## Local Operation with Docker Compose

### Prerequisites

* Docker Engine
* Docker Compose v2 (`docker compose`)
* A local clone of **Infinito.Nexus** (required for `roles/`)

### One-Time Setup

1. Clone this repository.
2. Check out Infinito.Nexus into `./infinito-nexus`
   (or adjust the path later in `.env`).
3. Start the stack:

```bash
make setup
```

`make setup` performs the following steps:

* creates `.env` from `env.example` (if it does not exist),
* ensures the `./state` directory exists,
* starts `docker compose` (including image builds).

### Important `.env` Variables

* `INFINITO_REPO_HOST_PATH` must point to your local Infinito.Nexus path
* `CORS_ALLOW_ORIGINS` should include the Web UI URL
* `NEXT_PUBLIC_API_BASE_URL` must point to the API endpoint
* `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` configure the PostgreSQL service used for server requirements

### Requirements Database Initialization

Start only PostgreSQL:
```bash
make db-up
```

Wait until PostgreSQL is ready:
```bash
make db-wait
```

Initialize requirements tables (idempotent):
```bash
make requirements-init
```

Open a SQL shell in PostgreSQL:
```bash
make db-psql
```

### Job Runner (Container per Deployment)

Deployments run in a dedicated container per job.

1. Ensure `STATE_HOST_PATH` is an **absolute path** (Docker needs host paths).
2. Keep the Docker socket mount enabled for the API container in `docker-compose.yml`.

Note: the container runner requires Docker socket access in the API container.
For stronger isolation, consider moving the job runner into a separate service
that owns the Docker socket.

Optional (for custom runner images):
* Set `JOB_RUNNER_IMAGE` (defaults to `INFINITO_NEXUS_IMAGE` if unset).
* If your runner image does not include the repo, mount it via `JOB_RUNNER_REPO_HOST_PATH` (absolute path).
* If the API container cannot find `docker`, set `JOB_RUNNER_DOCKER_BIN` (e.g. `docker.io`).

Example:

```
JOB_RUNNER_IMAGE=ghcr.io/kevinveenbirkenbach/infinito-arch
STATE_HOST_PATH=/absolute/path/to/state
```

### Start / Stop / Logs

```bash
make up
```

```bash
make logs
```

Only database logs:
```bash
make db-logs
```

Refresh catalog (invokable apps only) and restart API:
```bash
make refresh-catalog
```

Run an Arch Linux test target (SSH) via compose profile:
```bash
COMPOSE_PROFILES=test make up
```
Use these credentials in the UI:
- Host: `test-arch` (from the API container)
- User: `deploy`
- Auth: password `deploy`

From the host, SSH is available on `localhost:2222` (override with `TEST_ARCH_SSH_PORT`).

Stop stack:

```bash
make down
```

Stop only PostgreSQL:
```bash
make db-stop
```

### URLs After Startup

* Web UI: [http://localhost:3000](http://localhost:3000)
* API Health: [http://localhost:8000/health](http://localhost:8000/health)
