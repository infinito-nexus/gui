# Milestones

Status legend: ✅ complete · 🟡 partially done · ⬜ not started

---

## Milestone 1 – Read-only Dashboard ✅

First usable UI: roles are visible, filterable, and renderable.

**Acceptance Criteria**

- [x] Roles are visible as tiles
- [x] Filtering works (status, deploy target, search)
- [x] Logos render correctly (SimpleIcons → Font Awesome → placeholder)
- [x] Role catalog is indexed from `roles/list.json`
- [x] `make setup` works on a clean checkout
- [x] Stack starts successfully via Docker Compose

---

## Milestone 2 – Workspace Inventory & Credential Management ✅

Users can configure a full inventory including credentials before deployment.

**Requirements**

- [001-credential-generation.md](001-credential-generation.md) – Inventory workspace, file browser, editor, vault & credential generation
- [013-git.md](013-git.md) – Git-backed workspace history, autosave, unsaved-changes guard

**Acceptance Criteria**

- [x] User can configure target + inventory files in Workspace & Files
- [x] Deployment uses the workspace inventory state
- [x] Credentials are generated via `infinito create credentials`
- [x] Vault passwords are never logged or stored permanently
- [x] Workspace has a full Git history with deterministic commit messages
- [x] Unsaved-changes guard prevents accidental data loss

---

## Milestone 3 – Live Deployment ✅

Deployment runs from the UI with live log streaming and cancellation.

**Requirements**

- [006-deploy-server-selection-and-layout.md](006-deploy-server-selection-and-layout.md) – Server selection table, `--limit` behaviour, terminal layout

**Acceptance Criteria**

- [x] Deployment runs from UI
- [x] Logs stream live via SSE
- [x] Cancel works and reliably stops the deployment
- [x] Server selection is tabular; deployed servers are marked and non-selectable
- [x] `--limit` is omitted when all selectable servers are selected
- [x] Terminal uses all remaining space; no rounded corners

---

## Milestone 4 – Harden & Polish 🟡

UI refinements, view modes, server switcher, performance, and security hardening.

**Requirements**

- [002-server-switcher-and-list-layout.md](002-server-switcher-and-list-layout.md) – Top-nav server switcher, server list layout
- [004-role-tile-quick-links.md](004-role-tile-quick-links.md) – Meta-driven icon row per role tile
- [005-store-layout-filters-view.md](005-store-layout-filters-view.md) – Fixed pagination, sticky controls, Mini/List/Detail view modes

**Acceptance Criteria**

- [x] Top-nav server switcher with dropdown and "New" entry
- [x] Server list has Selection/Detail/List view modes and fixed pagination
- [x] Role tiles show quick-link icon row (docs, video, forum, homepage, issues, license)
- [x] Store has compact sticky control row, Mini/List/Detail view modes, fixed pagination
- [x] Role index is cached; logo resolution is cached
- [x] Secrets never appear in logs or browser devtools
- [x] CORS restricted to UI origin; input validation everywhere
- [~] Dashboard loads < 1 s on warm cache (in-memory cache implemented; not strictly measured)
- [~] Multiple concurrent SSE viewers do not crash the API

---

## Milestone 5 – Multi-Tenant Workspaces & Optional Auth ✅

Multiple isolated workspaces per user; optional login via OAuth2 Proxy with persistent workspaces.

**Requirements**

- [003-workspace-selection-and-multi-tenant.md](003-workspace-selection-and-multi-tenant.md) – URL-based workspace selection, workspace overview for logged-in users
- [007-optional-auth-persistent-workspaces.md](007-optional-auth-persistent-workspaces.md) – OAuth2 Proxy integration, user-bound persistent workspaces

**Acceptance Criteria**

- [x] Users can have multiple isolated workspaces
- [x] Workspace is selectable via URL; invalid IDs are handled gracefully
- [x] Workspace overview and header dropdown for authenticated users
- [x] Anonymous usage is fully functional when OAuth2 Proxy is disabled
- [x] Authenticated users' workspaces persist across sessions
- [x] Cross-user workspace access is impossible
- [x] Workspace listing, loading, and deletion work via API

---

## Milestone 6 – Provider Pricing ✅

Declarative, backend-calculated pricing for role variants; inventory-persisted plan selection.

**Requirements**

- [008-role-pricing-variants.md](008-role-pricing-variants.md) – Pricing schema v1, PricingEngine, variant selector UI
- [011-software-tab-bundles-and-apps.md](011-software-tab-bundles-and-apps.md) – Schema v2: offerings, plans, multi-currency, regional pricing, volume bands, setup fees, minimum commits, inventory persistence

**Acceptance Criteria**

- [x] Roles declare pricing metadata in `meta/pricing.yml` (optional, non-breaking)
- [x] PricingEngine is deterministic and backend-only (no frontend calculation)
- [x] Supported primitives: fixed, per_unit, tiered_per_unit, volume_per_unit, bundle, addon, factor, custom
- [x] Multi-currency (ISO 4217) and regional pricing (`eu`, `us`, `uk`, `apac`, `latam`, `global`) supported
- [x] Setup fee and minimum commit enforced in quote output
- [x] `POST /api/pricing/quote` implemented
- [x] Selected `plan_id` is stored per role in `host_vars/<host>.yml`
- [x] Plan selection survives ZIP export/import
- [x] Community default applies automatically when no pricing metadata is defined
- [x] Pricing UI is informative only; no purchase flow blocks deployment

---

## Milestone 7 – Devices & Provider Integration ✅

Server ordering via IONOS, Hetzner, OVHcloud with Customer/Expert/Developer mode.

**Requirements**

- [010-devices-provider-mode-and-order-flow.md](010-devices-provider-mode-and-order-flow.md) – Mode switch, guided ordering, comparison portal, catalog sync, inventory write

**Acceptance Criteria**

- [x] Mode selector (Customer / Expert / Developer) available in Devices section
- [x] Customer mode requires ≤ 3 inputs; shows 3–5 best-match results from cached catalog
- [x] Expert mode supports full filter/sort comparison on cached data
- [x] Developer mode preserves current manual entry behaviour unchanged
- [x] Catalog syncs every 12–24 h; stale banner shown when outdated
- [x] Provisioning triggers only on explicit user confirmation
- [x] Ordered server appears automatically as a device entry
- [x] `DOMAIN_PRIMARY` stored per device in `host_vars/<host>.yml`; no provider secrets in inventory

---

## Milestone 8 – User Management ✅

LDAP-based user management available after a successful deployment with Keycloak.

**Requirements**

- [009-users-ldap-management-after-setup.md](009-users-ldap-management-after-setup.md) – Users section, LDAP create/modify/delete via SSH

**Acceptance Criteria**

- [x] Users section appears only when web-app-keycloak is deployed and LDAP is reachable
- [x] Section is disabled (with tooltip) before setup; enables automatically after deployment
- [x] Create, change password, assign roles, delete user via SSH + LDAP commands
- [x] Passwords are never logged, streamed, or returned to the UI
- [x] All write operations are CSRF-protected and workspace-scoped
- [x] ZIP export/import excludes user credentials

---

## Milestone 9 – Observability & Audit Logging ⬜

All API actions are written to a database with retention, export, and configurable filtering.

**Requirements**

- [012-log.md](012-log.md) – DB-backed audit events, retention, export, RBAC, UI

**Acceptance Criteria**

- [ ] Every backend API request creates exactly one structured audit event in the database
- [ ] Audit records include: timestamp, workspace_id, user, method, path, status, duration_ms, optional request_id and user-agent
- [ ] Plaintext secrets and vault passwords are never written to audit records
- [ ] Audit records are workspace-scoped; no cross-workspace visibility
- [ ] Configurable retention (default 6 months); expired records deleted automatically
- [ ] Per-workspace logging policy (all / writes-only / auth-only / errors-only; health endpoints excludable)
- [ ] `GET /api/workspaces/{id}/logs/entries` with pagination and filters (from, to, user, ip, q, status, method)
- [ ] `GET /api/workspaces/{id}/logs/entries/export` supporting JSONL, CSV, and ZIP for large sets
- [ ] Audit Logs UI view with filter, pagination, and export
- [ ] Access to audit endpoints is RBAC-protected
- [ ] Audit writing is non-blocking; cleanup/export runs in background jobs
- [ ] All backend and Playwright tests pass headless in CI
