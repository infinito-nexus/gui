# Workspace Audit Logging - Database Storage, Retention & Export

## Goal
- [ ] All API audit events are written to a database (not to workspace files) with workspace/user attribution, retention rules, and export support.

## 1. Storage Model

### 1.1 Source of Truth
- [ ] Audit logs are persisted in a dedicated database table/collection.
- [ ] Audit records are append-only.
- [ ] Storage is tenant/workspace-scoped (`workspace_id` required).
- [ ] Audit logs are not stored in `inventory.yml`, `host_vars`, or `group_vars`.
- [ ] Audit logs are not stored as workspace `logs/` files by default.

### 1.2 Git & Workspace Integration
- [ ] Audit records are not committed to workspace Git history.
- [ ] Workspace autosave/history commits do not include audit records.
- [ ] Workspace ZIP export excludes audit records by default.

### Acceptance Criteria
- [ ] API actions are queryable from DB without reading workspace files.
- [ ] No audit-log artifacts are required in workspace file tree.
- [ ] No `git -> log -> git` recursion can occur.

## 2. What Must Be Logged
- [ ] Every backend API request creates exactly one audit event.
- [ ] Each event includes UTC ISO timestamp.
- [ ] Each event includes `workspace_id` when request is workspace-scoped.
- [ ] Each event includes HTTP method and path.
- [ ] Each event includes HTTP status code.
- [ ] Each event includes duration in ms.
- [ ] Each event includes actor identity:
  - [ ] `anonymous`
  - [ ] authenticated username/user_id from trusted header
- [ ] Each event includes client IP when available.
- [ ] Optional request/correlation ID is supported.
- [ ] Optional user-agent is supported.

### Sensitive Content Rules
- [ ] Plaintext secrets are never written to audit records.
- [ ] Vault passwords are never written to audit records.
- [ ] Sensitive fields are masked using existing masking rules.

### Acceptance Criteria
- [ ] One structured audit event exists per API action.
- [ ] No plaintext secrets appear in persisted audit data.

## 3. Audit Event Format
- [ ] Event payload is structured JSON.
- [ ] JSON is UTF-8 encoded.
- [ ] No ANSI formatting is stored.

### Example Event
```json
{
  "timestamp": "2026-02-24T18:22:33Z",
  "workspace_id": "abc123",
  "user": "anonymous",
  "method": "POST",
  "path": "/api/workspaces/abc123/files",
  "status": 200,
  "duration_ms": 42,
  "request_id": "3ed0f4ec-8f3d-44a5-b9d4-e2fb58fd3dc7"
}
```

## 4. Retention & Cleanup
- [ ] Retention period is configurable.
- [ ] Default retention is 6 months.
- [ ] Events older than retention are deleted automatically.
- [ ] Cleanup runs as scheduled/background task.
- [ ] Cleanup is workspace-safe and deterministic.

### Acceptance Criteria
- [ ] Expired events are removed automatically.
- [ ] Active requests are not blocked by cleanup.

## 5. Configurable Logging Policy
- [ ] Logging configuration is stored per workspace in DB.
- [ ] Config updates apply immediately.
- [ ] Policy supports enabling/disabling categories.

### 5.1 API Filter Configuration
- [ ] Default mode logs all API calls.
- [ ] Filter mode can log only write operations.
- [ ] Filter mode can log only authentication events.
- [ ] Filter mode can log only deployment events.
- [ ] Filter mode can log only error responses (>=400).
- [ ] Specific endpoints (for example health checks) can be excluded.
- [ ] Filtering is deterministic and workspace-scoped.

### Acceptance Criteria
- [ ] Config is persisted per workspace.
- [ ] Health endpoints can be excluded.

## 6. Backend API
- [ ] `GET /api/workspaces/{id}/logs/config`
- [ ] `PUT /api/workspaces/{id}/logs/config`
- [ ] `GET /api/workspaces/{id}/logs/entries`
- [ ] `GET /api/workspaces/{id}/logs/entries/export`

### Rules
- [ ] Config updates are validated.
- [ ] Entry listing supports pagination and filters (`from`, `to`, `user`, `ip`, `q` search string, status, method).
- [ ] Export supports at least JSONL and CSV.
- [ ] Export can return ZIP for large datasets.
- [ ] Export endpoint supports the same filters (`from`, `to`, `user`, `ip`, `q`) as listing.
- [ ] No endpoint exposes audit data from other workspaces.

## 7. UI Behavior

### 7.1 Audit Logs View
- [ ] Audit logs are shown in a dedicated "Audit Logs" view (not as file tree folder).
- [ ] View supports filtering by date range (`from`/`to`), user, IP, search string, status, and category.
- [ ] View supports pagination.
- [ ] View supports export action.
- [ ] Export uses currently selected filters (`from`, `to`, `user`, `ip`, `q`).

### 7.2 Configuration Modal
- [ ] Field: retention duration (days/months).
- [ ] Field: log filters (checkboxes).
- [ ] Actions: Save and Cancel.

### Acceptance Criteria
- [ ] Changes are saved via API.
- [ ] Invalid configurations are rejected with clear errors.

## 8. Security & Privacy
- [ ] No plaintext secrets are ever written.
- [ ] Masking is identical to SSE masking behavior.
- [ ] Audit records are workspace-scoped.
- [ ] No cross-workspace visibility is possible.
- [ ] Access to audit read/export endpoints is RBAC-protected.

### Acceptance Criteria
- [ ] Secret leakage through audit logging is prevented.
- [ ] Workspace isolation is enforced for read and export.

## 9. Performance Requirements
- [ ] Audit writing is non-blocking.
- [ ] DB writes do not materially delay API responses.
- [ ] Cleanup/export do not block active requests.
- [ ] Background jobs handle heavy cleanup/export work.

## 10. Testing (Required)

### Backend
- [ ] Test: one audit event per API request.
- [ ] Test: masking is verified.
- [ ] Test: retention deletes expired events.
- [ ] Test: filters (`from`, `to`, `user`, `ip`, `q`) return correct subsets.
- [ ] Test: export returns expected format/content.
- [ ] Test: export respects selected filters (`from`, `to`, `user`, `ip`, `q`).
- [ ] Test: workspace isolation is enforced.

### Frontend (Playwright)
- [ ] Test: audit view is visible and loads entries.
- [ ] Test: filters work correctly.
- [ ] Test: export works.
- [ ] Test: export respects active `from`/`to`, user, IP, and search string filters.
- [ ] Test: health endpoint can be excluded via config.

### Acceptance Criteria
- [ ] Tests pass headless in CI.
- [ ] No real secrets are used in tests.

## Status
- [ ] Done
