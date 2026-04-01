# Inventory Workspace & Credential Generation – TODO Checklist

## Goal
Interactive creation, editing, and export of a complete inventory including credentials **before** deployment.

---

## 1. Inventory Initialization (UI / Flow)

- [x] Detect when **no inventory exists** (session / workspace / job)
- [x] After app/role selection, **show a “Generate Inventory” button**
- [x] Allow inventory generation **only if inventory.yml does not exist**
- [x] Disable deployment until an inventory exists
- [x] Display a clear UI hint that an inventory must be generated first

**Acceptance Criteria**
- [x] Without an existing inventory, “Generate Inventory” is visible
- [x] Clicking it creates a valid initial inventory structure
- [x] If inventory.yml exists, generation is disabled and API rejects regeneration
- [x] Deployment is blocked until an inventory exists

---

## 2. Workspace & File Structure

- [x] Introduce a **workspace concept** (per project or job)
- [x] Workspace directory is created server-side
- [x] The following files are initially generated:
  - [x] `inventory.yml` (or defined main inventory file)
  - [x] Host file (e.g. `host_vars/<host>.yml`)
  - [x] Optional `group_vars/`
- [x] Temporary vault password file is prepared (initially empty)

**Acceptance Criteria**
- [x] File structure is consistent and reproducible
- [x] Workspaces are fully isolated from each other

---

## 3. Web File Browser (JS)

- [x] Implement a **file browser (tree view)**
- [x] Display all workspace files
- [x] Selecting a file loads its contents into an editor

**Acceptance Criteria**
- [x] All generated files are visible
- [x] Tree navigation is stable and performant

---

## 4. Editor Functionality (WYSIWYG / Code)

- [x] Integrate a **code editor** (e.g. Monaco / CodeMirror)
- [x] Editor modes:
  - [x] YAML (syntax highlighting + validation)
  - [x] JSON (validation)
  - [x] Code/Text (Shell, Python, INI, etc.)
  - [x] Optional: WYSIWYG for Markdown / notes
- [x] Saving writes changes directly to the workspace

**Acceptance Criteria**
- [x] Changes persist reliably
- [x] YAML/JSON errors are detected before follow-up actions

---

## 4.1 Vault & Key UX (Context Actions)

- [x] Context menu on `secrets/credentials.kdbx` allows changing master password
- [x] Context menu on private key file allows changing key passphrase
- [x] Hover on vault-encrypted values enables right-click show plaintext (explicit action)
- [x] Hover on vault-encrypted values enables right-click change value (re-encrypt)
- [x] Any password change requires double entry
- [x] Vault encrypt/decrypt uses the vault password from `secrets/credentials.kdbx`

**Acceptance Criteria**
- [x] Master password is required on each vault access (read/write)
- [x] Plaintext is only shown after explicit action
- [x] No plaintext or passwords appear in logs or SSE streams

---

## 4.2 Credentials Dialog & Server Selection

- [x] One credentials box per server (all servers visible)
- [x] Active server marked via radio button
- [x] Each server has its own **Credentials** button and box
- [x] Only one credentials dialog/box can be open at a time
- [x] Credentials dialog opens via a **Credentials** button
- [x] Dialog appears as a JS popup/modal
- [x] Dialog contains all key and password configuration options
- [x] Each server row has a **Test connection** button to verify credentials
- [x] Test flow: probe ping first, then SSH login; show results separately

**Acceptance Criteria**
- [x] Active server selection is unambiguous and persists
- [x] Test connection uses the selected server’s credentials
- [x] Ping and SSH results are shown independently (e.g. ping OK / SSH failed)
- [x] No credentials are logged or streamed over SSE during testing

---

## 5. Credential Generation via `infinito create credentials`

- [x] UI explicitly asks for a **vault password**
- [x] Password is **never logged** and **never stored permanently**
- [x] Password is written to a **temporary vault password file**
- [x] For each relevant file, run `infinito create credentials` with:
  - [x] `--role-path`
  - [x] `--inventory-file`
  - [x] `--vault-password-file`
  - [x] Optional `--set`
  - [x] Optional `--allow-empty-plain`
- [x] Allow generating credentials **for all roles or a single role**
- [x] Resulting changes are immediately visible in the file browser

**Acceptance Criteria**
- [x] Comments and formatting are preserved
- [x] No secrets appear in logs, SSE streams, or API responses
- [x] Vault password exists only temporarily in the workspace

---

## 6. ZIP Export / Import

- [x] Provide a “Download ZIP” button in the UI
- [x] Provide an “Upload ZIP” button to load a workspace configuration
- [x] ZIP contains **all workspace files** (default)
- [x] ZIP is generated server-side

**Acceptance Criteria**
- [x] ZIP exactly matches the visible workspace state (including `secrets/`)
- [x] Uploading a ZIP updates the workspace contents safely

---

## 7. Backend / API

- [x] `POST /api/workspaces`
- [x] `POST /api/workspaces/{id}/generate-inventory`
- [x] `GET /api/workspaces/{id}/files`
- [x] `GET /api/workspaces/{id}/files/{path}`
- [x] `PUT /api/workspaces/{id}/files/{path}`
- [x] `POST /api/workspaces/{id}/credentials`
- [x] `GET /api/workspaces/{id}/download.zip`
- [x] `POST /api/workspaces/{id}/upload.zip`
- [x] Masking & input validation enabled everywhere

**Acceptance Criteria**
- [x] UI can operate fully via the API
- [x] Workspace access is strictly isolated

---

## 8. UX & Integration Flow

- [x] Clear step-by-step flow:
  1. Select apps
  2. Generate inventory
  3. Edit files
  4. Generate credentials
  5. Export ZIP **or** deploy
- [x] Dedicated “Files” / “Workspace” tab or section
- [x] Manual vs. automatic inventory mode (auto-sync roles + auto-credentials)

**Acceptance Criteria**
- [x] Users always understand the current step and state
- [x] No implicit or “magic” steps without explicit user action

---

## Status
- 🟩 Done  
