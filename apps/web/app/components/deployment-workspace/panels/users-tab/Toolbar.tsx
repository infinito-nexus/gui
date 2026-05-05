"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import styles from "../../../deployment/workspace/Main.module.css";
import { COLUMNS, type ColumnKey, type SyncState } from "./users-tab-utils";

type Props = {
  syncState: SyncState;
  visibleColumns: Set<ColumnKey>;
  onToggleColumn: (key: ColumnKey) => void;
  filterEnabled: boolean;
  onToggleFilter: () => void;
  onAddUser: () => void;
  onPickCsv: (event: ChangeEvent<HTMLInputElement>) => void;
  onPickYaml: (event: ChangeEvent<HTMLInputElement>) => void;
  onExportCsv: () => void;
  onExportYaml: () => void;
};

const SYNC_LABEL: Record<SyncState, string> = {
  idle: "Up to date",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

export default function UsersTabToolbar({
  syncState,
  visibleColumns,
  onToggleColumn,
  filterEnabled,
  onToggleFilter,
  onAddUser,
  onPickCsv,
  onPickYaml,
  onExportCsv,
  onExportYaml,
}: Props) {
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const yamlInputRef = useRef<HTMLInputElement | null>(null);
  const importMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);

  // Outside-click closes all open dropdowns. Each split-button has
  // its own ref; click outside any of them collapses everything.
  useEffect(() => {
    if (!importMenuOpen && !exportMenuOpen && !columnsMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (importMenuOpen && !importMenuRef.current?.contains(target)) {
        setImportMenuOpen(false);
      }
      if (exportMenuOpen && !exportMenuRef.current?.contains(target)) {
        setExportMenuOpen(false);
      }
      if (columnsMenuOpen && !columnsMenuRef.current?.contains(target)) {
        setColumnsMenuOpen(false);
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [importMenuOpen, exportMenuOpen, columnsMenuOpen]);

  return (
    <div className={styles.usersTabActions}>
      <span className={styles.usersTabSyncBadge} data-state={syncState}>
        {SYNC_LABEL[syncState]}
      </span>

      <div ref={columnsMenuRef} className={styles.usersTabSplitWrap}>
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
          onClick={() => {
            setColumnsMenuOpen((prev) => !prev);
            setImportMenuOpen(false);
            setExportMenuOpen(false);
          }}
          aria-haspopup="menu"
          aria-expanded={columnsMenuOpen}
        >
          <i className="fa-solid fa-table-columns" aria-hidden="true" />
          <span>Columns</span>
          <i
            className={`fa-solid ${
              columnsMenuOpen ? "fa-chevron-up" : "fa-chevron-down"
            }`}
            aria-hidden="true"
          />
        </button>
        {columnsMenuOpen ? (
          <div className={styles.usersTabSplitMenu} role="menu">
            {COLUMNS.map((col) => (
              <label key={col.key} className={styles.usersTabSplitItem}>
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.key)}
                  onChange={() => onToggleColumn(col.key)}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={`${styles.smallButton} ${styles.smallButtonEnabled} ${
          filterEnabled ? styles.usersTabFilterButtonActive : ""
        }`}
        onClick={onToggleFilter}
        aria-pressed={filterEnabled}
        title={
          filterEnabled
            ? "Hide column filter inputs"
            : "Show a search input per visible column"
        }
      >
        <i className="fa-solid fa-filter" aria-hidden="true" />
        <span>Filter</span>
      </button>

      <button
        type="button"
        className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
        onClick={onAddUser}
      >
        <i className="fa-solid fa-user-plus" aria-hidden="true" />
        <span>Add user</span>
      </button>

      <div ref={importMenuRef} className={styles.usersTabSplitWrap}>
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
          onClick={() => {
            setImportMenuOpen((prev) => !prev);
            setExportMenuOpen(false);
            setColumnsMenuOpen(false);
          }}
          aria-haspopup="menu"
          aria-expanded={importMenuOpen}
        >
          <i className="fa-solid fa-file-arrow-up" aria-hidden="true" />
          <span>Import</span>
          <i
            className={`fa-solid ${
              importMenuOpen ? "fa-chevron-up" : "fa-chevron-down"
            }`}
            aria-hidden="true"
          />
        </button>
        {importMenuOpen ? (
          <div className={styles.usersTabSplitMenu} role="menu">
            <button
              type="button"
              className={styles.usersTabSplitItem}
              onClick={() => {
                setImportMenuOpen(false);
                csvInputRef.current?.click();
              }}
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              className={styles.usersTabSplitItem}
              onClick={() => {
                setImportMenuOpen(false);
                yamlInputRef.current?.click();
              }}
            >
              <i className="fa-solid fa-file-code" aria-hidden="true" />
              <span>YAML</span>
            </button>
          </div>
        ) : null}
      </div>

      <div ref={exportMenuRef} className={styles.usersTabSplitWrap}>
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
          onClick={() => {
            setExportMenuOpen((prev) => !prev);
            setImportMenuOpen(false);
            setColumnsMenuOpen(false);
          }}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
        >
          <i className="fa-solid fa-file-arrow-down" aria-hidden="true" />
          <span>Export</span>
          <i
            className={`fa-solid ${
              exportMenuOpen ? "fa-chevron-up" : "fa-chevron-down"
            }`}
            aria-hidden="true"
          />
        </button>
        {exportMenuOpen ? (
          <div className={styles.usersTabSplitMenu} role="menu">
            <button
              type="button"
              className={styles.usersTabSplitItem}
              onClick={() => {
                setExportMenuOpen(false);
                onExportCsv();
              }}
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              className={styles.usersTabSplitItem}
              onClick={() => {
                setExportMenuOpen(false);
                onExportYaml();
              }}
            >
              <i className="fa-solid fa-file-code" aria-hidden="true" />
              <span>YAML</span>
            </button>
          </div>
        ) : null}
      </div>

      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onPickCsv}
        className={styles.usersTabHiddenInput}
      />
      <input
        ref={yamlInputRef}
        type="file"
        accept=".yaml,.yml,application/x-yaml,text/yaml"
        onChange={onPickYaml}
        className={styles.usersTabHiddenInput}
      />
    </div>
  );
}
