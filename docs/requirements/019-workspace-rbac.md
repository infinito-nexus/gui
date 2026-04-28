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
- [ ] `Workspace` Pydantic schema gains a `members: list[WorkspaceMember]` field; `WorkspaceMember` has `user_id: Optional[str]`, `email: Optional[str]`, `joined_at: Optional[datetime]`, `invited_at: Optional[datetime]`, `invited_by: str`.
- [ ] `workspace_service_management.create()` writes `members: []` into the new `workspace.json`.
- [ ] Existing workspaces (created before this requirement) load without error: a missing `members` key MUST be treated as `[]`.
- [ ] `ensure_workspace_access()` honours owner / claimed-member / pending-invite-email logic exactly per the snippet above.
- [ ] Claim-on-access persists the updated `workspace.json` atomically (write-temp + rename, no torn writes).

### API
- [ ] `GET /api/workspaces` returns workspaces where the caller is owner or claimed member; pending-invitee emails alone are NOT enough.
- [ ] `GET /api/workspaces/{id}/members` returns owner + claimed members + pending invites; `403` for non-members; `404` for anonymous workspaces.
- [ ] `POST /api/workspaces/{id}/members` (owner-only) creates a pending invite; rejects duplicates with `409`.
- [ ] `DELETE /api/workspaces/{id}/members/{key}` (owner-only) removes a claimed member by `user_id` or pending invite by `email`; `404` if not found; `403` if caller is not the owner; refuses to target the owner.
- [ ] `POST /api/workspaces/{id}/members/transfer-ownership` (owner-only) atomically swaps owner ↔ named member; refuses if `new_owner_id` is not a claimed member.

### Frontend
- [ ] "Members" panel renders owner, claimed members, and pending invites with the badges described above.
- [ ] Owner sees `Invite`, `Remove`, `Make owner` controls; non-owner sees read-only.
- [ ] Removing the active member kicks them out of the workspace view (next API call returns 403, UI redirects to "My Workspaces").

### Tests
- [ ] Unit tests for `ensure_workspace_access()` cover: owner, claimed member, pending-invite-claim flow, mismatched email, mismatched user_id, anonymous.
- [ ] Integration tests for all four routes covering the authorization matrix.
- [ ] Playwright test (extending the existing dashboard E2E spec) covering: owner invites bob's email → bob (logged in via header mock) opens workspace URL → workspace becomes visible in bob's list → bob can edit a file.
- [ ] Playwright test: owner removes bob → bob's next request returns 403 → workspace disappears from bob's list.

### Security
- [ ] `member_id_or_email` path parameter is treated as an opaque key — never as a filesystem path or shell argument.
- [ ] No member can escalate to owner without a successful `transfer-ownership` from the current owner.
- [ ] Email comparison is case-insensitive and trims surrounding whitespace.
- [ ] A `workspace.json` with corrupted / inconsistent members (e.g. duplicate emails, owner appearing in `members`) MUST be rejected at load time with a clear log line; the workspace MUST NOT be silently rewritten.

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
