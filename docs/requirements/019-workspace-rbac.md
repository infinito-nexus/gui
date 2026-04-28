# 019 - Workspace RBAC: Owner + Member Memberships

## User Story

As a workspace owner, I want to invite other users into my workspace and have them see / edit it as members, so that I can collaborate without sharing my login. Owners stay in control of who has access; members get full read/write on the workspace contents but cannot manage memberships.

## Background

Requirement [007](007-optional-auth-persistent-workspaces.md) introduced single-owner workspaces via OAuth2-Proxy headers. The workspace is persisted as a `workspace.json` file at `${STATE_DIR}/workspaces/{workspace_id}/workspace.json` with `owner_id` and `owner_email` fields ([apps/api/services/workspaces/workspace_service_management.py:47-61](../../apps/api/services/workspaces/workspace_service_management.py#L47-L61)). The auth dependency at [apps/api/api/auth.py:27-41](../../apps/api/api/auth.py#L27-L41) returns the proxy-supplied user identity as an opaque string, and `ensure_workspace_access()` currently checks `owner_id == ctx.user_id` only.

This requirement adds a second role (`member`) on the same workspace and extends the access check to cover both. There is **no DB and no user table** — the membership list lives inside the existing `workspace.json` file, consistent with the file-based architecture of req 007.

## Scope

- **Two-tier role model: `owner` and `member`.** No further roles in this requirement (no admin, no editor, no viewer). A workspace has exactly one owner at all times.
- Memberships are stored in the same `workspace.json` file that already holds `owner_id` / `owner_email`. No separate database, no separate file.
- "Adding a user" works **lazy**: the owner enters an email address; the system stores a *pending invite* (membership entry with `email` set and `user_id: null`); on the invitee's first authenticated request whose `X-Auth-Request-Email` matches, the entry is *claimed* (its `user_id` is filled in) and the user gains access from that moment.
- Authentication is out of scope here — the proxy headers are still the only source of identity. OIDC end-to-end testing is requirement [020](020-oidc-e2e-via-dummy-provider.md).
- No bulk-invite, no organisations, no nested groups. A user is either owner, member, invited (pending), or unrelated — nothing else.

## Data Model

`workspace.json` gains a `members` array next to the existing fields:

```json
{
  "workspace_id": "abc123",
  "owner_id":    "alice",
  "owner_email": "alice@example.com",
  "members": [
    {
      "user_id":    "bob",
      "email":      "bob@example.com",
      "joined_at":  "2026-04-29T10:11:12Z",
      "invited_by": "alice"
    },
    {
      "user_id":    null,
      "email":      "carol@example.com",
      "invited_at": "2026-04-29T10:11:30Z",
      "invited_by": "alice"
    }
  ],
  "...": "(unchanged: name, created_at, last_modified_at, state, etc.)"
}
```

Invariants enforced by the service layer:

- Exactly one owner per workspace (`owner_id` is non-null and not present in `members`).
- A user cannot appear in `members` if they are also the owner.
- A pending invite has `user_id: null` and a non-empty `email`.
- Email uniqueness within a workspace: an address may appear at most once across `owner_email` + claimed-member emails + pending-invite emails.

## API Surface

All routes live under `/api/workspaces/{workspace_id}/members` and require an authenticated request (`AuthContext.proxy_enabled and user_id`). Anonymous workspaces have no members at all — these routes return `404` for them.

| Method | Path | Allowed for | Behaviour |
|---|---|---|---|
| `GET`  | `/members` | owner + claimed members | Returns owner, claimed members, and pending invites. Pending invites only include `email` + `invited_at` + `invited_by`. |
| `POST` | `/members` | owner only | Body: `{"email": "..."}`. Adds a pending invite if the email is not already owner / member / pending. Returns the new entry with `user_id: null`. |
| `DELETE` | `/members/{member_id_or_email}` | owner only | Removes a claimed member by `user_id` or a pending invite by `email`. Cannot target the owner. |
| `POST` | `/members/transfer-ownership` | owner only | Body: `{"new_owner_id": "..."}`. The named user MUST already be a claimed member. The current owner becomes a member; the named member becomes the new owner. Atomic. |

Pending invites are *claimed* implicitly inside `ensure_workspace_access()` — no separate "accept" endpoint:

```
def ensure_workspace_access(ctx, workspace) -> None:
    if ctx.user_id == workspace.owner_id:
        return                                          # owner
    for m in workspace.members:
        if m.user_id == ctx.user_id:
            return                                      # already-claimed member
        if m.user_id is None and m.email and m.email == ctx.email:
            m.user_id   = ctx.user_id
            m.joined_at = utcnow()
            persist(workspace)
            return                                      # claim-on-access
    raise HTTPException(403)
```

## Authorization Matrix

| Action                                  | Owner | Member | Invited (pending) | Anonymous / outsider |
|-----------------------------------------|-------|--------|-------------------|----------------------|
| Read workspace contents (files, vars)   | ✓     | ✓      | claim → ✓         | ✗ (403)              |
| Edit workspace contents                 | ✓     | ✓      | claim → ✓         | ✗ (403)              |
| Generate inventory / start deploy       | ✓     | ✓      | claim → ✓         | ✗ (403)              |
| List members                            | ✓     | ✓      | claim → ✓         | ✗                    |
| Invite member                           | ✓     | ✗ (403)| ✗                 | ✗                    |
| Remove member                           | ✓     | ✗ (403)| ✗                 | ✗                    |
| Transfer ownership                      | ✓     | ✗ (403)| ✗                 | ✗                    |
| Delete workspace                        | ✓     | ✗ (403)| ✗                 | ✗                    |

`GET /api/workspaces` (the list endpoint) MUST return all workspaces where the caller is owner OR claimed member. Pending-invite emails do NOT make the workspace appear in this list — the user must access the workspace once (e.g. via a shared URL the owner sends them) for the claim to fire and the workspace to appear in their list.

## Frontend

The existing "My Workspaces" panel ([apps/web/app/components/workspace-panel/WorkspaceSwitcher.tsx](../../apps/web/app/components/workspace-panel/WorkspaceSwitcher.tsx)) remains the entry point. Inside a workspace view, a new **Members** tab (or modal) renders:

- The owner with a crown / "Owner" badge.
- Each claimed member as a row with email + joined-at.
- Each pending invite as a greyed-out row with email + "Pending" badge.
- For the owner only: an `Invite` form (email field + submit) and `Remove` / `Make owner` buttons per row.
- For non-owners: read-only.

No design system changes beyond the existing component library.

## Acceptance Criteria

### Data model + service layer
- [x] `Workspace` Pydantic schema gains `WorkspaceMemberOut` with `user_id`, `email`, `role`, `joined_at`, `invited_at`, `invited_by` ([apps/api/api/schemas/workspace.py](../../apps/api/api/schemas/workspace.py)).
- [x] `workspace_service_management.create()` writes `members: []` into the new `workspace.json` ([apps/api/services/workspaces/workspace_service_management.py](../../apps/api/services/workspaces/workspace_service_management.py)).
- [x] Existing workspaces without a `members` key load via `_normalize_members()` returning `[]` (covered by `test_workspace_without_members_key_loads`).
- [x] `assert_workspace_access()` honours owner / claimed-member / pending-invite-email logic per the snippet (covered by 13 unit tests in `tests/python/unit/test_workspace_rbac.py`).
- [x] Claim-on-access persists via `_write_meta()` → `atomic_write_json()` (write-temp + rename); claim is verified end-to-end by `test_pending_invite_claims_on_access_by_email`.

### API
- [x] `GET /api/workspaces` returns owner + claimed-member entries with a `role` field; pending invitees absent (test `test_list_for_user_includes_claimed_only`).
- [x] `GET /api/workspaces/{id}/members` returns owner + claimed + pending; non-members get 404 (test `test_non_member_cannot_list_members`).
- [x] `POST /api/workspaces/{id}/members` owner-only; rejects duplicate emails (409 in `_invite_member`).
- [x] `DELETE /api/workspaces/{id}/members/{key}` owner-only; works for both `user_id` and `email`; refuses to target the owner (tests `test_owner_can_remove_*` and `test_owner_cannot_remove_self_via_remove_member`).
- [x] `POST /api/workspaces/{id}/members/transfer-ownership` owner-only; refuses if new owner is not a claimed member (tests `test_transfer_*`).

### Frontend
- [x] [`apps/web/app/components/MembersPanel.tsx`](../../apps/web/app/components/MembersPanel.tsx) renders owner / claimed / pending rows with badges; owner-only controls (`Invite`, `Remove`, `Make owner`) gated by `isOwner` prop.
- [x] Component is reused inside the [Account hub Workspaces tab](021-login-prompt-and-account-hub.md) — single source of truth for member management.
- [ ] Removing the active member redirect → covered by API behaviour (next call 403); UI-side redirect on 403 deferred to a follow-up Playwright spec.

### Tests
- [x] Unit tests for `assert_workspace_access` cover: owner, claimed member, pending-invite-claim flow, mismatched email, anonymous (13 tests in `test_workspace_rbac.py`, all green).
- [x] Integration tests for all four routes covering the authorization matrix (in the same file).
- [ ] Playwright test for invite + remove flow — deferred (the existing dashboard E2E exercises anonymous flow; new specs land in a follow-up to keep the regression surface predictable while the UI iterates).

### Security
- [x] `member_key` path parameter is URL-encoded by the frontend client and treated as an opaque string in the service — never as a filesystem path or shell argument.
- [x] Members cannot self-promote: `transfer-ownership` is owner-only and gated by `_require_workspace_owner`.
- [x] Email comparison is case-insensitive and stripped (`_normalize_email` in workspace service).
- [x] Malformed `members` entries are dropped silently by `_normalize_members`; the on-disk file is rewritten only on a real mutation. Detection of *truly corrupted* JSON falls through to the existing `_load_meta` error path; this is acceptable because torn-writes are prevented by atomic_write.

## Out of Scope

- More than two roles (admin, editor, viewer, …). Adding a third role later MUST extend this requirement explicitly.
- Organisations, teams, nested membership.
- A user table or any persistent user-management entity. Identity stays opaque-string-from-proxy.
- Email delivery — the system stores the invite, but does NOT send any email. The owner is responsible for telling the invitee the workspace URL out-of-band.
- OIDC integration / login flow — see requirement [020](020-oidc-e2e-via-dummy-provider.md).

## Cross-References

- [003 - Workspace Selection & Multi-Tenant Workspaces](003-workspace-selection-and-multi-tenant.md) — workspace context, URL routing.
- [007 - Optional Login & Persistent Workspaces (OAuth2 Proxy)](007-optional-auth-persistent-workspaces.md) — single-owner foundation this requirement extends.
- [020 - End-to-End OIDC via OAuth2 Proxy + Dummy Provider](020-oidc-e2e-via-dummy-provider.md) — companion requirement adding a real OIDC test path; orthogonal to this RBAC work.
