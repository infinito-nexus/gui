# Infinito Deployer – Master TODO List (with Acceptance Criteria)

## 0. Project Foundation

### 0.1 Repository & Bootstrap

* [x] Repository initialized (`infinito-deployer`)
* [x] Monorepo structure created
  * [x] `apps/web` (Next.js)
  * [x] `apps/api` (FastAPI)
  * [x] `state/` (jobs, logs, sqlite)
* [x] `.gitignore` includes `state/`, `.env`
* [x] `docker-compose.yml` is fully env-driven
* [x] `env.example` exists and is complete
* [x] `Makefile` includes `setup` and `up`

**A/C**
* [x] `make setup` works on a clean checkout
* [x] No secrets or state files are committed
* [x] Stack starts successfully via Docker Compose

---

## 1. Role Catalog & Metadata Indexing

### 1.1 Canonical Role Source

* [x] Load role list from canonical source:

  * [x] `roles/list.json` (primary)
  * [x] `roles/categories.yml` (optional)
* [x] Validate uniqueness of role IDs
* [x] Ignore disabled/hidden roles if marked

**A/C**

* [x] API can return a complete list of deployable roles
* [x] No role duplication
* [x] Missing or malformed entries are skipped with warnings (not fatal)

---

### 1.2 Role Metadata Extraction

For each role:

* [x] Parse `meta/main.yml`

  * [x] `galaxy_tags`
  * [x] `dependencies`
  * [x] `logo` / `icon` (if present)
  * [x] **status** (`pre-alpha`, `alpha`, `beta`, `stable`, `deprecated`)
* [x] Derive **deployment targets**
  k

  * [x] `universal`
  * [x] `server`
  * [x] `workstation`
* [x] Extract description

  * [x] From `meta/main.yml` or README fallbac

**A/C**

* [x] Every role has:

  * [x] ID
  * [x] Display name
  * [x] Status
  * [x] At least one deploy target
* [x] Roles without optional metadata still render correctly

---

### 1.3 Role Logo Resolution

* [x] **Primary:** use logo/icon defined in `meta/main.yml`
  → `md.logo.css_class` wird bevorzugt genutzt (`source="meta"`)

* [x] **Fallback:** resolve icon via **simpleicons**

  * [x] Normalize role ID → entity name
    → `_normalize_role_to_candidates()` mit Prefix-Stripping & Heuristiken
  * [x] Apply manual overrides for known mismatches
    → `self._overrides` Mapping vorhanden

* [x] **Final fallback:** generic placeholder icon
  → Inline SVG als `data:image/svg+xml` (niemals broken)

---

### Acceptance Criteria

* [x] **Every role tile has a visible icon**
  → `meta` → `simpleicons` → `placeholder` (garantiert)

* [x] **No broken image URLs**
  → Simpleicons URLs werden vor Nutzung validiert, sonst Placeholder

* [x] **simpleicons lookup is cached**
  → Persistenter Cache unter `${STATE_DIR}/cache/simpleicons.json`
  → inkl. **negative caching** (404 wird gemerkt)

---

## 2. Backend API (FastAPI)

### 2.1 Roles API

* [x] `GET /api/roles`

  * [x] Filters:

    * [x] **status**
      → CSV query parameter, validated against allowed lifecycle values
    * [x] **deploy_target**
      → CSV query parameter, validated against allowed deployment targets
    * [x] **category**
      → CSV query parameter, matched against `roles/categories.yml` (optional source)
    * [x] **tags**
      → CSV query parameter, matched against `galaxy_tags`
    * [x] **text search**
      → Implemented as `q`, case-insensitive substring search over
      `id`, `display_name`, and `description`

* [x] `GET /api/roles/{role_id}`
  → Returns full role metadata or `404` if the role does not exist

---

### Acceptance Criteria

* [x] **Filters are combinable**
  → Logical **AND** across filter groups, **OR** within each filter (CSV semantics)

* [~] **API response time < 200ms for cached index**
  → In-memory cache with TTL and mtime-based invalidation is implemented
  → Response time is expected to be <200ms on a warm cache
  → Not strictly guaranteed without runtime measurement or prewarming

* [x] **Invalid filters return empty results, not errors**
  → Invalid `status` or `deploy_target` values return `[]`
  → Non-matching `category`, `tags`, or `q` return `[]`
  → No 4xx/5xx errors for invalid filter values

---

### 2.2 Inventory & Configuration API

* [x] Define `DeploymentRequest` schema:

  * [x] deploy_target
  * [x] host (localhost / IP / domain)
  * [x] ssh user
  * [x] authentication:

    * [x] password OR
    * [x] key
  * [x] selected_roles[]
  * [x] workspace_id (inventory source)

* [x] `POST /api/inventories/preview`

  * [x] Generate inventory YAML
  * [x] Validate required fields
  * [x] Return warnings (missing vars, unsafe defaults)

**A/C**

* [x] Preview matches the inventory used during deployment
* [x] No secrets are logged or returned unmasked
* [x] Invalid input returns clear validation errors

---

### 2.3 Deployment Jobs API

* [x] `POST /api/deployments`

  * [x] Create job ID
  * [x] Create job workspace
  * [x] Persist job metadata
  * [x] Start runner subprocess
* [x] `GET /api/deployments/{job_id}`
* [x] `POST /api/deployments/{job_id}/cancel`

**A/C**

* [x] Each deployment has a unique, traceable job ID
* [x] Job state transitions are consistent
* [x] Cancel reliably stops the deployment

---

### 2.4 Live Logs (SSE)

* [x] `GET /api/deployments/{job_id}/logs`
* [x] Stream events:

  * `log`
  * `status`
  * `done`
* [x] Mask secrets before streaming

**A/C**

* [x] Logs appear in the UI within < 1 second
* [x] ANSI output is readable
* [x] Secrets are never visible

---

## 3. Deployment Runner

### 3.1 Job Workspace

For each job:

* [x] Create directory: `state/jobs/{job_id}/`
* [x] Store:

  * inventory.yml
  * vars.json / vars.yml
  * ssh key (if provided, chmod 600)
  * job.log (append-only)

**A/C**

* [x] Jobs are isolated from each other
* [x] Restarting the API does not corrupt jobs

---

### 3.2 CLI / Ansible Integration

* [x] Introduce wrapper script: `run.sh`
* [x] Wrapper:

  * echoes executed commands (docker-like)
  * calls existing CLI / ansible-playbook
* [x] Capture stdout + stderr line-by-line

**A/C**

* [x] Output matches CLI behavior when run manually
* [x] Exit codes propagate correctly
* [x] Wrapper can be reused outside the web UI

---

### 3.3 Security & Masking

* [x] Regex-based masking:

  * `*_PASSWORD`
  * `*_SECRET`
  * tokens
* [x] Masking applies to:

  * logs
  * SSE stream
  * persisted files

**A/C**

* [x] No secret value is ever retrievable after submission
* [x] Masking does not break readability

---

## 4. Web UI (Next.js)

### 4.1 Dashboard – App Tiles

* [x] Grid layout (tiles)
* [x] Each tile shows:

  * logo
  * app name
  * status badge
  * deploy targets
* [x] Filters:

  * status (multi-select)
  * deploy target
  * search

**A/C**

* [x] UI remains responsive with 100+ roles
* [x] Filtering is client-side fast
* [x] Selection state is preserved during filtering

---

### 4.2 Deployment Target & Credentials

* [x] Form fields:

  * deploy target
  * host
  * user
  * auth method selector
* [x] Key textarea (never echoed back)
* [x] Password field

**A/C**

* [x] Form prevents invalid combinations
* [x] Secrets are cleared on page reload
* [x] UI explains where credentials are used

---

### 4.2.1 SSH Key Generation

* [x] Generate SSH keypair via backend (triggered from UI)
  * [x] Generate key via explicit user action (button)
  * [x] Algorithm is selectable; default is best-practice (`ed25519`)
  * [x] Optional passphrase; generated server-side
  * [x] Generated private key is inserted into the Key field
  * [x] Generated public key is displayed in a read-only field
  * [x] Public key can be copied to clipboard
  * [x] Regeneration requires confirmation
  * [x] Both keys are stored in the workspace (e.g. `ssh_key`, `ssh_key.pub`)

**A/C**

* [x] Public key is valid for `authorized_keys` (e.g. `ssh-ed25519 ...`)
* [x] Private key and optional passphrase never appear in logs or SSE streams
* [x] Key material is persisted only in workspace files and returned to the UI only on explicit user action

---

### 4.2.2 KeePassXC Credentials Vault (Workspace)

* [x] Store all generated passwords **only** in `secrets/credentials.kdbx`
  * [x] **No** `secrets/passwords/` directory exists
  * [x] Entries include: server password, vault password, SSH key passphrase (if set)
  * [x] File is created server-side inside the workspace
  * [x] Whenever reading/writing the KDBX, prompt for master password
  * [x] If KDBX does not exist, create it and require master password twice
  * [x] Master password is never stored or logged
  * [x] UI uses a smooth JS modal/popup for password entry
  * [x] User can download the KDBX file explicitly
  * [x] ZIP export includes `secrets/` by default (including the KDBX)

**A/C**

* [x] Only KDBX contains passwords (no plaintext password files)
* [x] Master password is required on each access (read/write)
* [x] KDBX creation requires matching double-entry
* [x] No KDBX contents or master password appear in logs or SSE streams
* [x] ZIP export contains all workspace files by default (including `secrets/`)

---

### 4.2.3 Vault & Key UX (Context Actions)

* [x] Context menu on `secrets/credentials.kdbx` allows **change master password**
* [x] Context menu on private key file allows **change key passphrase**
* [x] Hover on vault-encrypted values enables **right-click → show plaintext** (explicit action)
* [x] Hover on vault-encrypted values enables **right-click → change value** (re-encrypt)
* [x] Any password change requires **double entry**
* [x] Vault encrypt/decrypt uses the **vault password from `secrets/credentials.kdbx`**

**A/C**

* [x] Master password change updates the KDBX and reuses new password immediately
* [x] Key passphrase change rewrites the private key and preserves public key
* [x] Vault decrypt/show only works after explicit action and does not auto-reveal
* [x] Plaintext is never logged or streamed over SSE

---

### 4.2.4 Credentials Dialog & Server Selection

* [x] One “credentials box” per server (all servers visible)
* [x] Active server is marked via radio button
* [x] Each server has its own **Credentials** button and box
* [x] Only one credentials dialog/box can be open at a time
* [x] Credentials dialog opens via a **Credentials** button
* [x] Dialog appears as a JS popup/modal
* [x] Dialog contains all key and password configuration options
* [x] Each server row has a **Test connection** button to verify credentials
* [x] Test flow: probe ping first, then SSH login; show results separately

**A/C**

* [x] Active server selection is unambiguous and persists
* [x] Test connection uses the selected server’s credentials
* [x] Ping and SSH results are shown independently (e.g. ping OK / SSH failed)
* [x] No credentials are logged or streamed over SSE during testing

### 4.3 Workspace Inventory (SPOT)

* [x] Inventory is edited in Workspace & Files (inventory.yml, host_vars, group_vars)
* [x] Deployment uses the workspace inventory directly

**A/C**

* [x] Workspace inventory is the single source of truth
* [x] Deployment matches the workspace inventory state

---

### 4.4 Live Deployment View

* [x] xterm.js embedded terminal
* [x] SSE client implementation
* [x] Status indicator + cancel button

**A/C**

* [x] Terminal output feels “docker-like”
* [x] User can follow deployment in real time
* [x] Final status is clearly visible

---

## 5. Non-Functional Requirements

### 5.1 Performance

* [x] Role index cached
* [x] Logo resolution cached
* [x] SSE scalable to multiple viewers

**A/C**

* [~] Dashboard loads < 1s on warm cache
* [~] Multiple concurrent viewers do not crash API

---

### 5.2 Security

* [x] No secrets stored long-term
* [x] CORS restricted to UI origin
* [x] Input validation everywhere

**A/C**

* [~] Secrets never appear in logs or browser devtools
* [x] API rejects malformed or malicious input
