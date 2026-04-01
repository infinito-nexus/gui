# Optional Login & Persistente Workspaces (OAuth2 Proxy)

## Goal

Allow **optional authentication via OAuth2 Proxy** to enable **persistent, user-bound workspaces**
(workdirs) that can be **saved, listed, and reloaded across sessions**.

The system MUST continue to work **fully anonymous** when authentication is disabled.

---

## 1. Authentication Model (Optional)

* [x] Support **optional login** via OAuth2 Proxy
  * [x] OAuth2 Proxy runs in front of the Web UI / API
  * [x] Authentication is handled **externally** (OIDC, SSO, IdP)
* [x] When disabled:
  * [x] Application works exactly as today (anonymous, session-bound)

**Acceptance Criteria**

* [x] No login is required for basic usage
* [x] Enabling OAuth2 Proxy does not break anonymous mode
* [x] Backend never implements its own auth logic

---

## 2. User Identification (Backend)

* [x] When authenticated, extract user identity from trusted headers:
  * [x] `X-Auth-Request-User` (or equivalent)
  * [x] Optional: `X-Auth-Request-Email`
* [x] User identity is treated as **opaque string**
  * [x] No assumptions about format
  * [x] No authorization logic beyond workspace ownership

**Acceptance Criteria**

* [x] Backend trusts headers only when OAuth2 Proxy is enabled
* [x] Identity is never user-controlled input

---

## 3. Workspace Persistence Model

* [x] Introduce **persistent workspaces** for authenticated users:
  * [x] Workspace is bound to a user ID
  * [x] Workspace survives browser reloads and sessions
* [x] Anonymous users continue to use:
  * [x] Ephemeral / session-bound workspaces

**Acceptance Criteria**

* [x] Authenticated users can return and continue previous work
* [x] Anonymous users do not see or persist old workspaces

---

## 4. Workspace Listing & Reloading (UI)

* [x] When authenticated:
  * [x] Show a **“My Workspaces”** section
  * [x] List existing workspaces:
    * [x] ID / name
    * [x] Last modified timestamp
    * [x] Current state (draft / deployed / finished)
* [x] Allow:
  * [x] Load workspace
  * [x] Delete workspace (with confirmation)

**Acceptance Criteria**

* [x] Loading a workspace restores:
  * [x] Inventory files
  * [x] Vars
  * [x] UI state (selected roles, step)
* [x] Deleting a workspace fully removes server-side data

---

## 5. Workspace Lifecycle Rules

* [x] Workspace states:
  * [x] draft
  * [x] deployed
  * [x] finished
* [x] Deployments reference a workspace but do not own it
* [x] Finished deployments do NOT auto-delete workspaces

**Acceptance Criteria**

* [x] Users can redeploy from the same workspace
* [x] Deploy history is preserved independently

---

## 6. Security & Isolation

* [x] Users can only access **their own workspaces**
* [x] No workspace ID guessing possible
* [x] Workspace paths are never user-controlled

**Acceptance Criteria**

* [x] Cross-user access is impossible
* [x] Authenticated users cannot access anonymous workspaces and vice versa

---

## 7. API Extensions

* [x] `GET /api/workspaces`
  * [x] Returns only workspaces of the authenticated user
* [x] Existing workspace APIs remain unchanged
* [x] When unauthenticated:
  * [x] Workspace listing endpoint returns empty or 401 (configurable)

**Acceptance Criteria**

* [x] UI can fully manage workspaces via API
* [x] No breaking changes for existing flows

---

## 8. UI Tests (Playwright – Required)

* [x] Anonymous mode:
  * [x] No workspace list is shown
  * [x] Workspace is lost on reload
* [x] Authenticated mode:
  * [x] Workspace list is rendered
  * [x] Loading restores files and UI state
  * [x] Deleting removes workspace from list

**Acceptance Criteria**

* [x] Tests cover both anonymous and authenticated flows
* [x] No real OAuth provider is used (headers are mocked)

---

## Status

* 🟩 Done
