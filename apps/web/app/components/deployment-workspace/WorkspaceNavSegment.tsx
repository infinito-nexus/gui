"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../deployment/workspace/Main.module.css";
import { WORKSPACE_STORAGE_KEY } from "../workspace-panel/utils";

type WorkspaceListEntry = {
  workspace_id: string;
  name: string;
};

type WorkspaceAction = "history" | "export" | "import" | "cleanup" | "delete";

const CSRF_COOKIE = "csrf";
const CURRENT_NAME_KEY = `${WORKSPACE_STORAGE_KEY}.name`;
const PENDING_ACTION_KEY = "infinito.pending-workspace-action";

function apiBase(): string {
  if (typeof process !== "undefined" && process?.env?.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  return "";
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

/**
 * Prime the `csrf` cookie + return its current value.
 *
 * The app's inline bootstrap (apps/web/app/layout.tsx) usually
 * injects the X-CSRF header automatically, but priming explicitly
 * here lets the create flow work even when the user clicks Create
 * before the bootstrap's first GET has primed the cookie.
 */
async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  try {
    await fetch(`${apiBase()}/api/workspaces`, {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    // ignore; second cookie read will simply return "".
  }
  return readCookie(CSRF_COOKIE);
}

type WorkspaceListResponse = {
  authenticated: boolean;
  workspaces: WorkspaceListEntry[];
};

async function listWorkspaces(): Promise<WorkspaceListResponse> {
  const res = await fetch(`${apiBase()}/api/workspaces`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) {
    return { authenticated: false, workspaces: [] };
  }
  const body = await res.json().catch(() => ({}));
  const raw = Array.isArray(body?.workspaces) ? body.workspaces : [];
  return {
    authenticated: Boolean(body?.authenticated),
    workspaces: raw
      .filter((entry: unknown) => entry && typeof entry === "object")
      .map((entry: Record<string, unknown>) => ({
        workspace_id: String(entry.workspace_id ?? ""),
        name: String(entry.name ?? entry.workspace_id ?? ""),
      }))
      .filter((entry: WorkspaceListEntry) => entry.workspace_id.length > 0),
  };
}

async function exportWorkspaceById(workspaceId: string, label: string): Promise<void> {
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(workspaceId)}/download.zip`,
    {
      method: "GET",
      credentials: "same-origin",
    },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (typeof window === "undefined") return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${label || workspaceId}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function deleteWorkspaceById(workspaceId: string): Promise<void> {
  const csrf = await ensureCsrfToken();
  const headers: Record<string, string> = {};
  if (csrf) headers["X-CSRF"] = csrf;
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers,
    },
  );
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail || "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
}

async function createWorkspace(name: string): Promise<WorkspaceListEntry> {
  const csrf = await ensureCsrfToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (csrf) headers["X-CSRF"] = csrf;
  const res = await fetch(`${apiBase()}/api/workspaces`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail || "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { workspace_id: string; name?: string };
  return {
    workspace_id: data.workspace_id,
    name: data.name || data.workspace_id,
  };
}

function readCurrentId(): string | null {
  if (typeof window === "undefined") return null;
  const value = String(
    window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || "",
  ).trim();
  return value || null;
}

function readCachedName(): string | null {
  if (typeof window === "undefined") return null;
  const value = String(window.localStorage.getItem(CURRENT_NAME_KEY) || "").trim();
  return value || null;
}

function persistCurrent(workspaceId: string, name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
  if (name) {
    window.localStorage.setItem(CURRENT_NAME_KEY, name);
  } else {
    window.localStorage.removeItem(CURRENT_NAME_KEY);
  }
}

function dispatchAction(action: WorkspaceAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("infinito:workspace-action", { detail: { action } }),
  );
}

function dispatchOpenLogin(): void {
  if (typeof window === "undefined") return;
  // Same event the auth toggle in the navRow fires; AccountPanel
  // listens for it and renders its login modal.
  window.dispatchEvent(new Event("infinito:account-open-auth"));
}

export default function WorkspaceNavSegment(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceListEntry[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const reloadList = useCallback(async () => {
    try {
      const result = await listWorkspaces();
      setAuthenticated(result.authenticated);
      setWorkspaces(result.workspaces);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Initial mount: current workspace + list. Also flush any
  // "pending action" that survived a switch+reload cycle so
  // operations on non-current workspaces actually run.
  useEffect(() => {
    setCurrentId(readCurrentId());
    void reloadList();
    if (typeof window !== "undefined") {
      const pending = window.localStorage.getItem(PENDING_ACTION_KEY) || "";
      if (
        pending === "history" ||
        pending === "export" ||
        pending === "import" ||
        pending === "cleanup" ||
        pending === "delete"
      ) {
        window.localStorage.removeItem(PENDING_ACTION_KEY);
        // Defer one tick so the panel that listens for the event
        // (WorkspacePanelCards) is mounted and its useEffect bridge
        // has registered.
        window.setTimeout(() => dispatchAction(pending as WorkspaceAction), 200);
      }
    }
  }, [reloadList]);

  // Outside-click closes the dropdown.
  //
  // Use the `click` event (not `mousedown`) so action buttons inside
  // the portaled hover sub-menu have a chance to fire their own
  // onClick handlers BEFORE the outside-click logic re-renders and
  // unmounts the row. With `mousedown`, the dropdown was closed +
  // submenu unmounted before the button's click event could be
  // dispatched, swallowing every action.
  //
  // The portaled hover submenu is also matched as "inside" via a
  // data attribute so the dropdown stays open while the user
  // interacts with the submenu.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const node = containerRef.current;
      if (node && node.contains(target)) return;
      if (target.closest("[data-workspace-row-menu]")) return;
      setOpen(false);
      setCreating(false);
      setError(null);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  // Pin the user's current workspace (with name) to the segment label
  // even when the API list is empty (anonymous mode) — the cache is
  // written by switchTo / persistCurrent on every transition.
  const currentLabel = useMemo(() => {
    if (!currentId) return "Workspace";
    const match = workspaces.find((w) => w.workspace_id === currentId);
    if (match?.name) return match.name;
    const cached = readCachedName();
    if (cached) return cached;
    return currentId;
  }, [currentId, workspaces]);

  const switchTo = useCallback((entry: WorkspaceListEntry) => {
    persistCurrent(entry.workspace_id, entry.name);
    setCurrentId(entry.workspace_id);
    setOpen(false);
    setCreating(false);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  const onCreateSubmit = useCallback(async () => {
    const name = createName.trim();
    setBusy(true);
    setError(null);
    try {
      const created = await createWorkspace(name);
      switchTo(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [createName, switchTo]);

  const handleAction = useCallback(
    async (workspace: WorkspaceListEntry, action: WorkspaceAction) => {
      setOpen(false);

      // Export goes through the dedicated download endpoint so it
      // works regardless of which tab is mounted.
      if (action === "export") {
        try {
          await exportWorkspaceById(workspace.workspace_id, workspace.name);
        } catch (err) {
          setError(`Failed to export: ${(err as Error).message}`);
        }
        return;
      }

      // Delete bypasses the event bus — this is a pure API call and
      // doesn't need any tab-level UI to be mounted. Confirm with the
      // user, hit DELETE, then either reload (if we deleted the
      // current workspace) or refresh just the dropdown list.
      if (action === "delete") {
        const target = workspace.name || workspace.workspace_id;
        if (typeof window !== "undefined") {
          const confirmed = window.confirm(
            `Delete workspace "${target}"? This cannot be undone.`,
          );
          if (!confirmed) return;
        }
        try {
          await deleteWorkspaceById(workspace.workspace_id);
        } catch (err) {
          setError(`Failed to delete: ${(err as Error).message}`);
          return;
        }
        if (workspace.workspace_id === currentId) {
          // We just deleted the active workspace — clear the cache
          // and reload to a fresh empty state.
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
            window.localStorage.removeItem(CURRENT_NAME_KEY);
            window.location.reload();
          }
          return;
        }
        // Different workspace deleted — just refresh the list.
        await reloadList();
        return;
      }

      if (workspace.workspace_id === currentId) {
        // Already on this workspace — just dispatch.
        dispatchAction(action);
        return;
      }
      // Different workspace: persist intent, switch, let the post-
      // reload mount effect dispatch the action against the now-
      // current workspace.
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PENDING_ACTION_KEY, action);
      }
      switchTo(workspace);
    },
    [currentId, reloadList, switchTo],
  );

  // Build a virtual entry for the current workspace if it's not in
  // the API-returned list (anonymous mode). Without this, anonymous
  // users see an empty list even though they own a workspace.
  const renderedWorkspaces = useMemo<WorkspaceListEntry[]>(() => {
    if (!currentId) return workspaces;
    if (workspaces.some((w) => w.workspace_id === currentId)) return workspaces;
    return [
      {
        workspace_id: currentId,
        name: readCachedName() || currentId,
      },
      ...workspaces,
    ];
  }, [currentId, workspaces]);

  return (
    <div ref={containerRef} className={styles.workspaceSegmentWrap}>
      <button
        type="button"
        className={`${styles.navButton} ${styles.authModeMiddle} ${styles.modeWorkspace}`}
        onClick={() => {
          setOpen((prev) => !prev);
          setCreating(false);
          setError(null);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="workspace-nav-button"
      >
        <i className="fa-solid fa-folder-open" aria-hidden="true" />
        <span className={styles.workspaceSegmentLabel}>{currentLabel}</span>
        <i
          className={`fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div role="menu" className={styles.workspaceSegmentMenu}>
          {creating ? (
            <div className={styles.workspaceSegmentCreate}>
              <input
                type="text"
                className="form-control"
                placeholder="Alias (leave empty for auto)"
                value={createName}
                disabled={busy}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onCreateSubmit();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setError(null);
                  }
                }}
                autoFocus
              />
              <div className={styles.workspaceSegmentCreateActions}>
                <button
                  type="button"
                  className={`${styles.navButton} ${styles.authNavLoggedOut}`}
                  onClick={() => void onCreateSubmit()}
                  disabled={busy}
                >
                  <i className="fa-solid fa-check" aria-hidden="true" />
                  <span>Create</span>
                </button>
                <button
                  type="button"
                  className={styles.navButton}
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.workspaceSegmentCreateTrigger} ${
                !authenticated ? styles.workspaceSegmentCreateTriggerDisabled : ""
              }`}
              onClick={() => {
                if (!authenticated) {
                  setOpen(false);
                  dispatchOpenLogin();
                  return;
                }
                setCreating(true);
                setCreateName("");
                setError(null);
              }}
              title={
                authenticated
                  ? undefined
                  : "Sign in to create new workspaces — click to open login"
              }
              aria-disabled={!authenticated}
              data-testid="workspace-nav-create-button"
            >
              <i className="fa-solid fa-plus" aria-hidden="true" />
              <span>Create</span>
              {!authenticated ? (
                <i
                  className={`fa-solid fa-lock ${styles.workspaceSegmentCreateLock}`}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          )}

          {!authenticated && !creating ? (
            <div className={styles.workspaceSegmentCreateHint}>
              Workspace creation is for signed-in users.{" "}
              <button
                type="button"
                className={styles.workspaceSegmentInlineLink}
                onClick={() => {
                  setOpen(false);
                  dispatchOpenLogin();
                }}
              >
                Sign in
              </button>
              .
            </div>
          ) : null}

          <div className={styles.workspaceSegmentDivider} aria-hidden="true" />

          {renderedWorkspaces.length === 0 ? (
            <div className={styles.workspaceSegmentEmpty}>
              No workspaces yet. Click Create to add the first one.
            </div>
          ) : (
            <ul className={styles.workspaceSegmentList}>
              {renderedWorkspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.workspace_id}
                  workspace={workspace}
                  active={workspace.workspace_id === currentId}
                  onSwitch={() => switchTo(workspace)}
                  onAction={(action) => handleAction(workspace, action)}
                />
              ))}
            </ul>
          )}

          {error ? (
            <div className={`text-danger ${styles.workspaceSegmentError}`}>
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type WorkspaceRowProps = {
  workspace: WorkspaceListEntry;
  active: boolean;
  onSwitch: () => void;
  onAction: (action: WorkspaceAction) => void;
};

type SubmenuButtonProps = {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
  danger?: boolean;
};

function SubmenuButton({
  icon,
  label,
  onClick,
  disabled = false,
  disabledHint,
  danger = false,
}: SubmenuButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.workspaceSegmentItem} ${
        danger ? styles.workspaceSegmentItemDanger : ""
      } ${disabled ? styles.workspaceSegmentItemDisabled : ""}`}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      aria-disabled={disabled}
      title={disabled ? disabledHint : undefined}
    >
      <i className={`fa-solid ${icon}`} aria-hidden="true" />
      <span className={styles.workspaceSegmentItemLabel}>{label}</span>
    </button>
  );
}

type SubmenuPlacement =
  | { placement: "down"; top: number; left: number }
  | { placement: "up"; bottom: number; left: number };

function WorkspaceRow({
  workspace,
  active,
  onSwitch,
  onAction,
}: WorkspaceRowProps) {
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<SubmenuPlacement | null>(null);
  const rowRef = useRef<HTMLLIElement | null>(null);

  // Recompute the submenu position whenever hover starts. Using
  // viewport-fixed coordinates lets the menu render via portal at
  // document.body level so no ancestor `overflow` clips it.
  //
  // The submenu opens upward (anchored to the row's bottom) when
  // there is more space above the row than below — typical for the
  // navRow placement at the bottom of the viewport.
  const recomputeCoords = useCallback(() => {
    const node = rowRef.current;
    if (!node || typeof window === "undefined") return;
    const rect = node.getBoundingClientRect();
    const spaceAbove = rect.bottom;
    const spaceBelow = window.innerHeight - rect.top;
    if (spaceAbove > spaceBelow) {
      setCoords({
        placement: "up",
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 6,
      });
    } else {
      setCoords({
        placement: "down",
        top: rect.top,
        left: rect.right + 6,
      });
    }
  }, []);

  // Debounce close: gives the user time to slide the cursor across
  // the small gap between the row and the portaled submenu without
  // the hover state flipping back to false in between.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    cancelClose();
    recomputeCoords();
    setHovered(true);
  }, [cancelClose, recomputeCoords]);

  const handleLeave = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setHovered(false);
      closeTimerRef.current = null;
    }, 180);
  }, [cancelClose]);

  // Component-unmount cleanup so a pending close doesn't fire after
  // the row has been removed.
  useEffect(() => () => cancelClose(), [cancelClose]);

  // Reposition on window resize / scroll while open so the submenu
  // tracks its anchor row.
  useEffect(() => {
    if (!hovered) return;
    const onScroll = () => recomputeCoords();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [hovered, recomputeCoords]);

  const submenu =
    hovered && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.workspaceSegmentRowMenu}
            role="menu"
            data-workspace-row-menu
            style={
              coords.placement === "up"
                ? { bottom: coords.bottom, left: coords.left }
                : { top: coords.top, left: coords.left }
            }
            onMouseEnter={() => {
              cancelClose();
              setHovered(true);
            }}
            onMouseLeave={handleLeave}
          >
            <SubmenuButton
              icon="fa-clock"
              label="History"
              onClick={() => onAction("history")}
            />
            <SubmenuButton
              icon="fa-file-arrow-down"
              label="Export"
              onClick={() => onAction("export")}
            />
            <SubmenuButton
              icon="fa-file-arrow-up"
              label="Import"
              onClick={() => onAction("import")}
            />
            <SubmenuButton
              icon="fa-broom"
              label="Cleanup"
              onClick={() => onAction("cleanup")}
            />
            <div className={styles.workspaceSegmentDivider} aria-hidden="true" />
            <SubmenuButton
              icon="fa-trash"
              label="Delete workspace"
              onClick={() => onAction("delete")}
              danger
              disabled={active}
              disabledHint={
                active
                  ? "Switch to another workspace before deleting this one"
                  : undefined
              }
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <li
      ref={rowRef}
      className={styles.workspaceSegmentRow}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        type="button"
        className={`${styles.workspaceSegmentItem} ${
          active ? styles.workspaceSegmentItemActive : ""
        }`}
        onClick={onSwitch}
      >
        <i
          className={`fa-solid ${
            active ? "fa-check" : "fa-arrow-right-arrow-left"
          }`}
          aria-hidden="true"
        />
        <span className={styles.workspaceSegmentItemLabel}>{workspace.name}</span>
      </button>
      {submenu}
    </li>
  );
}
