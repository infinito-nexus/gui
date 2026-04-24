"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./UsersPanel.module.css";

type UsersPanelProps = {
  baseUrl: string;
  workspaceId: string | null;
};

type UserRecord = {
  username: string;
  firstname: string;
  lastname: string;
  email: string;
  roles: string[];
  enabled: boolean;
};

type UsersStatus = {
  can_manage: boolean;
  setup_completed: boolean;
  ldap_present: boolean;
  keycloak_servers: string[];
  reachable_servers: string[];
  reasons: string[];
};

const EMPTY_STATUS: UsersStatus = {
  can_manage: false,
  setup_completed: false,
  ldap_present: false,
  keycloak_servers: [],
  reachable_servers: [],
  reasons: [],
};

export default function UsersPanel({ baseUrl, workspaceId }: UsersPanelProps) {
  const [status, setStatus] = useState<UsersStatus>(EMPTY_STATUS);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [serverId, setServerId] = useState("");
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});

  const [createForm, setCreateForm] = useState({
    username: "",
    firstname: "",
    lastname: "",
    email: "",
    password: "",
    roles: "",
  });

  const reachableServers = useMemo(
    () => status.reachable_servers || [],
    [status.reachable_servers]
  );

  const loadStatus = useCallback(async () => {
    if (!workspaceId) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/status?workspace_id=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const data = (await res.json()) as UsersStatus;
      setStatus(data);
      const firstServer = String(data?.reachable_servers?.[0] || "").trim();
      setServerId((prev) => prev || firstServer);
    } catch (err: any) {
      setStatus(EMPTY_STATUS);
      setStatusError(err?.message ?? "failed to load users status");
    } finally {
      setStatusLoading(false);
    }
  }, [baseUrl, workspaceId]);

  const loadUsers = useCallback(async (targetServer: string) => {
    if (!workspaceId || !targetServer) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/users?workspace_id=${encodeURIComponent(workspaceId)}&server_id=${encodeURIComponent(targetServer)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const data = await res.json();
      const nextUsers = Array.isArray(data?.users) ? data.users : [];
      setUsers(nextUsers);
      setRoleDrafts((prev) => {
        const next: Record<string, string> = {};
        nextUsers.forEach((user: UserRecord) => {
          next[user.username] = prev[user.username] ?? user.roles.join(", ");
        });
        return next;
      });
    } catch (err: any) {
      setUsers([]);
      setUsersError(err?.message ?? "failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }, [baseUrl, workspaceId]);

  useEffect(() => {
    setUsers([]);
    setServerId("");
    if (!workspaceId) return;
    void loadStatus();
  }, [loadStatus, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !serverId || !status.can_manage) return;
    void loadUsers(serverId);
  }, [loadUsers, serverId, status.can_manage, workspaceId]);

  const createUser = async () => {
    if (!workspaceId || !serverId) return;
    setActionError(null);
    setActionStatus(null);
    try {
      const roles = createForm.roles
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          server_id: serverId,
          username: createForm.username.trim(),
          firstname: createForm.firstname.trim(),
          lastname: createForm.lastname.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          roles,
          enabled: true,
        }),
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      setCreateForm({
        username: "",
        firstname: "",
        lastname: "",
        email: "",
        password: "",
        roles: "",
      });
      await loadUsers(serverId);
      setActionStatus("User created.");
    } catch (err: any) {
      setActionError(err?.message ?? "failed to create user");
    }
  };

  const changePassword = async (username: string) => {
    if (!workspaceId || !serverId) return;
    const newPassword = window.prompt(`New password for ${username}`);
    if (!newPassword) return;
    const confirm = window.prompt(`Confirm password for ${username}`);
    if (!confirm) return;
    setActionError(null);
    setActionStatus(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${encodeURIComponent(username)}/password`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            server_id: serverId,
            new_password: newPassword,
            new_password_confirm: confirm,
          }),
        }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      setActionStatus(`Password updated for ${username}.`);
    } catch (err: any) {
      setActionError(err?.message ?? "failed to update password");
    }
  };

  const updateRoles = async (username: string, rolesText: string, enabled: boolean) => {
    if (!workspaceId || !serverId) return;
    setActionError(null);
    setActionStatus(null);
    try {
      const roles = rolesText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const res = await fetch(`${baseUrl}/api/users/${encodeURIComponent(username)}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          server_id: serverId,
          roles,
          enabled,
        }),
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      await loadUsers(serverId);
      setActionStatus(`Roles updated for ${username}.`);
    } catch (err: any) {
      setActionError(err?.message ?? "failed to update roles");
    }
  };

  const deleteUser = async (username: string) => {
    if (!workspaceId || !serverId) return;
    if (!window.confirm(`Delete user ${username}? This cannot be undone.`)) return;
    setActionError(null);
    setActionStatus(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${encodeURIComponent(username)}?workspace_id=${encodeURIComponent(workspaceId)}&server_id=${encodeURIComponent(serverId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      await loadUsers(serverId);
      setActionStatus(`User ${username} deleted.`);
    } catch (err: any) {
      setActionError(err?.message ?? "failed to delete user");
    }
  };

  if (!workspaceId) {
    return <div className={styles.hint}>Workspace is not ready yet.</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.topRow}>
        <h3>Users</h3>
        <button type="button" onClick={() => void loadStatus()}>
          Refresh
        </button>
      </div>

      {statusLoading ? <div className={styles.hint}>Checking setup status...</div> : null}
      {statusError ? <div className={styles.error}>{statusError}</div> : null}

      {!status.can_manage ? (
        <div className={styles.disabledBox}>
          <p>User management requires an active deployed server with Keycloak and LDAP.</p>
          {status.reasons.length > 0 ? (
            <ul>
              {status.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <>
          <div className={styles.serverSelectRow}>
            <label>Server</label>
            <select value={serverId} onChange={(event) => setServerId(event.target.value)}>
              {reachableServers.map((server) => (
                <option key={server} value={server}>
                  {server}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.createForm}>
            <input
              placeholder="username"
              value={createForm.username}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, username: event.target.value }))
              }
            />
            <input
              placeholder="firstname"
              value={createForm.firstname}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, firstname: event.target.value }))
              }
            />
            <input
              placeholder="lastname"
              value={createForm.lastname}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, lastname: event.target.value }))
              }
            />
            <input
              placeholder="email"
              value={createForm.email}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, email: event.target.value }))
              }
            />
            <input
              type="password"
              placeholder="password"
              value={createForm.password}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, password: event.target.value }))
              }
            />
            <input
              placeholder="roles (comma-separated)"
              value={createForm.roles}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, roles: event.target.value }))
              }
            />
            <button type="button" onClick={() => void createUser()}>
              Create user
            </button>
          </div>

          {usersLoading ? <div className={styles.hint}>Loading users...</div> : null}
          {usersError ? <div className={styles.error}>{usersError}</div> : null}
          {actionError ? <div className={styles.error}>{actionError}</div> : null}
          {actionStatus ? <div className={styles.status}>{actionStatus}</div> : null}

          <div className={styles.list}>
            {users.map((user) => {
              const roleText = roleDrafts[user.username] ?? user.roles.join(", ");
              return (
                <div key={user.username} className={styles.userRow}>
                  <div className={styles.userMeta}>
                    <strong>{user.username}</strong>
                    <span>
                      {user.firstname} {user.lastname}
                    </span>
                    <span>{user.email}</span>
                  </div>
                  <input
                    value={roleText}
                    onChange={(event) =>
                      setRoleDrafts((prev) => ({
                        ...prev,
                        [user.username]: event.target.value,
                      }))
                    }
                  />
                  <div className={styles.actions}>
                    <button
                      type="button"
                      onClick={() =>
                        void updateRoles(user.username, roleText, user.enabled)
                      }
                    >
                      Save roles
                    </button>
                    <button type="button" onClick={() => void changePassword(user.username)}>
                      Change password
                    </button>
                    <button type="button" onClick={() => void deleteUser(user.username)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
            {users.length === 0 && !usersLoading ? (
              <div className={styles.hint}>No users yet for this server.</div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
