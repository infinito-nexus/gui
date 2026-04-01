# Server Switcher & Server List Layout

## Goal

Move the active-server control into the top navigation, add a server switcher dropdown with "New", and align the server list layout with the Store layout (fixed pagination, top controls, view modes).

---

## 1. Remove Active Button From Server Cards

* [x] Remove the **"active" button** from server cards/rows.

**Acceptance Criteria**

* [x] Server cards/rows no longer show an "active" button.

---

## 2. Top Navigation Server Switcher

* [x] **Under the logo in the top navigation**, show the **current server** as an **active button**.
* [x] Clicking the button opens a **dropdown**.
* [x] Dropdown lists **all servers** plus a **"New"** option.
* [x] Clicking **"New"** opens the **Server tab** and **creates a new server**.

**Acceptance Criteria**

* [x] Current server is visible in the top nav as an active button.
* [x] Dropdown contains all servers and a "New" entry.
* [x] Selecting a server switches the active server.
* [x] Selecting "New" opens the Server tab and creates a new server.

---

## 3. Active Server Highlight In Server Tab

* [x] In the Server tab, the **currently active server** is **always marked green**.

**Acceptance Criteria**

* [x] Exactly one server is highlighted as active (green).
* [x] Highlight updates immediately when switching servers.

---

## 4. Server Block Layout (Like Store)

* [x] Server block uses **fixed pagination at the bottom**, outside the scroll area.
* [x] **Top-left**: search field.
* [x] **Next to search**: **Add** button.
* [x] **Top-right**: view mode selection with **Selection / Detail / List**.
* [x] **List view** shows servers in a **table-like layout** (rows + columns).

**Acceptance Criteria**

* [x] Pagination stays fixed while the server list scrolls.
* [x] Search and Add are left-aligned in the top control row.
* [x] View mode selector is right-aligned and includes Selection/Detail/List.
* [x] List view renders servers in a table-like layout with aligned columns.
