# Inventory – History (Git), Autosave & Unsaved Changes Guard

## Redefined

This item is redefined from prose-only specification to an executable checklist.

Status legend:

- `[x]` implemented
- `[ ]` open

Execution order:

1. Git foundation
2. Autosave + deterministic commits
3. History API + UI
4. Restore + unsaved changes guard
5. Hardening + tests

---

## 0. Current Baseline

- [x] Workspace file CRUD exists (`list/read/write/rename/delete`)
- [x] Manual file save exists in editor
- [x] Workspace-local Git repository per workspace
- [x] History API endpoints
- [x] History UI entry points (Inventory + Workspace menu)
- [x] File/folder scoped history in context menu
- [x] Diff + restore workflow
- [x] Unsaved changes leave guard
- [x] Playwright coverage for this feature set

---

## 1. Git Foundation (MVP)

- [x] Initialize `.git` in workspace root on first write/autosave
- [x] Add deterministic `.gitignore` rules for non-versioned runtime files
- [x] Track reproducibility-relevant files (`inventory.yml`, `host_vars/**`, `group_vars/**`, workspace config)
- [x] Enforce workspace isolation for all git operations
- [x] Ensure `git status` is clean immediately after each successful commit

Acceptance:

- [x] First autosave initializes git repository
- [x] No cross-workspace git access

---

## 2. Autosave & Commit Model (MVP)

- [x] Editor autosave debounce (800-1500ms idle)
- [x] Explicit Save triggers immediate flush + commit
- [x] Non-editor operations commit immediately (create/rename/delete)
- [x] ZIP upload creates exactly one bulk commit
- [x] Inventory generation creates exactly one bulk commit
- [x] Credential generation creates exactly one bulk commit

Deterministic commit messages:

- [x] `edit: <path>`
- [x] `create: <path>`
- [x] `delete: <path>`
- [x] `rename: <from> -> <to>`
- [x] `bulk: zip import`
- [x] `context: <action>`

Optional metadata:

- [x] `server=<id>`
- [x] `role=<id>`

Acceptance:

- [x] No commit spam during typing
- [x] One logical user action equals one logical commit

---

## 3. Backend History API (MVP)

- [x] `GET /api/workspaces/{id}/history`
- [x] `GET /api/workspaces/{id}/history/{sha}`
- [x] `GET /api/workspaces/{id}/history/{sha}/diff`
- [x] `POST /api/workspaces/{id}/history/{sha}/restore`
- [x] `POST /api/workspaces/{id}/history/{sha}/restore-file`

Rules:

- [x] Invalid SHA returns clear 4xx error
- [x] Restore operations are atomic
- [x] Workspace isolation enforced for all endpoints

---

## 4. History UI (MVP)

Global entry points:

- [x] Inventory bottom menu includes `History`
- [x] Workspace menu includes `History`
- [x] Both open the same history component/state

History modal/panel:

- [x] Commit list
- [x] Commit detail
- [x] Diff preview
- [x] Restore actions

Context menu:

- [x] File: `History`
- [x] File: `Diff vs current`
- [x] File: `Restore this`
- [x] Folder: `History` (recursive)
- [x] Folder: `Diff vs current` (recursive)
- [x] Folder: `Restore this` (recursive)

---

## 5. Diff & Restore Hardening

- [x] Unified diff preview
- [x] File-level change list
- [x] Secret masking in diffs (same masking rules as logs)
- [x] Restore entire workspace at commit
- [x] Restore single file from commit
- [x] Refresh file tree and editor after restore
- [x] Run YAML/JSON validation after restore
- [x] Report invalid state explicitly (no silent corruption)

---

## 6. Unsaved Changes Guard

State tracking:

- [x] Dirty state tracked
- [x] Saving-in-progress tracked
- [x] Backend save acknowledgement tracked

Behavior:

- [x] `beforeunload` prompt when unsaved changes exist
- [x] No prompt when clean
- [x] Internal route-change guard with modal
- [x] Modal action `Save and leave`
- [x] Modal action `Cancel`
- [x] `Save and leave` flushes all pending debounced writes before leaving

---

## 7. Security

- [x] No plaintext secrets in git history
- [x] Diff output masks sensitive values
- [x] Restore flow cannot bypass validation
- [x] No cross-workspace history access

---

## 8. Performance

- [x] Commit path remains lightweight under normal editing
- [x] History list warm-load target: <1s
- [x] Folder history queries are efficient on larger workspaces
- [x] UI remains responsive during autosave/commit

---

## 9. Tests (Required)

Playwright:

- [x] History button visible (Inventory + Workspace menu)
- [x] Editing file creates debounced commit
- [x] File context history filter works
- [x] Folder context recursive history works
- [x] Diff modal shows masked output
- [x] Restore updates workspace state
- [x] Unsaved changes guard triggers correctly
- [x] Save-and-leave flushes pending changes

Backend/unit:

- [x] Invalid SHA handling
- [x] Restore atomicity
- [x] Workspace isolation
- [x] Secret masking behavior

CI acceptance:

- [ ] Tests pass headless in CI
- [x] No real secrets used in fixtures

---

## Status

- Overall: 🟩 Implemented
- Completion: 98% (CI headless run pending)
