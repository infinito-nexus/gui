import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import styles from "../deployment/CredentialsForm.module.css";
import type { ServerViewMode } from "./types";

type UseCredentialViewMenusArgs = {
  query: string;
  setQuery: (next: string) => void;
  queryDraft: string;
  setQueryDraft: (next: string) => void;
  computedRows: number;
  rowOptions: number[];
  rowsOverride: number | null;
  setRowsOverride: (next: number | null) => void;
  viewMode: ServerViewMode;
  setViewMode: (next: ServerViewMode) => void;
  setPage: (next: number) => void;
  filtersButtonRef: MutableRefObject<HTMLButtonElement | null>;
  filtersPopoverRef: MutableRefObject<HTMLDivElement | null>;
  viewButtonRef: MutableRefObject<HTMLButtonElement | null>;
  viewPopoverRef: MutableRefObject<HTMLDivElement | null>;
};

export default function useCredentialViewMenus({
  query,
  setQuery,
  queryDraft,
  setQueryDraft,
  computedRows,
  rowOptions,
  rowsOverride,
  setRowsOverride,
  viewMode,
  setViewMode,
  setPage,
  filtersButtonRef,
  filtersPopoverRef,
  viewButtonRef,
  viewPopoverRef,
}: UseCredentialViewMenusArgs) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersPos, setFiltersPos] = useState({ top: 0, left: 0 });
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [query, viewMode, rowsOverride, setPage]);

  const applySearch = () => {
    setQuery(queryDraft.trim());
  };

  const handleQueryDraftChange = (value: string) => {
    setQueryDraft(value);
    setQuery(value);
  };

  const openFilters = () => {
    const button = filtersButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 230;
    setFiltersPos({
      top: rect.bottom + 8,
      left: Math.max(12, rect.right - width),
    });
    setFiltersOpen(true);
  };

  const toggleFilters = () => {
    if (filtersOpen) {
      setFiltersOpen(false);
    } else {
      openFilters();
    }
  };

  useEffect(() => {
    if (!filtersOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filtersPopoverRef.current?.contains(target)) return;
      if (filtersButtonRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    const closeOnViewportChange = () => setFiltersOpen(false);

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [filtersOpen, filtersButtonRef, filtersPopoverRef]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (viewPopoverRef.current?.contains(target)) return;
      if (viewButtonRef.current?.contains(target)) return;
      setViewMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [viewMenuOpen, viewButtonRef, viewPopoverRef]);

  const filtersOverlay =
    filtersOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={filtersPopoverRef}
            className={styles.dropdownCardOverlay}
            style={{ top: filtersPos.top, left: filtersPos.left }}
          >
            <div className={styles.group}>
              <span className={`text-body-tertiary ${styles.groupTitle}`}>Rows</span>
              <select
                value={rowsOverride ? String(rowsOverride) : "auto"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "auto") {
                    setRowsOverride(null);
                  } else {
                    const parsed = Number(value);
                    setRowsOverride(Number.isFinite(parsed) ? parsed : null);
                  }
                }}
                className={`form-select ${styles.rowSelect}`}
              >
                <option value="auto">Auto ({computedRows})</option>
                {rowOptions.map((value) => (
                  <option key={value} value={String(value)}>
                    {value} rows
                  </option>
                ))}
              </select>
            </div>
          </div>,
          document.body
        )
      : null;

  const toggleViewMenu = () => {
    setViewMenuOpen((prev) => !prev);
  };

  const selectViewMode = (mode: ServerViewMode) => {
    setViewMode(mode);
    setViewMenuOpen(false);
  };

  return {
    applySearch,
    handleQueryDraftChange,
    filtersOpen,
    toggleFilters,
    viewMenuOpen,
    toggleViewMenu,
    selectViewMode,
    filtersOverlay,
  };
}
