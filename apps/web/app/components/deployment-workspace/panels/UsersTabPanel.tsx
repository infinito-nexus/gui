"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import YAML from "yaml";
import styles from "../../DeploymentWorkspace.module.css";
import { encodePath } from "../../workspace-panel/utils";
import {
  parseUsersFromCsv,
  usersToCsv,
  USERNAME_PATTERN,
  type WorkspaceUser,
} from "../../workspace-panel/users-utils";
import UserDetailModal from "./users-tab/UserDetailModal";
import UsersTabFooter from "./users-tab/UsersTabFooter";
import UsersTabTable from "./users-tab/UsersTabTable";
import UsersTabToolbar from "./users-tab/UsersTabToolbar";
import {
  AUTOSAVE_DEBOUNCE_MS,
  COLUMNS,
  REMOTE_POLL_MS,
  USERS_GROUP_VARS_PATH,
  downloadBlob,
  parseDoc,
  readCookie,
  rowMatchesColumnFilters,
  rowsFingerprint,
  rowsToYamlMap,
  type ColumnFilters,
  type ColumnKey,
  type SyncState,
  type UserRow,
} from "./users-tab/users-tab-utils";

type Props = {
  baseUrl: string;
  workspaceId: string;
};

type RowsMode = "auto" | number;

export default function UsersTabPanel({ baseUrl, workspaceId }: Props): JSX.Element {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [doc, setDoc] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [page, setPage] = useState(1);
  const [rowsMode, setRowsMode] = useState<RowsMode>("auto");
  const [autoPageSize, setAutoPageSize] = useState(10);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)),
  );
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const firstRowRef = useRef<HTMLTableRowElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteFingerprintRef = useRef<string>("");
  const localFingerprintRef = useRef<string>("");

  const fileUrl = useMemo(
    () =>
      `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(USERS_GROUP_VARS_PATH)}`,
    [baseUrl, workspaceId],
  );

  const writeYaml = useCallback(
    async (nextRows: UserRow[]): Promise<void> => {
      const nextDoc: Record<string, unknown> = { ...doc };
      nextDoc.users = rowsToYamlMap(nextRows);
      const content = YAML.stringify(nextDoc);
      const csrf = readCookie("csrf");
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrf) headers["X-CSRF"] = csrf;
      const res = await fetch(fileUrl, {
        method: "PUT",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = ((await res.json()) as { detail?: string }).detail || "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setDoc(nextDoc);
      lastRemoteFingerprintRef.current = rowsFingerprint(nextRows);
      localFingerprintRef.current = lastRemoteFingerprintRef.current;
    },
    [doc, fileUrl],
  );

  const reload = useCallback(
    async (silent = false): Promise<void> => {
      if (!workspaceId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(fileUrl, { cache: "no-store" });
        if (res.status === 404) {
          setDoc({});
          setRows([]);
          lastRemoteFingerprintRef.current = "";
          localFingerprintRef.current = "";
        } else if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        } else {
          const data = await res.json();
          const content = String(data?.content ?? "");
          const parsed = parseDoc(content);
          setDoc(parsed.doc);
          setRows(parsed.rows);
          const fp = rowsFingerprint(parsed.rows);
          lastRemoteFingerprintRef.current = fp;
          localFingerprintRef.current = fp;
        }
        setExternalChanged(false);
      } catch (err) {
        setError(`Failed to load users: ${(err as Error).message}`);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [fileUrl, workspaceId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Debounced autosave: any divergence between local fingerprint and
  // last-known-remote schedules a save in 500ms; further edits cancel
  // and reschedule.
  const scheduleSave = useCallback(
    (nextRows: UserRow[]) => {
      const localFp = rowsFingerprint(nextRows);
      localFingerprintRef.current = localFp;
      if (localFp === lastRemoteFingerprintRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSyncState("saving");
      saveTimerRef.current = setTimeout(async () => {
        saveTimerRef.current = null;
        try {
          await writeYaml(nextRows);
          if (localFingerprintRef.current !== rowsFingerprint(nextRows)) {
            setRows((current) => {
              scheduleSave(current);
              return current;
            });
            return;
          }
          setSyncState("saved");
          setRows((current) =>
            current.map((r) => (r.isNew ? { ...r, isNew: false } : r)),
          );
          window.setTimeout(() => setSyncState("idle"), 1500);
        } catch (err) {
          setError(`Autosave failed: ${(err as Error).message}`);
          setSyncState("error");
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [writeYaml],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // Auto-rows: measure live row + head height so the page exactly
  // fits the visible area without overflow scrolling. -1 safety
  // margin against fractional rounding under the scrollbar.
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const headH =
        wrap.querySelector("thead")?.getBoundingClientRect().height ?? 50;
      const rowH = firstRowRef.current?.getBoundingClientRect().height || 50;
      setAutoPageSize(
        Math.max(3, Math.floor((wrap.clientHeight - headH) / rowH) - 1),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    if (firstRowRef.current) observer.observe(firstRowRef.current);
    return () => observer.disconnect();
  }, [filterEnabled, visibleColumns]);

  // Background poll: detect remote-side edits to group_vars/all.yml.
  useEffect(() => {
    if (!workspaceId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(fileUrl, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const content = String(data?.content ?? "");
        const parsed = parseDoc(content);
        const remoteFp = rowsFingerprint(parsed.rows);
        if (remoteFp === lastRemoteFingerprintRef.current) return;
        const hasLocalEdits =
          localFingerprintRef.current !== lastRemoteFingerprintRef.current;
        if (hasLocalEdits) {
          setExternalChanged(true);
          return;
        }
        setDoc(parsed.doc);
        setRows(parsed.rows);
        lastRemoteFingerprintRef.current = remoteFp;
        localFingerprintRef.current = remoteFp;
      } catch {
        // ignore transient network errors
      }
    }, REMOTE_POLL_MS);
    return () => clearInterval(interval);
  }, [fileUrl, workspaceId]);

  const updateRowByUsername = useCallback(
    (username: string, patch: Partial<UserRow>) => {
      setRows((prev) => {
        const next = prev.map((r) =>
          r.username === username ? { ...r, ...patch } : r,
        );
        scheduleSave(next);
        return next;
      });
      setError(null);
    },
    [scheduleSave],
  );

  const removeRowByUsername = useCallback(
    (username: string) => {
      setRows((prev) => {
        const next = prev.filter((r) => r.username !== username);
        scheduleSave(next);
        return next;
      });
      if (detailKey === username) setDetailKey(null);
    },
    [detailKey, scheduleSave],
  );

  const addRow = useCallback(() => {
    setRows((prev) => {
      const taken = new Set(prev.map((r) => r.username));
      let n = 1;
      let username = "user1";
      while (taken.has(username)) {
        n += 1;
        username = `user${n}`;
      }
      const next: UserRow[] = [
        ...prev,
        {
          username,
          firstname: "",
          lastname: "",
          isNew: true,
        },
      ];
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const validateRows = useCallback((): string | null => {
    const seen = new Set<string>();
    for (const row of rows) {
      const u = row.username.trim();
      if (!u) return "A row has an empty username.";
      if (!USERNAME_PATTERN.test(u)) {
        return `Username "${u}" must contain only lowercase letters and digits.`;
      }
      if (seen.has(u)) return `Duplicate username "${u}".`;
      seen.add(u);
    }
    return null;
  }, [rows]);

  useEffect(() => {
    const v = validateRows();
    if (v) setError(v);
    else if (error && !/^(Failed to|Autosave)/.test(error)) setError(null);
  }, [rows, validateRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-column filtering: every active column input contributes an
  // AND-clause. Resets to page 1 whenever the filter set changes so
  // the user doesn't end up on an empty page after narrowing.
  const filteredRows = useMemo(
    () => rows.filter((row) => rowMatchesColumnFilters(row, columnFilters)),
    [rows, columnFilters],
  );
  const pageSize = rowsMode === "auto" ? autoPageSize : rowsMode;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [columnFilters]);

  const filterActive = useMemo(
    () => Object.values(columnFilters).some((v) => (v ?? "").trim()),
    [columnFilters],
  );

  const exportYaml = useCallback(() => {
    const yaml = YAML.stringify({ users: rowsToYamlMap(rows) });
    downloadBlob(`workspace-users-${workspaceId}.yml`, "application/x-yaml", yaml);
  }, [rows, workspaceId]);

  const exportCsv = useCallback(() => {
    const csv = usersToCsv(rows);
    downloadBlob(`workspace-users-${workspaceId}.csv`, "text/csv", csv);
  }, [rows, workspaceId]);

  const importFile = useCallback(
    async (file: File, format: "yaml" | "csv") => {
      try {
        const text = await file.text();
        let parsed: WorkspaceUser[] = [];
        if (format === "yaml") {
          parsed = parseDoc(text).rows;
        } else {
          parsed = parseUsersFromCsv(text);
        }
        setRows((prev) => {
          const byName = new Map<string, UserRow>();
          for (const r of prev) byName.set(r.username, r);
          for (const u of parsed) {
            if (!u.username) continue;
            byName.set(u.username, { ...byName.get(u.username), ...u });
          }
          const next = Array.from(byName.values());
          scheduleSave(next);
          return next;
        });
      } catch (err) {
        setError(`Import failed: ${(err as Error).message}`);
      }
    },
    [scheduleSave],
  );

  const onPick = useCallback(
    (format: "csv" | "yaml") =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void importFile(file, format);
      },
    [importFile],
  );

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Always keep at least one column visible so the table
        // doesn't collapse to a single Actions stub.
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const detailRow = useMemo(
    () => (detailKey ? rows.find((r) => r.username === detailKey) ?? null : null),
    [detailKey, rows],
  );

  if (!workspaceId) {
    return (
      <div className={styles.usersTabEmpty}>
        Select a workspace to manage users.
      </div>
    );
  }

  return (
    <div className={styles.usersTabRoot}>
      <div className={styles.usersTabHeader}>
        <UsersTabToolbar
          syncState={syncState}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          filterEnabled={filterEnabled}
          onToggleFilter={() => {
            setFilterEnabled((prev) => {
              if (prev) setColumnFilters({});
              return !prev;
            });
          }}
          onAddUser={addRow}
          onPickCsv={onPick("csv")}
          onPickYaml={onPick("yaml")}
          onExportCsv={exportCsv}
          onExportYaml={exportYaml}
        />
      </div>

      {externalChanged ? (
        <div className={styles.usersTabExternalBanner}>
          <span>This file was modified outside the table.</span>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
            onClick={() => void reload()}
          >
            Reload (discard local edits)
          </button>
        </div>
      ) : null}

      {error ? (
        <p className={`text-danger ${styles.usersTabMessage}`}>{error}</p>
      ) : null}

      <div ref={tableWrapRef} className={styles.usersTabTableWrap}>
        <UsersTabTable
          rows={pagedRows}
          visibleColumns={visibleColumns}
          filterEnabled={filterEnabled}
          columnFilters={columnFilters}
          onColumnFilterChange={(key, value) =>
            setColumnFilters((prev) => ({ ...prev, [key]: value }))
          }
          onUpdateRow={(row, patch) => updateRowByUsername(row.username, patch)}
          onRemoveRow={(row) => removeRowByUsername(row.username)}
          onOpenDetails={(row) => setDetailKey(row.username)}
          loading={loading}
          totalCount={rows.length}
          rowRef={firstRowRef}
        />
      </div>

      <UsersTabFooter
        page={safePage}
        pageCount={pageCount}
        rowsMode={rowsMode}
        autoPageSize={autoPageSize}
        totalRows={rows.length}
        filteredRows={filteredRows.length}
        filterActive={filterActive}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
        onRowsModeChange={(mode) => {
          setRowsMode(mode);
          setPage(1);
        }}
      />

      {detailRow
        ? createPortal(
            <UserDetailModal
              row={detailRow}
              onClose={() => setDetailKey(null)}
              onChange={(patch) => updateRowByUsername(detailRow.username, patch)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
