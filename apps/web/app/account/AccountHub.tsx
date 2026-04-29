"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import MembersPanel from "../components/MembersPanel";
import {
  inviteMember,
  listMembers,
  removeMember,
} from "../lib/members-api";
import { LOGIN_PROMPT_STORAGE_KEY } from "../components/LoginPrompt";
import type {
  WorkspaceListEntry,
  WorkspaceMembers,
} from "../components/workspace-panel/types";

type ApiWorkspace = {
  workspace_id: string;
  name?: string;
  state?: string;
  created_at?: string | null;
  last_modified_at?: string | null;
  role?: "owner" | "member";
};

type WorkspaceList = {
  authenticated: boolean;
  user_id: string | null;
  workspaces: ApiWorkspace[];
};

async function fetchWorkspaces(): Promise<WorkspaceList | null> {
  try {
    const res = await fetch("/api/workspaces", { cache: "no-store" });
    if (res.status === 401) return { authenticated: false, user_id: null, workspaces: [] };
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceList;
  } catch {
    return null;
  }
}

type Tab = "workspaces" | "collaborators";

export default function AccountHub() {
  const [list, setList] = useState<WorkspaceList | null>(null);
  const [tab, setTab] = useState<Tab>("workspaces");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collabRows, setCollabRows] = useState<CollaboratorRow[]>([]);
  const [collabLoading, setCollabLoading] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    const data = await fetchWorkspaces();
    if (!data) {
      setError("Failed to load workspaces");
      return;
    }
    setList(data);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Anonymous → bounce to entry; LoginPrompt re-arm guarantees prompt
  // shows on next visit because we clear the dismissed flag here too.
  useEffect(() => {
    if (list && !list.authenticated) {
      try {
        localStorage.removeItem(LOGIN_PROMPT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      window.location.href = "/";
    }
  }, [list]);

  // Fetch collaborator data when the tab is active.
  useEffect(() => {
    if (tab !== "collaborators" || !list || !list.authenticated) return;
    let cancelled = false;
    setCollabLoading(true);
    setError(null);
    aggregateCollaborators(list.workspaces, list.user_id || "")
      .then((rows) => {
        if (!cancelled) setCollabRows(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(`Failed to aggregate collaborators: ${e.message}`);
      })
      .finally(() => {
        if (!cancelled) setCollabLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, list]);

  const signOut = () => {
    try {
      localStorage.removeItem(LOGIN_PROMPT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.href = "/oauth2/sign_out";
  };

  if (!list) {
    return <div data-testid="account-hub-loading">{error || "Loading…"}</div>;
  }

  return (
    <div data-testid="account-hub">
      <h1>Account</h1>
      {error && <div role="alert" style={{ color: "#b00" }}>{error}</div>}

      <nav style={{ display: "flex", gap: 12, borderBottom: "1px solid #ccc", marginBottom: 16 }}>
        <button
          data-testid="account-tab-workspaces"
          onClick={() => setTab("workspaces")}
          style={{ fontWeight: tab === "workspaces" ? "bold" : "normal" }}
        >
          Workspaces ({list.workspaces.length})
        </button>
        <button
          data-testid="account-tab-collaborators"
          onClick={() => setTab("collaborators")}
          style={{ fontWeight: tab === "collaborators" ? "bold" : "normal" }}
        >
          Collaborators
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={signOut} data-testid="account-signout">
          Sign out
        </button>
      </nav>

      {tab === "workspaces" && (
        <WorkspacesTab
          list={list}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      )}
      {tab === "collaborators" && (
        <CollaboratorsTab
          rows={collabRows}
          loading={collabLoading}
          ownedWorkspaces={list.workspaces.filter((w) => w.role === "owner")}
          onMutated={async () => {
            // Refresh both list (in case role changed) and collab rows.
            await reload();
            const rows = await aggregateCollaborators(list.workspaces, list.user_id || "");
            setCollabRows(rows);
          }}
        />
      )}
    </div>
  );
}

function WorkspacesTab({
  list,
  expanded,
  setExpanded,
}: {
  list: WorkspaceList;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
}) {
  if (list.workspaces.length === 0) {
    return <div data-testid="account-workspaces-empty">No workspaces yet.</div>;
  }
  return (
    <table data-testid="account-workspaces-table" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
          <th>Name</th>
          <th>Role</th>
          <th>State</th>
          <th>Last modified</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {list.workspaces.map((w) => {
          const isExpanded = expanded === w.workspace_id;
          return (
            <Fragment key={w.workspace_id}>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td>{w.name || w.workspace_id}</td>
                <td>{w.role === "owner" ? "Owner" : "Member"}</td>
                <td>{w.state || "draft"}</td>
                <td style={{ fontSize: 12 }}>{w.last_modified_at || "-"}</td>
                <td>
                  <a href={`/?workspace_id=${encodeURIComponent(w.workspace_id)}`}>Open</a>{" "}
                  <button
                    data-testid={`account-manage-${w.workspace_id}`}
                    onClick={() =>
                      setExpanded(isExpanded ? null : w.workspace_id)
                    }
                  >
                    {isExpanded ? "Hide members" : "Manage members"}
                  </button>
                </td>
              </tr>
              {isExpanded && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, background: "#fafafa" }}>
                    <MembersPanel
                      workspaceId={w.workspace_id}
                      isOwner={w.role === "owner"}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

type CollaboratorRow = {
  email: string;
  user_id: string | null;
  status: "Active" | "Pending";
  workspaces: { id: string; name: string }[];
};

async function aggregateCollaborators(
  workspaces: ApiWorkspace[],
  meUserId: string
): Promise<CollaboratorRow[]> {
  const owned = workspaces.filter((w) => w.role === "owner");
  if (owned.length === 0) return [];

  const settled = await Promise.allSettled(
    owned.map(async (w) => {
      const m = await listMembers(w.workspace_id);
      return { workspace: w, members: m };
    })
  );

  const map = new Map<string, CollaboratorRow>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { workspace, members } = r.value;
    const wsName = workspace.name || workspace.workspace_id;
    const all = [
      ...members.members.map((m: any) => ({ ...m, status: "Active" as const })),
      ...members.pending.map((m: any) => ({ ...m, status: "Pending" as const })),
    ];
    for (const entry of all) {
      const email = (entry.email || "").trim().toLowerCase();
      if (!email) continue;
      const key = email;
      if (!map.has(key)) {
        map.set(key, {
          email,
          user_id: entry.user_id || null,
          status: entry.status,
          workspaces: [],
        });
      }
      const row = map.get(key)!;
      // Active beats Pending if both seen.
      if (entry.status === "Active") {
        row.status = "Active";
        row.user_id = entry.user_id || row.user_id;
      }
      row.workspaces.push({ id: workspace.workspace_id, name: wsName });
    }
  }
  return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
}

function CollaboratorsTab({
  rows,
  loading,
  ownedWorkspaces,
  onMutated,
}: {
  rows: CollaboratorRow[];
  loading: boolean;
  ownedWorkspaces: ApiWorkspace[];
  onMutated: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openAdd, setOpenAdd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <div data-testid="account-collaborators-loading">Loading collaborators…</div>;
  if (rows.length === 0) {
    return (
      <div data-testid="account-collaborators-empty">
        No collaborators yet. Invite someone via a workspace&apos;s Members panel.
      </div>
    );
  }

  const removeFromAll = async (row: CollaboratorRow) => {
    if (!confirm(`Remove ${row.email} from all your workspaces?`)) return;
    setBusy(row.email);
    setError(null);
    try {
      for (const ws of row.workspaces) {
        const key = row.user_id || row.email;
        try {
          await removeMember(ws.id, key);
        } catch (e) {
          // Continue trying the others.
          setError(`Partial remove: ${ws.name} failed (${(e as Error).message})`);
        }
      }
      await onMutated();
    } finally {
      setBusy(null);
    }
  };

  const addToWorkspace = async (row: CollaboratorRow, workspaceId: string) => {
    setBusy(row.email);
    setError(null);
    try {
      await inviteMember(workspaceId, row.email);
      setOpenAdd(null);
      await onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="account-collaborators">
      {error && <div role="alert" style={{ color: "#b00" }}>{error}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Email</th>
            <th>Status</th>
            <th>Workspaces</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inIds = new Set(row.workspaces.map((w) => w.id));
            const candidates = ownedWorkspaces.filter(
              (w) => !inIds.has(w.workspace_id)
            );
            return (
              <tr
                key={row.email}
                data-testid={`account-collab-row-${row.email}`}
                style={{ borderBottom: "1px solid #eee" }}
              >
                <td>{row.email}</td>
                <td>{row.status}</td>
                <td>{row.workspaces.map((w) => w.name).join(", ")}</td>
                <td>
                  <button
                    disabled={busy === row.email || candidates.length === 0}
                    onClick={() =>
                      setOpenAdd(openAdd === row.email ? null : row.email)
                    }
                    data-testid={`account-collab-add-${row.email}`}
                  >
                    Add to workspace…
                  </button>
                  {openAdd === row.email && (
                    <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                      {candidates.map((c) => (
                        <button
                          key={c.workspace_id}
                          onClick={() => addToWorkspace(row, c.workspace_id)}
                          disabled={busy === row.email}
                        >
                          {c.name || c.workspace_id}
                        </button>
                      ))}
                    </div>
                  )}{" "}
                  <button
                    disabled={busy === row.email}
                    onClick={() => removeFromAll(row)}
                    data-testid={`account-collab-remove-${row.email}`}
                  >
                    Remove from all
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

