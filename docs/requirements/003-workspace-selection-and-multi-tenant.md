# 003 - Workspace Selection & Multi-Tenant Workspaces

## User Story

As a user, I want to manage multiple isolated workspaces and select them via URL so that I can keep separate inventories for different projects while logged-in users get a persistent workspace overview.

## Acceptance Criteria

- [x] A user can have multiple workspaces.
- [x] Each workspace has exactly one inventory.
- [x] Each inventory can manage multiple servers.
- [x] Workspaces and inventories are strictly scoped (no cross-workspace leakage).
- [x] Inventory operations affect only the selected workspace.
- [x] Selecting a workspace via URL (e.g. route or query parameter) is supported.
- [x] Navigating directly to a workspace URL loads that workspace context.
- [x] An unknown or invalid workspace identifier in the URL shows a clear error or fallback.
- [x] Non-logged-in users see the default interface (current behaviour unchanged).
- [x] No workspace switching or user-specific data is visible to logged-out users.
- [x] Logged-out users can use the app without workspace selection.
- [x] No user workspace data is exposed when not authenticated.
- [x] Logged-in users see a workspace overview on the start page.
- [x] The workspace overview lists all workspaces and allows selecting one.
- [x] Selecting a workspace from the overview routes the user to that workspace context.
- [x] In the header, below the right logo, the current workspace is shown with a dropdown of all user workspaces.
- [x] The workspace dropdown allows switching workspaces.
- [x] When logged out, nothing is shown in the workspace header slot.
- [x] The start page content changes based on authentication state.
- [x] The workspace dropdown appears only for authenticated users.
