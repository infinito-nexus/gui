# 002 - Server Switcher & Server List Layout

## User Story

As a user, I want to switch between servers from the top navigation and browse servers in a store-like layout so that I can manage multiple servers efficiently without leaving the current view.

## Acceptance Criteria

- [x] Server cards/rows no longer show an "active" button.
- [x] Under the logo in the top navigation, the current server is shown as an active button.
- [x] Clicking the active-server button opens a dropdown.
- [x] The dropdown lists all servers plus a "New" option.
- [x] Selecting a server from the dropdown switches the active server.
- [x] Selecting "New" opens the Server tab and creates a new server.
- [x] In the Server tab, the currently active server is always marked green.
- [x] Exactly one server is highlighted as active (green) at any time.
- [x] The green highlight updates immediately when switching servers via the dropdown.
- [x] Server list pagination is fixed at the bottom, outside the scroll area.
- [x] Top-left of the server block: search field.
- [x] Next to the search field: an Add button.
- [x] Top-right of the server block: view mode selection with Selection / Detail / List.
- [x] List view shows servers in a table-like layout (rows + columns with aligned content).
- [x] Search and Add are left-aligned in the top control row.
- [x] View mode selector is right-aligned.
- [x] Pagination stays fixed while the server list scrolls.
