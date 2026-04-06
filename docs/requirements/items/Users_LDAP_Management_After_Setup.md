# Users – LDAP-Based User Management (Post-Setup Requirement)

## Goal

Introduce a new top-level section **“Users”** that appears **after Setup** and allows managing users on servers that include the **Keycloak role**, via LDAP (OpenLDAP backend).

User management includes:

* Creating users
* Changing passwords
* Assigning roles
* Deleting users

All operations are executed remotely via:

* SSH connection to the server
* LDAP operations against the configured OpenLDAP directory

This section is only available **after a successful setup/deployment**, because it requires:

* An active server
* Running LDAP service
* Valid SSH connectivity
* Correct inventory state

---

# 1. UI Integration

## 1.1 Navigation Placement

After the **Setup** section, introduce a new item:

* Users

It appears in the main navigation only if:

* At least one server is present
* AND at least one server has the role `web-app-keycloak`
* AND setup has completed successfully

---

## 1.2 Activation State

The **Users** section MUST be:

* Visible but **greyed out (disabled)** if:

  * No active setup has been completed
  * OR no SSH connectivity is verified
* Fully enabled only if:

  * Deployment completed
  * SSH connectivity validated
  * LDAP service reachable

Tooltip when disabled:

> “User management requires an active deployed server with Keycloak and LDAP.”

**Acceptance Criteria**

* Users section is disabled before setup.
* It becomes enabled automatically after successful deployment.
* UI clearly indicates why it is disabled.

---

# 2. Scope of Management

Users are managed via LDAP on servers that:

* Include the `web-app-keycloak` role
* Include or depend on `docker-ldap` or equivalent LDAP backend

The system MUST:

* Detect eligible servers automatically
* Allow switching between servers if multiple exist

---

# 3. Functional Capabilities

## 3.1 List Users

* Query LDAP directory
* Display:

  * username
  * firstname
  * lastname
  * email
  * roles/groups
  * enabled/disabled state

**Acceptance Criteria**

* List loads within <2 seconds
* No plaintext passwords are ever returned

---

## 3.2 Create User

Fields:

* username
* firstname
* lastname
* email
* password
* roles (multi-select)

On submit:

* Connect via SSH
* Execute LDAP create operation
* Apply password securely
* Assign group memberships

**Acceptance Criteria**

* Password never logged or streamed
* Validation prevents duplicate usernames
* Errors returned clearly

---

## 3.3 Change Password

* Requires explicit confirmation
* Double-entry password input
* Executes LDAP password modify

**Acceptance Criteria**

* Password never visible in logs
* Operation requires SSH connectivity
* Failure states clearly reported

---

## 3.4 Assign / Modify Roles

* Roles derived from LDAP groups
* Multi-select group assignment
* Updates `memberOf` associations

**Acceptance Criteria**

* Role changes reflect immediately in LDAP
* No UI reload required to see update

---

## 3.5 Delete User

* Confirmation dialog required
* Removes LDAP entry
* Optionally:

  * Preserve home directory (configurable future feature)

**Acceptance Criteria**

* Deletion irreversible
* UI updates immediately after success

---

# 4. Technical Execution Model

All user actions MUST:

1. Use SSH to connect to server
2. Execute LDAP commands locally
3. Never expose LDAP credentials in UI or logs

Possible execution pattern:

* ldapadd
* ldapmodify
* ldapdelete
* ldapsearch

LDAP context parameters derived from:

* Inventory
* LDAP configuration variables
* Role defaults

---

# 5. Security Requirements

* No LDAP bind password ever returned to UI
* No plaintext password logged
* All actions require:

  * Active SSH connectivity
  * Valid credentials
* CSRF protection required for all write operations
* Strict server scoping (no cross-server leakage)

---

# 6. Inventory & Role Dependency

The Users section MUST only activate if:

* `web-app-keycloak` exists in applications
* LDAP backend is present or dependency resolved

If Keycloak removed from inventory:

* Users section automatically disabled

---

# 7. Backend API

Endpoints:

* GET /api/users?server_id=...
* POST /api/users
* PUT /api/users/{username}/password
* PUT /api/users/{username}/roles
* DELETE /api/users/{username}

All endpoints:

* Validate server eligibility
* Verify SSH connectivity
* Mask sensitive data

---

# 8. UI Tests (Playwright – Required)

* Users section disabled before setup
* Enabled after successful deployment
* Create user flow works (mocked)
* Password change does not expose password in DOM
* Delete requires confirmation
* Role assignment updates UI state

---

# 9. Acceptance Criteria (Global)

* Users item appears only when valid
* Disabled state clearly explained
* No LDAP secrets leaked
* Works across multiple eligible servers
* ZIP export/import does not include user credentials
* Fully compatible with current inventory structure

---

# Status

🟩 Done
