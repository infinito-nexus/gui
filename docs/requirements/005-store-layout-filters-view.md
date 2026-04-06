# 005 - Store Layout, Filters, View Modes

## User Story

As a user, I want a refined store layout with fixed pagination, a compact sticky control row, and icon-driven view modes (Mini / List / Detail) so that I can browse and filter apps efficiently at any screen size.

## Acceptance Criteria

- [x] Pagination is fixed at the bottom of the Store section, outside the scroll area.
- [x] The apps grid scrolls above the fixed pagination and uses the full available Store width.
- [x] Target grid density is 4 columns when space allows.
- [x] App logos never overflow their card boundaries.
- [x] Pagination stays visible and fixed while the grid scrolls.
- [x] App cards fill the full Store width (no narrow column constraint).
- [x] No logo overlaps or overflows card edges.
- [x] The top control row is fixed/sticky while the apps grid scrolls.
- [x] Left of the top control row: search input.
- [x] Immediately to the right of the search: view mode toggles shown only as favicon icons (detail / list / mini).
- [x] Right of the top control row: a View dropdown that includes a Rows selector.
- [x] Right of the top control row: a Filters dropdown (deploy target, status, selection) — no full-width filter bar.
- [x] Search is left-aligned; view toggles sit immediately to its right.
- [x] View dropdown is right-aligned.
- [x] All filter options are in the right-side Filters dropdown.
- [x] **Mini view**: only the logo is shown in the tile.
- [x] **Mini view**: hovering reveals role info (name, status, targets, description) via tooltip or popover.
- [x] **List view**: all information is displayed in a table-like layout (rows + columns).
- [x] **Detail view**: current card-style layout with full content is preserved.
- [x] Icon fallback order: (1) SimpleIcons derived from the role title; (2) Font Awesome icon from `meta/main.yml`; (3) default initials icon with higher-contrast styling.
- [x] Mini view shows only the logo until hover reveals details.
- [x] List view reads like a table with aligned columns.
- [x] Detail view keeps rich card layout.
- [x] Row count is auto-calculated to fill the available height.
- [x] Column count considers icon width to avoid overflow in all view modes.
- [x] Row/column calculations adapt to the selected view and container size.
- [x] No card overflows its grid cell.
