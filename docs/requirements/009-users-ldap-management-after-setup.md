# 009 - Users – LDAP-Based User Management (Post-Setup)

## User Story

As an administrator, I want a "Users" section that becomes available after a successful deployment so that I can create, modify, and delete LDAP users on Keycloak-enabled servers directly from the UI via SSH without direct server access.

## Acceptance Criteria

- [x] A new top-level "Users" navigation item is introduced after the Setup section.
- [x] The Users item appears in the main navigation only when: at least one server is present, at least one server has the role `web-app-keycloak`, and setup has completed successfully.
- [x] The Users section is visible but greyed out (disabled) when no active setup has been completed or SSH connectivity is not verified.
- [x] The Users section is fully enabled only when: deployment completed, SSH connectivity validated, and LDAP service is reachable.
- [x] A tooltip is shown when disabled: "User management requires an active deployed server with Keycloak and LDAP."
- [x] The Users section becomes enabled automatically after a successful deployment.
- [x] The Users section disables automatically when `web-app-keycloak` is removed from the inventory.
- [x] Users are managed via LDAP on servers that include `web-app-keycloak` and `docker-ldap` (or equivalent LDAP backend).
- [x] The system detects eligible servers automatically.
- [x] When multiple eligible servers exist, switching between them is supported.
- [x] The user list is loaded by querying the LDAP directory via SSH and displays: username, firstname, lastname, email, roles/groups, enabled/disabled state.
- [x] The user list loads within 2 seconds.
- [x] No plaintext passwords are ever returned in the user list.
- [x] Creating a user requires: username, firstname, lastname, email, password, roles (multi-select).
- [x] On create: connect via SSH, execute LDAP create operation, apply password securely, assign group memberships.
- [x] Password is never logged or streamed during user creation.
- [x] Duplicate usernames are prevented with clear validation.
- [x] Errors during create are returned and displayed clearly.
- [x] Changing a password requires double-entry confirmation and executes LDAP password modify via SSH.
- [x] Password is never visible in logs during a password change.
- [x] Failure states for password change are clearly reported.
- [x] Roles are derived from LDAP groups; multi-select group assignment updates `memberOf` associations.
- [x] Role changes reflect immediately in LDAP without requiring a UI reload.
- [x] Deleting a user requires a confirmation dialog, removes the LDAP entry, and updates the UI immediately.
- [x] All user operations use SSH to connect to the server and execute LDAP commands locally (ldapadd, ldapmodify, ldapdelete, ldapsearch).
- [x] LDAP context parameters (bind DN, base DN, etc.) are derived from inventory, LDAP config variables, and role defaults.
- [x] No LDAP bind password is ever returned to or visible in the UI.
- [x] No plaintext password is logged for any operation.
- [x] All write operations are CSRF-protected.
- [x] Strict server scoping is enforced; no cross-server data leakage is possible.
- [x] `GET /api/users?server_id=...` is implemented.
- [x] `POST /api/users` is implemented.
- [x] `PUT /api/users/{username}/password` is implemented.
- [x] `PUT /api/users/{username}/roles` is implemented.
- [x] `DELETE /api/users/{username}` is implemented.
- [x] All endpoints validate server eligibility, verify SSH connectivity, and mask sensitive data.
- [x] ZIP export/import does not include user credentials.
- [x] The Users section is fully compatible with the current inventory structure.
- [x] Playwright test: Users section is disabled before setup.
- [x] Playwright test: Users section is enabled after successful deployment.
- [x] Playwright test: Create user flow works (mocked SSH/LDAP).
- [x] Playwright test: Password change does not expose the password in the DOM.
- [x] Playwright test: Delete requires confirmation.
- [x] Playwright test: Role assignment updates UI state.
