# 022 - App Detail Tabs (General · Services · Billing) and Per-Service Toggles

## User Story

As a workspace owner choosing which apps to deploy, I want every app's detail dialog to show me — alongside the basic information — which platform-services this app integrates with, and to enable or disable each of those integrations individually before I commit to deploying. The dialog MUST be organised into three tabs (`General`, `Services`, `Billing`) so the existing description / tags / links stay clearly separated from the new service controls and from the pricing/plan controls that already live in the modal.

## Background

Today the role-detail modal at [RoleDetailsModal.tsx](../../apps/web/app/components/role-dashboard/RoleDetailsModal.tsx) renders a single flat layout containing description, targets, categories, tags, links, the plan dropdown, the price, and the Enable/Disable button. There is no grouping and no way to influence which platform-services an app uses.

The role-index loader in the deployer today reads only `meta/main.yml` ([role_metadata_extractor.py:115-116](../../apps/api/roles/role_metadata_extractor.py#L115-L116)). The web-side `Role` type at [types.ts](../../apps/web/app/components/role-dashboard/types.ts) consequently has no field for connected services. The deployer therefore has no per-app data telling it which platform-services an app integrates with — even though that data already lives in the role tree.

The role tree itself is mid-migration:

- **Current layout** — the `ghcr.io/infinito-nexus/core/debian:*` image that the deployer pulls today (see `INFINITO_NEXUS_IMAGE` in [env.example](../../env.example)) ships every web-app role with the older `roles/<role>/config/main.yml` convention, where the application's connected-service flags live in a `features:` (or equivalent) section inside that single per-role config file.
- **New layout** — the upstream `infinito-nexus` repo has split the per-role config across separate meta files, including a dedicated `roles/<role>/meta/services.yml`. Once a future Infinito-Nexus release publishes the new layout, every role will expose its connected services via `meta/services.yml`.

The `services.yml` shape (from the upstream new layout) classifies each top-level entry as either a *toggle* (e.g. `matomo: { enabled: true, shared: true }`) or an *app-config block* (e.g. `akaunting: { image, ports, run_after }`). Only toggle entries describe connected platform-services; app-config blocks describe the app itself and MUST stay internal.

This requirement (a) exposes the toggle entries to the deployer through a layered loader that works against today's `config/main.yml` AND tomorrow's `meta/services.yml`, (b) lets the user override each toggle per workspace, and (c) reorganises the role-detail modal into three tabs so the new control surface has a place to live.

## Scope

- **Reads connected-service entries via a layered loader** with a fixed precedence (defined under "Backend changes — service source layout" below). The loader works today against `roles/<role>/config/main.yml` (the layout shipped in the current image) and continues to work, without code changes, once roles publish `roles/<role>/meta/services.yml` (the upstream new layout).
- **Adds one new field** `services_links: ServiceLink[]` to the role payload returned by the existing role-index endpoint. No new endpoint.
- **Persists per-workspace overrides** in the existing workspace state file. Path: `applications.<role-id>.services.<service-key>.enabled = bool`. Defaults to the role-side default for that service when no override exists. Persists via the workspace's existing PATCH path; no new persistence mechanism.
- **Reshapes** [RoleDetailsModal.tsx](../../apps/web/app/components/role-dashboard/RoleDetailsModal.tsx) into a three-tab view (`General`, `Services`, `Billing`). The existing content is split across General + Billing as defined below.
- **Reuses the existing tab styling** from [DeploymentWorkspace.module.css](../../apps/web/app/components/DeploymentWorkspace.module.css) (`.tabList`, `.tabButton`, `.tabPanel`) so no new tab convention is introduced.
- The Web layer (modal, ServiceLink rendering, toggle behaviour) is identical regardless of which source layout produced the data.

## Backend changes

### Service source layout (precedence)

The loader MUST resolve the connected-service list for a given role by walking the following per-role candidate paths IN ORDER and using the first one that yields at least one toggle entry:

| Order | Path                              | Layout era       |
|-------|-----------------------------------|------------------|
| 1     | `<role>/meta/services.yml`        | new (upstream)   |
| 2     | `<role>/config/main.yml`          | current image    |

A role that provides BOTH MUST have its `meta/services.yml` win — this is the migration cut-over rule. A role that provides NEITHER MUST yield `services_links: []` and MUST NOT fail role-index loading.

The loader MUST emit a single `INFO` log line per role indicating which source was used (`source=meta-services`, `source=config-main`, or `source=none`), so the cut-over is observable in the API logs without having to re-derive it from the role tree.

#### New layout — `meta/services.yml`

Top-level YAML mapping. Each entry is either a *toggle* or an *app-config block*. Only toggles are surfaced.

```yaml
matomo:    { enabled: true,  shared: true }   # toggle
prometheus:{ enabled: true,  shared: true }   # toggle
redis:     { enabled: false }                 # toggle (default-off)
akaunting: { image: …, ports: …, run_after: […] }   # app-config block — IGNORED
```

Classification rule (identical for both layouts where an `enabled` flag is present):

- **Toggle**: value is a mapping AND contains key `enabled` (boolean) AND contains NONE of `image`, `ports`, `run_after`, `version`, `name`.
- **App-config block**: anything else.

#### Current image layout — `config/main.yml`

Top-level YAML mapping with the application's own configuration. The connected-service flags live in a sub-section that, depending on the role's age, is named `features:` OR `services:`. Both names MUST be supported. The loader MUST inspect both keys and merge their toggle entries (with `services:` taking precedence over `features:` for the same key, since `services:` is the more recent of the two old-layout names).

```yaml
features:
  matomo: true
  prometheus: true
  redis: false
services:
  matomo: { enabled: true, shared: true }   # if a role uses this richer form
```

Both shapes — the bare boolean and the mapping with `enabled` — MUST be accepted:

- Bare boolean (`matomo: true`) → `{ key: "matomo", default_enabled: true, shared: false }`.
- Mapping with `enabled` (`matomo: { enabled: true, shared: true }`) → `{ key: "matomo", default_enabled: true, shared: true }`.
- Anything else (string, list, mapping without `enabled`) → skipped with a per-key warning, NOT a fatal error.

### Role-index loader

[apps/api/services/role_index/service.py](../../apps/api/services/role_index/service.py) (or the existing [role_metadata_extractor.py](../../apps/api/roles/role_metadata_extractor.py)) MUST:

1. Resolve `services_links` for each role using the precedence table above.
2. Parse YAML defensively. On parse error of either source file, log a warning and treat that source as empty so the next candidate is tried.
3. Return the resulting list sorted alphabetically by `key` and attach it to the role payload as `services_links`.

The implementation SHOULD isolate source-resolution into a small helper (e.g. `_load_service_links(role_dir) -> list[ServiceLink]`) so the dual-layout code path is testable without the full role-index round-trip and so the old-layout branch can be deleted cleanly once the cut-over is complete.

### API schema

[apps/api/api/schemas/role.py](../../apps/api/api/schemas/role.py) (or wherever the role response model lives) MUST gain:

```python
class ServiceLink(BaseModel):
    key: str
    default_enabled: bool
    shared: bool

class RoleOut(BaseModel):
    ...
    services_links: list[ServiceLink] = []
```

The default `[]` keeps the field backward-compatible for older clients.

### Workspace state schema

The override location in `workspace.json` is:

```json
{
  "applications": {
    "web-app-akaunting": {
      "services": {
        "matomo":     { "enabled": false },
        "prometheus": { "enabled": true }
      },
      ...other-app-fields...
    }
  }
}
```

- Missing `applications.<role-id>.services.<key>` → effective value = `services_links[<key>].default_enabled`.
- The overrides are written via the existing workspace PATCH endpoint. No new endpoint.
- Storing only the explicit overrides (sparse map) keeps `workspace.json` diffs small and survives changes to the role's defaults.

## Frontend changes

### Tab layout in RoleDetailsModal

The modal body MUST present three tabs in this order:

1. **General** — description, deployment targets, categories, tags, links. (Same content as today's flat modal, minus the Plan/Price/Enable block.)
2. **Services** — connected-service list with toggles (defined below). Empty-state when `services_links.length === 0`: a single muted line "This app has no integrated services."
3. **Billing** — Plan dropdown, price line, Enable / Disable button. (Lifts the existing controls from the bottom of the modal into a tab.)

Tab order is fixed; the default active tab on open MUST be `General`. Tab state is local to the modal — it MUST NOT be reflected in the URL or persisted across modal closes.

The Close button MUST remain visible regardless of the active tab and MUST close the modal.

The tab strip MUST follow the existing pattern from [DeploymentWorkspace.module.css](../../apps/web/app/components/DeploymentWorkspace.module.css): each tab is a `<button role="tab">`, the active tab carries `aria-selected="true"`, and the tab panel below carries `role="tabpanel"` with a matching `aria-labelledby`. Keyboard users MUST be able to switch tabs with `ArrowLeft` / `ArrowRight`.

### Services tab — row layout

For each entry in `role.services_links`:

| Element     | Source                                                                  |
|-------------|-------------------------------------------------------------------------|
| Icon        | `simpleicons:<key>` if available, else a Font-Awesome generic gear      |
| Label       | Title-cased `key` (e.g. `matomo` → "Matomo")                            |
| Sublabel    | "shared" badge when `shared === true`, otherwise nothing                |
| Description | Optional one-liner; not in `services.yml` today, so omit until provided |
| Toggle      | Bound to `applications.<role-id>.services.<key>.enabled` (with default fallback to `default_enabled`) |

Toggle change handling:
- Click → optimistic update of the local toggle state.
- Issue a workspace PATCH writing only the changed key.
- On HTTP 4xx/5xx → revert the optimistic update and surface an error toast (existing toast infra).
- The toggle MUST be a real `<input type="checkbox">` wrapped in a label so screen readers announce the change.

### Billing tab — content

The existing controls in the modal that today live below the description (Plan dropdown via [EnableDropdown.tsx](../../apps/web/app/components/role-dashboard/EnableDropdown.tsx), price string, Enable / Disable button) MUST be moved verbatim into the Billing tab. No behaviour change; the only change is location.

If the role has zero plans, the Billing tab MUST render the same empty state the modal renders today for plan-less roles (no regression).

### Cross-tab behaviour

- Toggling services in the Services tab MUST NOT cause the Billing tab's Enable/Disable button to re-fire. Service overrides are independent of the role being enabled.
- Disabling the role (via the Billing tab) MUST keep service-override state intact, so re-enabling the role later restores the user's choices.
- Enabling a role with service overrides set MUST surface those overrides in the deployment payload sent to the runner (existing payload extension point), so the deployment actually receives the user's choices. The runner-side honouring of the flags is out of scope for this requirement (tracked as a follow-up).

## Acceptance Criteria

### Backend — source resolution
- [ ] The loader walks the candidate paths `meta/services.yml` → `config/main.yml` in that order and uses the first source that yields at least one toggle.
- [ ] When BOTH sources exist on the same role, `meta/services.yml` wins.
- [ ] When NEITHER source exists, `services_links: []` is returned and role-index loading continues normally for that role.
- [ ] An `INFO` log line per role records the source used (`source=meta-services` / `source=config-main` / `source=none`).
- [ ] A malformed YAML file at either candidate path emits a warning and is treated as empty; the next candidate is then tried.

### Backend — classification
- [ ] On the new layout (`meta/services.yml`): toggle vs app-config classification follows the rule in the Backend section (entry has `enabled` AND none of `image`/`ports`/`run_after`/`version`/`name`).
- [ ] On the current image layout (`config/main.yml`): both `features:` and `services:` sub-sections are inspected and their toggle entries merged, with `services:` winning on key collision.
- [ ] On the current image layout: bare-boolean form (`matomo: true`) yields `{ default_enabled: true, shared: false }`; mapping-with-`enabled` form yields the explicit values.
- [ ] App-config blocks (those carrying `image` / `ports` / `run_after` / `version` / `name`) are NEVER exposed as `services_links` regardless of source layout.

### Backend — schema
- [ ] `RoleOut.services_links` is populated and serialised on the existing role-index endpoint; default `[]` keeps older clients backward-compatible.

### Workspace state
- [ ] PATCH on `applications.<role-id>.services.<key>.enabled` persists into `workspace.json`.
- [ ] Reading the workspace yields the user's override when set, else the role's `default_enabled`.
- [ ] Disabling the role MUST NOT delete the `services` map; re-enabling it surfaces the same overrides.

### Frontend — tabs
- [ ] `RoleDetailsModal` renders exactly three tabs in the order General → Services → Billing.
- [ ] Default active tab on open is `General`.
- [ ] Tabs are real ARIA tabs (`role="tab"`, `aria-selected`, `role="tabpanel"`, `aria-labelledby`).
- [ ] `ArrowLeft` / `ArrowRight` switch tabs when focus is on the tab strip.
- [ ] Closing and reopening the modal resets the active tab to `General`.

### Frontend — Services tab
- [ ] Each `ServiceLink` renders one row with icon, label, optional `shared` badge, and a checkbox toggle.
- [ ] Toggle reflects the effective state (override-or-default).
- [ ] Toggle click triggers a PATCH and optimistically updates the UI; failure reverts and shows a toast.
- [ ] Roles with `services_links: []` show the empty-state message instead of an empty list.

### Frontend — General + Billing tabs
- [ ] `General` shows the existing description / targets / categories / tags / links unchanged.
- [ ] `Billing` shows the existing plan dropdown / price / Enable-Disable button unchanged.
- [ ] Roles with zero plans show the same empty-state in Billing that the current modal shows today.

### Tests
- [ ] Python unit: source-resolution helper covers (a) only `meta/services.yml` present, (b) only `config/main.yml` present, (c) BOTH present → `meta/services.yml` wins, (d) NEITHER present → `[]`, (e) malformed YAML at one source falls through to the other, (f) malformed YAML at both → `[]` with two warnings.
- [ ] Python unit: classification covers (a) typical new-layout mix of toggles and one app-config block, (b) `config/main.yml` with `features:` only, (c) `config/main.yml` with `services:` only, (d) `config/main.yml` with BOTH `features:` and `services:` on overlapping keys → `services:` wins, (e) bare-boolean and mapping-with-`enabled` forms, (f) entries that are NOT mappings → skipped with warning.
- [ ] Python unit: workspace PATCH for service overrides — happy path, conflicting concurrent writes (existing workspace-write-lock test pattern).
- [ ] Node unit: tab-switch reducer / hook isolated test (General → Services → Billing → General).
- [ ] Playwright (added to the existing `apps/web/tests/` suite): open the Akaunting role detail → switch to Services tab → toggle `matomo` off → close + reopen modal → assert toggle still off → switch to Billing → assert plan dropdown + Enable button render. The spec MUST work whether the underlying image ships `meta/services.yml` or `config/main.yml`, since both produce the same `services_links` over the wire.

### Quality
- [ ] No new external runtime dependency added.
- [ ] No new API endpoint added (extends existing role-index response and existing workspace PATCH).
- [ ] Tab strip reuses the existing `.tabList` / `.tabButton` / `.tabPanel` classes from `DeploymentWorkspace.module.css`; no new tab CSS conventions.
- [ ] `make lint` and `make test-unit` pass on the same baseline as before this requirement.

## Out of Scope

- **Service-level configuration beyond enable/disable.** Setting parameters on the service from this UI (e.g. choosing a Matomo retention policy) is not addressed here.
- **Cross-app service selection.** "Use the Matomo from workspace X for the app in workspace Y" is not addressed; each workspace's services live in that workspace.
- **Reordering, hiding, or renaming the three tabs** at runtime. The tab order and labels are fixed.
- **Mode (Basic / Expert) gating** of individual services. The Basic / Expert toggle from req-related UI work governs other surfaces; for this modal, all toggles are visible to all users.
- **Runner-side honouring** of the per-service overrides at deploy time. This requirement establishes the override surface and the payload contract; making the Ansible runs respect each flag is tracked as a follow-up.
- **A bulk "enable all defaults" / "disable all" button** on the Services tab. Per-row toggles only, for now.
- **Backfilling `description` text** for each service. The schema is ready to render a description; populating it is a content task tracked separately.
- **Migrating roles from the old `config/main.yml` layout to the new `meta/services.yml` layout.** That migration belongs to the `infinito-nexus` repo, not to this requirement. The deployer-side loader is built to be source-layout-agnostic exactly so this migration can land independently and be a no-op for the deployer.
- **Removing the old-layout code path.** The `config/main.yml` branch in the loader stays in tree until every supported `INFINITO_NEXUS_IMAGE` ships the new layout. Removing it is a separate, clearly-scoped follow-up commit (one helper, plus its tests).

## Cross-References

- [005 - Store Layout, Filters, View](005-store-layout-filters-view.md) — the dashboard surface that hosts the role-detail modal this requirement reshapes.
- [008 - Role Pricing & Plan Variants](008-role-pricing-variants.md) — defines the data the new `Billing` tab consumes (plans, prices).
- [011 - Software Tab: Bundles & Apps](011-software-tab-bundles-and-apps.md) — defines the entry points from which the modal opens for both single apps and bundle-member apps.
- [003 - Workspace Selection & Multi-Tenant](003-workspace-selection-and-multi-tenant.md) — defines the workspace state file that now also carries the per-service override map.
