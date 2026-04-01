# Store – Layout, Filters, View Modes

## Goal

Refine the Store layout so controls are compact and consistent, pagination is fixed at the bottom, and view modes are icon-driven with clear behavior for mini/list/detail.

---

## 1. Pagination + Scroll Area

* [x] Pagination must be **fixed at the bottom** of the Store section, **outside** the scroll area.
* [x] The apps grid scrolls above it and uses the **full available width**.
* [x] Target grid density: **4 columns** when space allows.
* [x] Logos must **never overflow** their card boundaries.

**Acceptance Criteria**

* [x] Pagination stays visible and fixed while the grid scrolls.
* [x] App cards fill the full Store width (no narrow column constraint).
* [x] No logo overlaps or overflows card edges.

---

## 2. Top Control Row Layout

* [x] Top control row must be **fixed/sticky** while the apps grid scrolls.
* [x] **Left**: Search input.
* [x] **Next to search**: view mode toggles shown **only as favicon icons** (detail/list/mini).
* [x] **Right**: View dropdown (includes Rows selector) and a **Filters dropdown** (deploy target, status, selection).

**Acceptance Criteria**

* [x] Search is left-aligned; view toggles sit immediately to its right.
* [x] View dropdown is right-aligned and contains Rows selection.
* [x] All filter options are in a right-side dropdown (no full-width filter bar).

---

## 3. View Modes Behavior

* [x] **Mini**: show **only the logo** in the tile.
  * [x] On hover, show role info (name, status, targets, description) via tooltip/popover.
* [x] **List**: display **all information** in a **table-like** layout (rows + columns).
* [x] **Detail**: keep current card-style layout with full content.
* [x] Icon fallback order:
  * [x] Prefer **SimpleIcons** derived from the role title.
  * [x] Else use **Font Awesome** icon from `meta/main.yml`.
  * [x] Else show the **default initials icon** with higher-contrast styling.

**Acceptance Criteria**

* [x] Mini view shows only the logo until hover reveals details.
* [x] List view reads like a table with aligned columns.
* [x] Detail view keeps rich card layout.

---

## 4. Responsive Sizing Rules

* [x] Auto-calculate rows to fill the available height.
* [x] Column count must consider **icon width** to avoid overflow (applies to mini/detail/list).

**Acceptance Criteria**

* [x] Row/column calculations adapt to the selected view and container size.
* [x] No card overflows its grid cell.
