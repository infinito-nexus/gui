# 021 - Login Prompt & Account Hub

## User Story

As a first-time visitor, I want the app to ask me up-front whether I'm continuing as a guest or as a logged-in user, so that I make a deliberate choice instead of stumbling into anonymous mode and losing my work later. As a logged-in user, I want a single "Account" page that shows all my workspaces, all the collaborators I work with, and lets me assign either side to the other, so that I do not have to dig through individual workspaces to manage memberships.

## Background

Requirement [007](007-optional-auth-persistent-workspaces.md) made authentication optional and let anonymous users keep ephemeral workspaces; requirement [019](019-workspace-rbac.md) added owner / member memberships per workspace; requirement [020](020-oidc-e2e-via-dummy-provider.md) wires a real OIDC flow into the e2e lane.

What is still missing is the user-facing UX glue:

1. The app currently drops anonymous users straight into the workspace flow with no awareness that signing in would persist their work — a known footgun called out in [007](007-optional-auth-persistent-workspaces.md) but not addressed there.
2. Membership management today lives only inside an individual workspace's "Members" panel ([019](019-workspace-rbac.md)). A user with several owned workspaces has no aggregate view: no list of "all my workspaces with their members" and no list of "all collaborators I've added across my workspaces" — both of which are needed once the membership feature is actually used at scale.

This requirement closes those two gaps with two additions to the web frontend, no backend changes beyond what 019 already specifies.

## Scope

- **Login prompt is a JS modal**, not a server-rendered page. It runs entirely on the existing `apps/web/` Next.js stack; no new route is required.
- **Account hub is a new authenticated-only route `/account`** with two tabs: `Workspaces` and `Collaborators`. The existing in-header "My Workspaces" dropdown stays; the hub is the deeper view.
- **No new backend endpoints.** The aggregations described below are derived client-side from `GET /api/workspaces` (already authenticated and scoped per req 007) and per-workspace `GET /api/workspaces/{id}/members` (defined in req 019). If aggregation across many workspaces becomes a measurable performance issue later, a single `GET /api/account/collaborators` may be added — explicitly out of scope for this requirement.
- **No new persistence.** "Has the user dismissed the login prompt for this device" is stored in `localStorage` only.
- **The prompt is shown once per device-session-class.** It does not re-appear on every navigation, but it does re-appear after an explicit sign-out (so a user who logs out is asked again rather than silently dropping into guest mode).

## Login Prompt

### Trigger

The prompt component renders on `apps/web/app/page.tsx` (the entry page rendered by [page.tsx:147-149](../../apps/web/app/page.tsx#L147-L149)) when ALL of the following hold:

- The auth context reports the request is anonymous (no proxy headers / no session). The frontend already has this signal because the `WorkspaceListOut` schema returns `authenticated: bool` ([apps/api/api/schemas/workspace.py:34-45](../../apps/api/api/schemas/workspace.py#L34-L45)).
- `localStorage.getItem('infinito-login-prompt:dismissed') !== 'true'`.

When both hold, the prompt is shown as a centred modal with a darkened backdrop. The page underneath is rendered but inert (focus is trapped inside the modal). Closing the modal sets the dismissed flag.

### UI

```
┌──────────────────────────────────────────────┐
│  Welcome to Infinito Deployer                │
│                                              │
│  How would you like to continue?             │
│                                              │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │ Continue as     │  │ Sign in          │   │
│  │ guest           │  │                  │   │
│  │                 │  │ Persist your     │   │
│  │ Workspaces last │  │ work, invite     │   │
│  │ for this        │  │ collaborators,   │   │
│  │ session only    │  │ resume later     │   │
│  └─────────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────┘
```

- **Continue as guest**: dismisses the modal, sets `localStorage['infinito-login-prompt:dismissed'] = 'true'`, current anonymous flow continues unchanged.
- **Sign in**: navigates to `/oauth2/sign_in` (handled by OAuth2 Proxy in the live stack, by `oidc-mock`-backed `oauth2-proxy` in the e2e stack per req [020](020-oidc-e2e-via-dummy-provider.md)). On successful login the user lands back on `/`, this time as authenticated, and the modal is no longer shown.
- The backdrop is **not** clickable to dismiss (an accidental backdrop click should not silently choose guest mode for the user). Pressing Escape closes the modal as if "Continue as guest" was clicked, since Esc-to-dismiss is a baseline accessibility expectation.

### Re-prompt rule

The dismissed flag is cleared automatically on sign-out. Sign-out paths are:

1. The user clicks Sign Out in the account hub → frontend clears the flag, then redirects to `/oauth2/sign_out`.
2. The OAuth2 Proxy session expires while the user is still on the page → the next API request returns 401 → the frontend's auth-context refresh sees `authenticated: false`, clears the flag, and re-mounts the modal.

The flag is **not** cleared on browser tab close or on page reload (those events would re-prompt every refresh otherwise). It IS cleared when the user explicitly clicks "Switch to guest mode" or "Switch to logged-in mode" in the account hub (see below).

## Account Hub

### Route and shell

A new route `/account` is added under `apps/web/app/account/page.tsx`. The route MUST require authentication; an anonymous request is redirected to `/oauth2/sign_in` (production / 020-style stacks) or to `/` with the login prompt re-armed (header-mock test stack).

A new "Account" link is added to the top-level navigation, visible only when authenticated. The existing "My Workspaces" dropdown ([components/workspace-panel/WorkspaceSwitcher.tsx](../../apps/web/app/components/workspace-panel/WorkspaceSwitcher.tsx)) keeps working unchanged — the hub is a deeper view, not a replacement for the quick switcher.

### Tab 1 — Workspaces

A table of all workspaces the user is owner OR claimed member on (same data set as `GET /api/workspaces`). Columns:

| Column        | Source                                                            |
|---------------|-------------------------------------------------------------------|
| Name          | `workspace.name`                                                  |
| Role          | "Owner" if `owner_id == me.user_id`, else "Member"                |
| Members       | count of `members` (claimed + owner; pending invites shown muted) |
| Last modified | `workspace.last_modified_at`                                      |
| State         | `workspace.state` (draft / deployed / finished)                   |
| Actions       | "Open" → workspace context; "Manage members" → in-place panel     |

Clicking "Manage members" expands an inline panel reusing the per-workspace Members component from req [019](019-workspace-rbac.md). Owner-only actions (invite, remove, transfer ownership) are gated by the `Role` column on each row.

### Tab 2 — Collaborators

A list of every distinct `(user_id, email)` pair the current user has shared a workspace with — i.e. the union of `members` arrays across the workspaces the current user OWNS. Pending invites are included (with `user_id: null`).

Columns:

| Column      | Source                                                          |
|-------------|-----------------------------------------------------------------|
| Email       | `member.email`                                                  |
| Status      | "Active" (claimed) / "Pending" (invite not yet claimed)         |
| Workspaces  | comma-separated list of owned workspaces the collaborator is in |
| Actions     | "Add to workspace…" button; "Remove from all" button (with confirm) |

There is no global "user table" — this list is computed on the client by iterating the owner's workspaces and de-duplicating by email. If the current user is on workspaces they do not own, the OWNERS of those workspaces are NOT exposed here (this view is "people I've invited", not "people I work with").

### Cross-assignment flows

The two tabs share a single underlying operation — `POST /api/workspaces/{id}/members` — but reach it from two directions, so the user does not have to think about which view they are in:

- **From the Workspaces tab**: per-row "Manage members" → inline panel (the existing 019 flow).
- **From the Collaborators tab**: per-row "Add to workspace…" → small popover listing the current user's owned workspaces that this collaborator is NOT yet a member of → click one → backend POST → row updates. Likewise "Remove from all" iterates the membership rows and calls `DELETE` per workspace; the action is gated by an "are you sure?" confirm.

In both directions the auth check, deduplication and idempotency are owned by the backend per req 019 — the UI only orchestrates.

### Sign-out / switch-mode controls

A small footer area on `/account` shows:

- "Sign out" button → clears the `infinito-login-prompt:dismissed` flag, redirects to `/oauth2/sign_out`.
- "Switch to guest mode" link → same as Sign Out, but clearer for users who are evaluating whether to stay logged in.

## Acceptance Criteria

### Login prompt
- [ ] The modal renders on `/` only when `authenticated === false` AND `localStorage['infinito-login-prompt:dismissed'] !== 'true'`.
- [ ] "Continue as guest" sets the dismissed flag and closes the modal; the underlying app continues to behave exactly as today's anonymous flow.
- [ ] "Sign in" navigates to `/oauth2/sign_in` and on return shows the authenticated UI without the modal.
- [ ] The modal traps keyboard focus while open; Tab cycles within the two buttons; Esc treats the closure as "Continue as guest".
- [ ] The modal is dismissible by Esc but NOT by clicking the backdrop.
- [ ] The dismissed flag is cleared on sign-out (server-side session loss OR explicit click).
- [ ] The dismissed flag is NOT cleared on tab close or page reload alone.

### Account hub
- [ ] `/account` is reachable from a new "Account" link in the top nav, visible only when authenticated.
- [ ] An anonymous request to `/account` is redirected to the login flow (or to `/` with the prompt re-armed in the header-mock test stack).
- [ ] The Workspaces tab renders one row per workspace the user is owner or claimed member of, with the columns and actions defined above.
- [ ] The "Role" column shows "Owner" for owned workspaces and "Member" otherwise.
- [ ] Owner-only actions (invite, remove, transfer ownership) are hidden / disabled on Member rows.
- [ ] The Collaborators tab lists every distinct `(user_id, email)` pair across the user's OWNED workspaces, deduped by email; rows include claimed members AND pending invites.
- [ ] Each Collaborators row's "Workspaces" cell lists exactly the workspaces (owned by the current user) where that collaborator is present.
- [ ] "Add to workspace…" on a Collaborators row opens a popover with the user's owned workspaces minus the ones the collaborator is already in; selecting one calls `POST /api/workspaces/{id}/members` and updates the row.
- [ ] "Remove from all" on a Collaborators row issues `DELETE /api/workspaces/{id}/members/{email}` for each owned workspace the collaborator is in, after a confirm dialog.

### Tests
- [ ] Playwright: cold visit as anonymous → modal renders → click "Continue as guest" → modal gone, anonymous flow visible, reload does not re-show modal.
- [ ] Playwright: cold visit as anonymous → modal renders → click "Sign in" → end up on `/oauth2/sign_in` (in header-mock mode this is asserted by URL only; in the OIDC mode of req [020](020-oidc-e2e-via-dummy-provider.md) the flow continues through the mock).
- [ ] Playwright: authenticated user navigates to `/account` → both tabs render with the seeded e2e data.
- [ ] Playwright: from Collaborators tab, "Add to workspace…" successfully invites the collaborator into the chosen workspace and the row updates without a full reload.
- [ ] Playwright: explicit Sign Out clears the dismissed flag — verified by the modal re-appearing on the next anonymous visit.

### Quality
- [ ] No new API endpoint is introduced; all data is fetched via existing routes.
- [ ] The prompt and hub render correctly at the same breakpoints the rest of the web UI supports (no new breakpoint logic).
- [ ] Backdrop click does NOT dismiss the modal — verified by Playwright.
- [ ] Owner-only actions on Account-hub rows are gated client-side AND verified server-side (any attempt that bypasses the UI returns 403 from req 019's auth checks).

## Out of Scope

- Server-side rendering of the modal. It is a client-side component; SEO and no-JS users continue to see the existing anonymous landing.
- Per-collaborator role differences. Collaborators are members; this UI does not create new role tiers — that would belong to a follow-up requirement that extends [019](019-workspace-rbac.md).
- Global user directory beyond "people I share a workspace with". There is no user table by design (req 007); a directory would require persisting users and is rejected here.
- Email-based invitation delivery. The owner is still responsible for telling the invitee out-of-band that they have been invited — same as req [019](019-workspace-rbac.md).
- A separate `GET /api/account/collaborators` endpoint. Client-side aggregation is sufficient for the expected scale; an endpoint can be added later if the page becomes slow.

## Cross-References

- [007 - Optional Login & Persistent Workspaces (OAuth2 Proxy)](007-optional-auth-persistent-workspaces.md) — anonymous-vs-authenticated baseline this requirement makes visible to the user.
- [019 - Workspace RBAC: Owner + Member Memberships](019-workspace-rbac.md) — provides the per-workspace API the hub aggregates.
- [020 - End-to-End OIDC via OAuth2 Proxy + Dummy Provider](020-oidc-e2e-via-dummy-provider.md) — supplies the seeded users and real OIDC flow that the Playwright tests exercise.
