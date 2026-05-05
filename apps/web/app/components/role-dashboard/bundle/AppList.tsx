"use client";

import { useEffect, useMemo, useState } from "react";
import RoleLogoView from "../role/LogoView";
import styles from "../styles";
import type { Role } from "./types";

export type BundleAppListRow = {
  roleId: string;
  role: Role | null;
  label: string;
  monthlyPriceAmount: number;
  monthlyPriceLabel: string;
  isActive: boolean;
};

type BundleAppListProps = {
  bundleId: string;
  rows: BundleAppListRow[];
  pageSize?: number;
  emptyLabel?: string;
  compact?: boolean;
  onOpenRoleDetails?: (role: Role) => void;
};

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 0;
  return Math.max(0, Math.min(totalPages - 1, Math.floor(page)));
}

export default function BundleAppList({
  bundleId,
  rows,
  pageSize = 3,
  emptyLabel = "No apps in this bundle.",
  compact = false,
  onOpenRoleDetails,
}: BundleAppListProps) {
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 3));
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [bundleId]);

  useEffect(() => {
    setPage((prev) => clampPage(prev, totalPages));
  }, [totalPages]);

  const visibleRows = useMemo(() => {
    if (rows.length === 0) return [];
    const safePage = clampPage(page, totalPages);
    const start = safePage * safePageSize;
    return rows.slice(start, start + safePageSize);
  }, [rows, page, safePageSize, totalPages]);

  return (
    <div
      className={`${styles.bundleAppListShell} ${
        compact ? styles.bundleAppListShellCompact : ""
      }`}
    >
      {rows.length === 0 ? (
        <span className={`text-body-secondary ${styles.listPriceCaption}`}>{emptyLabel}</span>
      ) : (
        <>
          <div className={styles.bundleAppListViewport}>
            <div className={styles.bundleAppListTrack}>
              {visibleRows.map((row, index) => {
                const canOpenDetails = Boolean(row.role && onOpenRoleDetails);
                return (
                  <div
                    key={`${bundleId}:${row.roleId}:${index}`}
                    className={`${styles.bundleAppListItem} ${
                      row.isActive ? styles.bundleAppListItemUsed : ""
                    } ${
                      !canOpenDetails ? styles.bundleAppListItemDisabled : ""
                    }`}
                    title={row.label}
                  >
                    <span className={styles.bundleAppListLogo}>
                      {row.role ? (
                        <RoleLogoView role={row.role} size={compact ? 14 : 18} />
                      ) : (
                        <i className="fa-solid fa-cube" aria-hidden="true" />
                      )}
                    </span>
                    <span className={styles.bundleAppListName}>{row.label}</span>
                    <span className={styles.bundleAppListPrice}>{row.monthlyPriceLabel}</span>
                    <button
                      type="button"
                      disabled={!canOpenDetails}
                      className={styles.bundleAppListDetailsButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!row.role || !onOpenRoleDetails) return;
                        onOpenRoleDetails(row.role);
                      }}
                      title={
                        canOpenDetails
                          ? `Open details for ${row.label}`
                          : `No details for ${row.label}`
                      }
                    >
                      <i className="fa-solid fa-circle-info" aria-hidden="true" />
                      <span>Details</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {totalPages > 1 ? (
            <div className={styles.bundleAppListMenu}>
              <button
                type="button"
                className={styles.bundleAppListNavButton}
                onClick={() => setPage((prev) => (prev <= 0 ? totalPages - 1 : prev - 1))}
                aria-label="Previous apps"
                title="Previous apps"
              >
                <i className="fa-solid fa-backward-step" aria-hidden="true" />
              </button>
              <span className={styles.bundleAppListNavLabel}>
                {Math.min(totalPages, page + 1)}/{totalPages}
              </span>
              <button
                type="button"
                className={styles.bundleAppListNavButton}
                onClick={() => setPage((prev) => (prev >= totalPages - 1 ? 0 : prev + 1))}
                aria-label="Next apps"
                title="Next apps"
              >
                <i className="fa-solid fa-forward-step" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
