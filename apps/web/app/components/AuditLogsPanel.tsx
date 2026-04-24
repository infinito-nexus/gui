"use client";

import { useEffect, useState } from "react";

import styles from "./AuditLogsPanel.module.css";

type AuditLogMode =
  | "all"
  | "writes-only"
  | "auth-only"
  | "deployment-only"
  | "errors-only";

type AuditLogConfig = {
  workspace_id: string;
  retention_days: number;
  mode: AuditLogMode;
  exclude_health_endpoints: boolean;
};

type AuditLogEntry = {
  id: number;
  timestamp: string;
  workspace_id?: string | null;
  user: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip: string;
  request_id?: string | null;
  user_agent?: string | null;
};

type AuditLogEntryList = {
  entries: AuditLogEntry[];
  page: number;
  page_size: number;
  total: number;
};

type Filters = {
  from: string;
  to: string;
  user: string;
  ip: string;
  q: string;
  status: string;
  method: string;
};

const DEFAULT_FILTERS: Filters = {
  from: "",
  to: "",
  user: "",
  ip: "",
  q: "",
  status: "",
  method: "",
};

const DEFAULT_CONFIG: AuditLogConfig = {
  workspace_id: "",
  retention_days: 180,
  mode: "all",
  exclude_health_endpoints: false,
};

function toDateTimeInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function toIsoFilter(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function buildQuery(filters: Filters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  if (filters.from) {
    params.set("from", toIsoFilter(filters.from));
  }
  if (filters.to) {
    params.set("to", toIsoFilter(filters.to));
  }
  if (filters.user) {
    params.set("user", filters.user);
  }
  if (filters.ip) {
    params.set("ip", filters.ip);
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.method) {
    params.set("method", filters.method.toUpperCase());
  }
  return params.toString();
}

function statusClass(status: number) {
  if (status >= 400) {
    return `${styles.status} ${styles.statusError}`;
  }
  if (status >= 200 && status < 300) {
    return `${styles.status} ${styles.statusSuccess}`;
  }
  return styles.status;
}

export default function AuditLogsPanel({
  baseUrl,
  workspaceId,
}: {
  baseUrl: string;
  workspaceId: string | null;
}) {
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState(() =>
    String(workspaceId || "").trim()
  );
  const [config, setConfig] = useState<AuditLogConfig>(DEFAULT_CONFIG);
  const [draftConfig, setDraftConfig] = useState<AuditLogConfig>(DEFAULT_CONFIG);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const propWorkspaceId = String(workspaceId || "").trim();
    if (propWorkspaceId) {
      setResolvedWorkspaceId(propWorkspaceId);
      return;
    }
    if (typeof window === "undefined") {
      setResolvedWorkspaceId("");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setResolvedWorkspaceId(String(params.get("workspace") || "").trim());
  }, [workspaceId]);

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const configRes = await fetch(
          `${baseUrl}/api/workspaces/${resolvedWorkspaceId}/logs/config`,
          { cache: "no-store" }
        );
        if (!configRes.ok) {
          throw new Error(`Failed to load audit config (${configRes.status})`);
        }
        const configData = (await configRes.json()) as AuditLogConfig;
        const query = buildQuery(filters, page, pageSize);
        const entriesRes = await fetch(
          `${baseUrl}/api/workspaces/${resolvedWorkspaceId}/logs/entries?${query}`,
          { cache: "no-store" }
        );
        if (!entriesRes.ok) {
          throw new Error(`Failed to load audit entries (${entriesRes.status})`);
        }
        const entriesData = (await entriesRes.json()) as AuditLogEntryList;
        if (cancelled) {
          return;
        }
        setConfig(configData);
        setDraftConfig(configData);
        setEntries(entriesData.entries || []);
        setTotal(entriesData.total || 0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audit logs");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, filters, page, pageSize, refreshKey, resolvedWorkspaceId]);

  useEffect(() => {
    setPage(1);
  }, [filters.from, filters.ip, filters.method, filters.q, filters.status, filters.to, filters.user]);

  const saveConfig = async () => {
    if (!resolvedWorkspaceId) {
      return;
    }
    setSavingConfig(true);
    setConfigError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${resolvedWorkspaceId}/logs/config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            retention_days: draftConfig.retention_days,
            mode: draftConfig.mode,
            exclude_health_endpoints: draftConfig.exclude_health_endpoints,
          }),
        }
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `Failed to save audit config (${res.status})`);
      }
      const nextConfig = (await res.json()) as AuditLogConfig;
      setConfig(nextConfig);
      setDraftConfig(nextConfig);
      setRefreshKey((current) => current + 1);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSavingConfig(false);
    }
  };

  const exportEntries = (format: "jsonl" | "csv", zipped = false) => {
    if (!resolvedWorkspaceId) {
      return;
    }
    const params = new URLSearchParams(buildQuery(filters, page, pageSize));
    params.delete("page");
    params.delete("page_size");
    params.set("format", format);
    if (zipped) {
      params.set("zip", "true");
    }
    window.location.href = `${baseUrl}/api/workspaces/${resolvedWorkspaceId}/logs/entries/export?${params.toString()}`;
  };

  return (
    <div className={styles.panel} data-testid="audit-logs-panel">
      {!resolvedWorkspaceId ? (
        <div className={styles.notice}>
          Generate or load a workspace first to inspect audit events for that
          workspace.
        </div>
      ) : null}
      <section className={`${styles.card} ${styles.summaryCard}`}>
        <h2 className={styles.summaryTitle}>Audit Logs</h2>
        <p className={styles.summaryText}>
          Structured request events for this workspace live in the database and stay out
          of the workspace file tree.
        </p>
        <p className={styles.summaryText}>
          Current mode: <strong>{config.mode}</strong>. Retention:{" "}
          <strong>{config.retention_days} days</strong>.
        </p>
      </section>

      <section className={`${styles.card} ${styles.toolbar}`}>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor="audit-from">From</label>
            <input
              id="audit-from"
              type="datetime-local"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-to">To</label>
            <input
              id="audit-to"
              type="datetime-local"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-user">User</label>
            <input
              id="audit-user"
              type="text"
              value={filters.user}
              onChange={(event) =>
                setFilters((current) => ({ ...current, user: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-ip">IP</label>
            <input
              id="audit-ip"
              type="text"
              value={filters.ip}
              onChange={(event) =>
                setFilters((current) => ({ ...current, ip: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-status">Status</label>
            <input
              id="audit-status"
              type="number"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-method">Method</label>
            <select
              id="audit-method"
              value={filters.method}
              onChange={(event) =>
                setFilters((current) => ({ ...current, method: event.target.value }))
              }
            >
              <option value="">Any</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-search">Search</label>
            <input
              id="audit-search"
              type="text"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({ ...current, q: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-retention">Retention Days</label>
            <input
              id="audit-retention"
              type="number"
              min={1}
              value={draftConfig.retention_days}
              onChange={(event) =>
                setDraftConfig((current) => ({
                  ...current,
                  retention_days: Number(event.target.value || 180),
                }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="audit-mode">Mode</label>
            <select
              id="audit-mode"
              value={draftConfig.mode}
              onChange={(event) =>
                setDraftConfig((current) => ({
                  ...current,
                  mode: event.target.value as AuditLogMode,
                }))
              }
            >
              <option value="all">All</option>
              <option value="writes-only">Writes Only</option>
              <option value="auth-only">Auth Only</option>
              <option value="deployment-only">Deployment Only</option>
              <option value="errors-only">Errors Only</option>
            </select>
          </div>
        </div>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={draftConfig.exclude_health_endpoints}
            onChange={(event) =>
              setDraftConfig((current) => ({
                ...current,
                exclude_health_endpoints: event.target.checked,
              }))
            }
          />
          Exclude health endpoints from future audit events
        </label>

        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            onClick={saveConfig}
            disabled={savingConfig}
          >
            {savingConfig ? "Saving..." : "Save Config"}
          </button>
          <button
            className={styles.buttonSecondary}
            type="button"
            onClick={() => {
              setDraftConfig(config);
              setConfigError(null);
            }}
            disabled={savingConfig}
          >
            Cancel Config Changes
          </button>
          <button
            className={styles.buttonSecondary}
            type="button"
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              setPage(1);
              setRefreshKey((current) => current + 1);
            }}
          >
            Reset Filters
          </button>
          <button
            className={styles.buttonSecondary}
            type="button"
            onClick={() => exportEntries("jsonl")}
          >
            Export JSONL
          </button>
          <button
            className={styles.buttonSecondary}
            type="button"
            onClick={() => exportEntries("csv")}
          >
            Export CSV
          </button>
          <button
            className={styles.buttonSecondary}
            type="button"
            onClick={() => exportEntries("jsonl", true)}
          >
            Export ZIP
          </button>
        </div>

        {configError ? <div className={styles.notice}>{configError}</div> : null}
      </section>

      <section className={`${styles.card} ${styles.tableCard}`}>
        <div className={styles.tableHeader}>
          <div>
            <strong>Entries</strong>
            <div className={styles.tableMeta}>
              {loading ? "Loading..." : `${entries.length} shown of ${total} total`}
            </div>
          </div>
          <div className={styles.actions}>
            <button
              className={styles.buttonSecondary}
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              className={styles.buttonSecondary}
              type="button"
              onClick={() =>
                setPage((current) =>
                  current * pageSize < total ? current + 1 : current
                )
              }
              disabled={page * pageSize >= total}
            >
              Next
            </button>
          </div>
        </div>

        <div className={styles.tableWrap}>
          {error ? <div className={styles.notice}>{error}</div> : null}
          {!error && entries.length === 0 && !loading ? (
            <div className={styles.empty}>No audit events match the current filters.</div>
          ) : null}
          {!error && entries.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>IP</th>
                  <th>Request ID</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className={styles.mono}>{toDateTimeInput(entry.timestamp).replace("T", " ")}</td>
                    <td>{entry.user}</td>
                    <td className={styles.mono}>{entry.method}</td>
                    <td className={styles.mono}>{entry.path}</td>
                    <td>
                      <span className={statusClass(entry.status)}>{entry.status}</span>
                    </td>
                    <td>{entry.duration_ms} ms</td>
                    <td className={styles.mono}>{entry.ip}</td>
                    <td className={styles.mono}>{entry.request_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </section>
    </div>
  );
}
