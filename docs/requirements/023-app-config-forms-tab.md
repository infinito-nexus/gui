# 023 - App Configuration Forms Tab + Inventory Sync

## User Story

As a workspace owner customising an app, I want a `Forms` tab in the role-detail modal that exposes every configuration field the role declares — typed, labelled, with the role's default pre-filled — so I can configure the app without learning its variable schema by heart or hand-editing `host_vars/*.yml`. Edits I make in the Forms tab MUST be persisted to the workspace inventory so the next deployment uses my values, and external edits to the inventory MUST be reflected back into the form on the next open.

## Background

Today the only way to override role variables is to hand-edit YAML in the workspace's `host_vars/<alias>.yml` or `group_vars/all.yml`. The deployer already has the plumbing for that path — `WorkspaceServiceInventoryRoleAppsMixin` ([workspace_service_inventory_role_apps.py](../../apps/api/services/workspaces/workspace_service_inventory_role_apps.py)) reads and writes `host_vars/<alias>.yml.applications.<role-id>` overrides, and `_load_role_defaults` already loads the role's `config/main.yml` defaults. What's missing is the typed form UI on top of it, and the schema layer that tells the form which renderer to pick per field.

The role tree is mid-migration (see [022](022-app-detail-tabs-and-service-toggles.md) for the precedence rule):

- **Current image layout** — `roles/<role>/config/main.yml` is the single per-role config file. It carries every variable the role expects, with default values inline. Type information is implicit from the YAML node type of each default.
- **New upstream layout** — config is split across `meta/main.yml` (Galaxy + role identity), `meta/info.yml` (logo / lifecycle), `meta/services.yml` (connected services, see [022](022-app-detail-tabs-and-service-toggles.md)), `meta/server.yml`, `meta/volumes.yml`, and `meta/schema.yml` (the typed schema for credentials/secrets, today only — likely extended to general fields by the time this requirement lands).

Requirement [022](022-app-detail-tabs-and-service-toggles.md) added the General / Services / Billing tabs and a layered services loader. This requirement (023) adds the Forms tab next to them and a sibling layered config-schema loader.

## Scope

- **One new tab** `Forms` in [RoleDetailsModal.tsx](../../apps/web/app/components/role-dashboard/RoleDetailsModal.tsx), placed after `Services` and before `Billing`. The tab strip becomes: General → Services → Forms → Billing.
- **Schema discovery via a layered loader** with a fixed precedence (analogue to [022](022-app-detail-tabs-and-service-toggles.md)'s `services_links` loader):

  | Order | Source                              | Use                                                            |
  |-------|-------------------------------------|----------------------------------------------------------------|
  | 1     | `<role>/meta/schema.yml`            | explicit typed schema (new layout — preferred)                 |
  | 2     | `<role>/meta/*.yml` (defaults)      | new layout: type-infer from each meta file's default values    |
  | 3     | `<role>/config/main.yml` (defaults) | current image layout: type-infer from defaults                 |

  When more than one source is present, the higher-precedence one wins per-field; lower-precedence sources fill remaining keys. Roles without any source yield an empty Forms tab with the empty-state message defined below.

- **Type-aware rendering** — boolean → toggle, integer/float → number input, scalar string → text input, multiline string → textarea, list-of-scalars → tag input, mapping → recursive nested form group. Field names that match `/(password|secret|token|api[_-]?key)/i` (case-insensitive) MUST render as masked password inputs regardless of their underlying type.
- **Inventory mirroring** in both directions:
  - Forms-tab edits PATCH the workspace inventory at `host_vars/<alias>.yml.applications.<role-id>.<field-path>` (per-host) or `group_vars/all.yml.applications.<role-id>.<field-path>` (workspace-wide, when no alias is selected).
  - On tab open the form pre-fills from the inventory; for fields with no override, the role default is shown in muted style with a "default" indicator. A per-field "Reset to default" button removes the override key from the inventory file.
- **Reuses the existing tab styling** from [DeploymentWorkspace.module.css](../../apps/web/app/components/DeploymentWorkspace.module.css) (`.tabList`, `.tabButton`, `.tabPanel`) — same convention as [022](022-app-detail-tabs-and-service-toggles.md).

## Backend changes

### Schema source layout (precedence)

The loader MUST resolve a role's typed config schema by walking the candidate sources IN ORDER and merging key-by-key with first-source wins:

| Order | Path                                | Layout era            | Notes                                                                                          |
|-------|-------------------------------------|-----------------------|------------------------------------------------------------------------------------------------|
| 1     | `<role>/meta/schema.yml`            | new (upstream)        | Explicit typed schema. Top-level keys describe sections; leaves carry `{type, description, validation, default}`. |
| 2     | `<role>/meta/*.yml` defaults        | new (upstream)        | Iterates every `meta/*.yml` except `schema.yml`; treats each top-level key not classified as a service-toggle (per req-022) as a config field, type-inferred from its default. |
| 3     | `<role>/config/main.yml` defaults   | current image         | Single-file per-role config. Type-infers from each top-level key's default. App-config blocks (those carrying `image` / `ports` / `run_after` / `version` / `name`, see [022](022-app-detail-tabs-and-service-toggles.md)) MUST be excluded — they are role-internal, not user-tunable. |

A role that exposes BOTH `meta/schema.yml` AND `config/main.yml` MUST surface every field exactly once: typed metadata from `schema.yml` wins; defaults from `meta/*.yml` and `config/main.yml` fill values not covered by the schema. The loader MUST emit one `INFO` log line per role recording which sources contributed (`sources=meta-schema,meta-defaults,config-main`), so the migration cut-over is observable.

### Type inference rules

For sources without an explicit type (i.e. order 2 and 3), type is inferred from the YAML node:

| YAML node                                 | Form field         |
|-------------------------------------------|--------------------|
| `true` / `false`                          | `boolean`          |
| integer literal                           | `integer`          |
| float literal                             | `float`            |
| string with no newline, ≤120 chars        | `string`           |
| string with newline OR > 120 chars        | `text`             |
| list whose items are all the same scalar  | `list[<scalar>]`   |
| mapping                                   | `mapping` (recurses)|
| anything else (mixed list, null)          | `string` (fallback) |

`schema.yml` entries override the inferred type when present.

### API schema

The role-detail endpoint (or a new sibling) MUST return:

```python
class FormField(BaseModel):
    path: list[str]                # e.g. ["company", "name"]
    type: Literal["boolean", "integer", "float", "string", "text",
                  "list", "mapping", "password"]
    label: str
    description: str | None = None
    default: Any | None = None
    enum: list[Any] | None = None
    validation: str | None = None  # regex, mirrors meta/schema.yml's `validation`
    secret: bool = False           # auto-masked in UI

class RoleOut(BaseModel):
    ...
    form_fields: list[FormField] = []
```

`form_fields` is a flat list keyed by `path`; nested mappings are unfolded to `path = ["parent", "child"]` so the frontend renders a single tree view without the API needing to model recursion.

### Inventory write/read endpoints

Both directions reuse existing infrastructure:

- **Read** — the existing `GET /api/workspaces/{id}/files/host_vars/<alias>.yml` already returns the YAML mapping the form pre-fills from. The frontend extracts `applications.<role-id>` and walks the `path` of each `FormField` to find the override (if any).
- **Write** — a new `PATCH /api/workspaces/{id}/applications/{role-id}/config` endpoint accepts `{alias?: str, path: list[str], value: any | None}` and edits the matching `host_vars/<alias>.yml` (or `group_vars/all.yml` when `alias` is null). `value: null` MUST delete the key, not write `null`. The endpoint reuses `WorkspaceServiceInventoryRoleAppsMixin._read_role_app_context` and the existing workspace write-lock so concurrent edits are serialised.

## Frontend changes

### Tab placement

`Forms` is added to the existing tab strip after `Services` and before `Billing`. Default active tab on open stays `General`. The same ARIA / keyboard rules from [022](022-app-detail-tabs-and-service-toggles.md) apply: real `role="tab"` buttons, `aria-selected`, `ArrowLeft`/`ArrowRight` to switch.

### Field rendering

For each `FormField`, the form renders:

| Field part            | Source                                                            |
|-----------------------|-------------------------------------------------------------------|
| Label                 | `label` (falls back to title-cased last `path` segment)           |
| Help text             | `description` if present, rendered muted under the input          |
| Input control         | per `type` (table above), with `enum` rendered as `<select>`      |
| Override indicator    | a small badge "default" when the inventory has no override; "set" when the user (or external edit) has provided a value |
| Reset-to-default      | per-row button, visible only when "set". Click → backend `PATCH` with `value: null` → row reverts to default state |
| Validation hint       | when `validation` (regex) does not match, show the inline error and disable Save for that field |

Mappings render as a collapsible sub-form (one nesting level shows expanded by default, deeper levels collapsed).

Lists of scalars render as a tag-input. Mixed lists (objects-in-list) are out of scope for this requirement and render read-only as a YAML preview with a "Edit raw" link to the existing file editor.

### Save UX

- Per-field optimistic save: change → backend `PATCH` → on success the indicator flips to "set"; on failure the field reverts and shows the error toast. No global Save button.
- Form is a controlled component; uncommitted typed text waits until blur or `Enter` before issuing the PATCH (debounced 300 ms) so we don't write a half-typed value on every keystroke.
- The tab MUST display a small "synced N seconds ago" footer reflecting the last successful PATCH, so the user has a visual confirmation that their work is saved.

### External-edit awareness

- When the user opens the Forms tab, the form re-loads the inventory (no cached data — always re-fetch). This catches edits made via the file editor or git pull while the modal was closed.
- While the tab is open, an inventory file mtime poll (every 5 s) detects external changes and surfaces a yellow banner "This workspace's inventory was modified outside the form. [Reload]" with a Reload button that re-fetches and discards uncommitted local edits.

### Empty state

A role whose loader returns `form_fields: []` (e.g. a role whose `config/main.yml` is empty or only contains app-config blocks) MUST show:

> This app has no user-configurable fields. Internal app-config (image, ports, dependencies) is managed by the role itself.

with a link to the General tab.

## Acceptance Criteria

### Backend — source resolution
- [ ] Loader walks the candidate sources `meta/schema.yml` → `meta/*.yml` defaults → `config/main.yml` defaults in that order and merges per-key with first-source wins.
- [ ] App-config blocks (carrying `image`/`ports`/`run_after`/`version`/`name`) are NEVER exposed as form fields — same exclusion rule as req-022.
- [ ] One `INFO` log line per role records which sources contributed.
- [ ] A malformed YAML in any candidate emits a warning and is treated as empty; the next candidate is tried.

### Backend — type inference
- [ ] Bool/int/float/string/text/list/mapping inference matches the type-inference table.
- [ ] Field names matching `/(password|secret|token|api[_-]?key)/i` are flagged `secret: true` regardless of inferred type.
- [ ] `meta/schema.yml`'s explicit `type` and `validation` win over inferred values when both exist.

### Backend — endpoints
- [ ] `RoleOut.form_fields` is populated and serialised on the existing role-detail response; default `[]` for older clients.
- [ ] New `PATCH /api/workspaces/{id}/applications/{role-id}/config` accepts `{alias?, path, value}` and writes / deletes the corresponding key in `host_vars/<alias>.yml` (or `group_vars/all.yml` when `alias` is null).
- [ ] `value: null` deletes the key; it MUST NOT write a literal `null`.
- [ ] Concurrent edits use the existing workspace write-lock; the integration-test pattern from `test_workspace_service_refactor_part1` applies.
- [ ] Server-side validation honours each field's `validation` regex when present; failures return HTTP 422 with the field path.

### Frontend — tabs
- [ ] `RoleDetailsModal` renders four tabs in order: General → Services → Forms → Billing (Services / Billing as defined in req-022, Forms new).
- [ ] Default active tab on open remains `General`.
- [ ] Same ARIA + keyboard rules as the existing tabs (req-022).

### Frontend — form rendering
- [ ] Each `FormField` renders the matching control (toggle / number / text / textarea / tag-input / select / nested form).
- [ ] `secret: true` fields render a masked password input regardless of their underlying type.
- [ ] An "default" / "set" indicator per row reflects whether the inventory override exists.
- [ ] "Reset to default" issues the PATCH with `value: null` and flips the indicator back to "default".
- [ ] `validation`-regex failures inline-disable the row's Save until the input matches.

### Frontend — save UX
- [ ] Edits debounce 300 ms then PATCH; failures revert the row and toast the error.
- [ ] No global Save button; per-field optimistic saves only.
- [ ] A "synced N seconds ago" footer reflects the last successful PATCH.

### Frontend — external sync
- [ ] Re-opening the tab triggers a fresh inventory load (no stale cache).
- [ ] A 5 s mtime poll surfaces a yellow banner with "Reload" when an external edit is detected; Reload re-fetches and drops uncommitted local edits.
- [ ] Empty-state message renders when `form_fields: []`.

### Tests
- [ ] Python unit: schema-source resolution covers (a) schema.yml only, (b) meta/* only, (c) config/main.yml only, (d) ALL three present (schema wins per-field; meta and config fill remaining keys), (e) malformed YAML in one source falls through.
- [ ] Python unit: type-inference matrix for every entry of the inference table, including the `password|secret|token` field-name match.
- [ ] Python unit: PATCH endpoint covers `set` / `delete` / `value=null` / regex-validation failure / missing role / missing alias / write-lock contention.
- [ ] Node unit: form-state reducer (default → set → reset → set with regex failure → recovery).
- [ ] Playwright (`apps/web/tests/role_forms.spec.ts`): open Akaunting role detail → switch to Forms tab → toggle a boolean → text-edit a string → set a list field → verify each PATCH lands → reload page → verify pre-fill from inventory shows the saved values → click "Reset to default" on one field → verify it reverts and the inventory key is gone.

### Quality
- [ ] No new external runtime dependency.
- [ ] No new tab CSS conventions; reuses `.tabList` / `.tabButton` / `.tabPanel`.
- [ ] `make lint` and `make test-unit` stay green.
- [ ] PATCH writes go through the existing workspace git-history pipeline (req [013](013-git.md)) so each form save lands as a workspace commit with a deterministic message ("Forms: set <role>.<path>" / "Forms: reset <role>.<path>").

## Out of Scope

- **Visual schema editor** for the role itself. The form is consumer-side only; the role's `config/main.yml` / `meta/schema.yml` is authored upstream.
- **Mixed-type lists** (lists of objects). The form renders these read-only with an "Edit raw" link — full inline editing is a follow-up.
- **Per-environment overrides** (dev / staging / prod toggles within a single workspace). Workspaces remain the single override scope.
- **Cross-app field references** (e.g. "set Akaunting's `mariadb_host` to the Mariadb app's exposed hostname"). Out of scope; values are static.
- **Playbook diff preview** before saving. Edits hit the inventory immediately. A pre-deploy diff is a separate requirement.
- **Migrating roles from the old `config/main.yml` layout to the new `meta/*` layout.** Same boundary as [022](022-app-detail-tabs-and-service-toggles.md) — the role-side migration belongs upstream; the deployer-side loader is built layout-agnostic so the migration is a no-op for this UI.
- **Removing the old-layout code path.** Same lifecycle as req-022: stays in tree until every supported `INFINITO_NEXUS_IMAGE` ships the new layout, then a single follow-up commit removes the `config/main.yml` branch from both loaders.

## Cross-References

- [022 - App Detail Tabs (General · Services · Billing) and Per-Service Toggles](022-app-detail-tabs-and-service-toggles.md) — defines the surrounding tab structure and the layered-loader pattern this requirement extends.
- [001 - Workspace Inventory & File Browser](001-credential-generation.md) — defines the workspace files (`host_vars/<alias>.yml`, `group_vars/all.yml`) this form writes to.
- [013 - Git-Backed Workspace History](013-git.md) — defines the commit-on-write pipeline; per-field saves land as workspace commits via the existing path.
- [010 - Devices, Provider Mode and Order Flow](010-devices-provider-mode-and-order-flow.md) — defines the `alias` selection that scopes a save to per-host vs workspace-wide.
- [005 - Store Layout, Filters, View](005-store-layout-filters-view.md) — the surface that hosts the role-detail modal this requirement extends.
