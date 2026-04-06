# 007 - Optional Login & Persistent Workspaces (OAuth2 Proxy)

## User Story

As an authenticated user, I want my workspaces to persist across sessions via OAuth2 Proxy so that I can continue previous work after logging in again, while the system continues to work fully anonymously when authentication is disabled.

## Acceptance Criteria

- [x] Login via OAuth2 Proxy is optional; the application works fully anonymously when authentication is disabled.
- [x] OAuth2 Proxy runs in front of the Web UI and API.
- [x] Authentication is handled externally (OIDC, SSO, IdP); the backend never implements its own auth logic.
- [x] Enabling OAuth2 Proxy does not break or change anonymous mode.
- [x] No login is required for basic usage.
- [x] When authenticated, the backend extracts the user identity from the `X-Auth-Request-User` header (and optionally `X-Auth-Request-Email`).
- [x] User identity is treated as an opaque string: no format assumptions, no authorization logic beyond workspace ownership.
- [x] The backend trusts these headers only when OAuth2 Proxy is enabled.
- [x] User identity is never user-controlled input.
- [x] Authenticated users have persistent workspaces bound to their user ID that survive browser reloads and session restarts.
- [x] Anonymous users continue to use ephemeral, session-bound workspaces.
- [x] Authenticated users can return and continue previous work.
- [x] Anonymous users do not see or access old workspaces.
- [x] When authenticated, a "My Workspaces" section is shown in the UI.
- [x] The workspace list shows: ID/name, last modified timestamp, current state (draft / deployed / finished).
- [x] Users can load a workspace, which restores inventory files, vars, and UI state (selected roles, step).
- [x] Users can delete a workspace (with confirmation dialog), which fully removes all server-side data.
- [x] Workspace states are: draft, deployed, finished.
- [x] Deployments reference a workspace but do not own it.
- [x] Finished deployments do NOT auto-delete workspaces; users can redeploy from the same workspace.
- [x] Deploy history is preserved independently of workspace lifecycle.
- [x] Users can only access their own workspaces; no workspace ID guessing is possible.
- [x] Workspace paths are never user-controlled.
- [x] Cross-user workspace access is impossible.
- [x] Authenticated users cannot access anonymous workspaces and vice versa.
- [x] `GET /api/workspaces` returns only workspaces of the authenticated user.
- [x] When unauthenticated, the workspace listing endpoint returns empty or 401 (configurable).
- [x] Existing workspace APIs remain unchanged for anonymous flows.
- [x] The UI can fully manage workspaces via the API with no breaking changes to existing flows.
- [x] Playwright test (anonymous mode): no workspace list is shown; workspace is lost on reload.
- [x] Playwright test (authenticated mode): workspace list renders; loading restores files and UI state; deleting removes the workspace from the list.
- [x] Tests cover both anonymous and authenticated flows.
- [x] No real OAuth provider is used in tests (headers are mocked).
