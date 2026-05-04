"use client";

import styles from "../../../DeploymentWorkspace.module.css";

type RowsMode = "auto" | number;

const ROW_OPTIONS: ReadonlyArray<RowsMode> = ["auto", 10, 25, 50, 100];

type Props = {
  page: number;
  pageCount: number;
  rowsMode: RowsMode;
  autoPageSize: number;
  totalRows: number;
  filteredRows: number;
  filterActive: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRowsModeChange: (mode: RowsMode) => void;
};

export default function UsersTabFooter({
  page,
  pageCount,
  rowsMode,
  autoPageSize,
  totalRows,
  filteredRows,
  filterActive,
  onPrev,
  onNext,
  onRowsModeChange,
}: Props) {
  return (
    <div className={styles.usersTabFooter}>
      <div className={styles.usersTabPager}>
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
          disabled={page <= 1}
          onClick={onPrev}
        >
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
          <span>Prev</span>
        </button>
        <span className={styles.usersTabPagerInfo}>
          Page {page} of {pageCount}
          {filterActive
            ? ` · ${filteredRows} of ${totalRows} match`
            : ` · ${totalRows} total`}
        </span>
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
          disabled={page >= pageCount}
          onClick={onNext}
        >
          <span>Next</span>
          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
      <label className={styles.usersTabRowsSelector}>
        <span>Rows</span>
        <select
          className="form-select"
          value={String(rowsMode)}
          onChange={(e) => {
            const v = e.target.value;
            onRowsModeChange(v === "auto" ? "auto" : Number(v));
          }}
        >
          {ROW_OPTIONS.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {opt === "auto" ? `Auto (${autoPageSize})` : String(opt)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
