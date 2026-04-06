# 006 - Deploy Server Selection & Layout

## User Story

As a user, I want to select target servers for deployment in a clear tabular layout so that I can control which servers are targeted, see their deployed status, and have the terminal use all remaining space.

## Acceptance Criteria

- [x] All servers are listed in a table-like layout (rows + columns) on the deploy screen.
- [x] Servers that are already deployed show a checkmark and are not selectable.
- [x] Select All and Deselect All actions are available and operate only on selectable servers.
- [x] Server list is tabular with aligned columns.
- [x] Deployed servers are visibly marked and cannot be selected.
- [x] Select All / Deselect All operate on selectable servers only.
- [x] If all selectable servers are selected, `--limit` is not passed to the deployment command.
- [x] If not all selectable servers are selected, the selected server aliases are passed via `--limit`.
- [x] Deployment runs the inventory directly; no extra selection UI is required.
- [x] `--limit` is omitted when all selectable servers are selected.
- [x] `--limit` receives the correct server aliases when not all are selected.
- [x] The labels "Selected roles: none" and "Active server: main" are removed from the deploy screen.
- [x] The Start deployment button appears before Connect and Cancel.
- [x] Removed labels are no longer visible.
- [x] Button order is: Start deployment, then Connect, then Cancel.
- [x] The server list lives in an auto-scroll container.
- [x] The server list uses a maximum of 50% of the available tab height.
- [x] The terminal uses all remaining space below the server list.
- [x] When the server list is minimized or collapsed, the terminal expands to fill the full remaining area.
- [x] The terminal has square corners (no rounding).
- [x] Server list never exceeds half of the free tab height.
- [x] Terminal always fills the remaining space and expands when the list is minimized.
- [x] Terminal has no rounded corners.
