# Deploy – Server Selection & Layout

## Goal

Make the deploy screen show a tabular server selection with clear deployed status, correct `--limit` behavior, and a layout where the server list shares space with the terminal cleanly.

---

## 1. Server Table & Selection Rules

* [x] List **all servers** in a **table-like layout** (rows + columns).
* [x] Servers already **deployed** show a **checkmark** and are **not selectable**.
* [x] Provide **Select All** and **Deselect All** actions (only for selectable servers).

**Acceptance Criteria**

* [x] Server list is tabular with aligned columns.
* [x] Deployed servers are visibly marked and cannot be selected.
* [x] Select All / Deselect All operate on selectable servers only.

---

## 2. `--limit` Behavior

* [x] If **all selectable servers** are selected, **do not** pass `--limit`.
* [x] Otherwise, pass the **selected server aliases** via `--limit`.
* [x] Deployment should **run the inventory** directly (no extra selection UI needed).

**Acceptance Criteria**

* [x] `--limit` is omitted when all selectable servers are selected.
* [x] `--limit` receives the correct server aliases when not all are selected.

---

## 3. Deploy Screen Cleanup & Button Order

* [x] Remove the labels **"Selected roles: none"** and **"Active server: main"**.
* [x] **Start deployment** button appears **before** **Connect** and **Cancel**.

**Acceptance Criteria**

* [x] Removed labels are no longer visible.
* [x] Button order is Start deployment, then Connect, then Cancel.

---

## 4. Layout: Server List + Terminal

* [x] Server list lives in an **auto-scroll container**.
* [x] Server list uses **max 50%** of the available tab height.
* [x] Terminal uses **all remaining space**.
* [x] When the server list is **minimized/collapsed**, terminal expands to fill the rest.
* [x] Terminal corners are **square** (no rounding).

**Acceptance Criteria**

* [x] Server list never exceeds half of the free tab height.
* [x] Terminal always fills the remaining space and expands when the list is minimized.
* [x] Terminal has no rounded corners.
