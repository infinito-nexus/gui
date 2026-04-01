# Workspace Selection & Multi-Tenant Workspaces

## Goal

Allow selecting workspaces via URL, support multiple workspaces per user, and clearly separate inventories per workspace. Logged-out users see the default interface, while logged-in users see a workspace overview on the start page.

---

## 1. Core Model

* [x] A user can have **multiple workspaces**.
* [x] Each workspace has **exactly one inventory**.
* [x] Each inventory can manage **multiple servers**.

**Acceptance Criteria**

* [x] Workspaces and inventories are strictly scoped (no cross-workspace leakage).
* [x] Inventory operations affect only the selected workspace.

---

## 2. URL-Based Workspace Selection

* [x] Support selecting a workspace via URL (e.g., route or query).
* [x] Unknown/invalid workspace in URL should show a clear error or fallback.

**Acceptance Criteria**

* [x] Navigating directly to a workspace URL loads that workspace context.
* [x] Invalid workspace identifiers are handled gracefully.

---

## 3. Logged-Out Behavior

* [x] Non‑logged users see the **default interface** (current behavior).
* [x] No workspace switching or user-specific data should be visible.

**Acceptance Criteria**

* [x] Logged-out users can use the app without workspace selection.
* [x] No user workspace data is exposed when not authenticated.

---

## 4. Logged-In Start Page

* [x] Logged‑in users see a **workspace overview** on the start page.
* [x] Overview lists all workspaces and allows selecting one.
* [x] In the header, **below the right logo**, show the **current workspace** with a dropdown of all user workspaces.
  * [x] Dropdown allows switching workspaces.
  * [x] When logged out, **nothing is shown** in that spot.

**Acceptance Criteria**

* [x] Start page changes based on auth state.
* [x] User can select a workspace from the overview and is routed accordingly.
* [x] Workspace dropdown appears only for authenticated users and switches context.
