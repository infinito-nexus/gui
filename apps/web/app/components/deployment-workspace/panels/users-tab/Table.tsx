"use client";

import styles from "../../../deployment/workspace/Main.module.css";
import {
  COLUMNS,
  type ColumnFilters,
  type ColumnKey,
  type UserRow,
} from "./users-tab-utils";

type Props = {
  rows: UserRow[];
  visibleColumns: Set<ColumnKey>;
  filterEnabled: boolean;
  columnFilters: ColumnFilters;
  onColumnFilterChange: (key: ColumnKey, value: string) => void;
  onUpdateRow: (row: UserRow, patch: Partial<UserRow>) => void;
  onRemoveRow: (row: UserRow) => void;
  onOpenDetails: (row: UserRow) => void;
  loading: boolean;
  totalCount: number;
  rowRef?: React.RefObject<HTMLTableRowElement>;
};

function inputForColumn(
  row: UserRow,
  key: ColumnKey,
  onUpdate: (patch: Partial<UserRow>) => void,
): JSX.Element {
  const usernameLocked = key === "username" && !row.isNew;
  switch (key) {
    case "username":
      return (
        <input
          type="text"
          className="form-control"
          value={row.username}
          readOnly={usernameLocked}
          onChange={(e) => onUpdate({ username: e.target.value })}
          placeholder="username"
        />
      );
    case "email":
      return (
        <input
          type="email"
          className="form-control"
          value={row.email ?? ""}
          onChange={(e) => onUpdate({ email: e.target.value })}
        />
      );
    case "uid":
    case "gid":
      return (
        <input
          type="number"
          className="form-control"
          value={(row[key] as number | undefined) ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate({ [key]: v === "" ? undefined : Number(v) } as Partial<UserRow>);
          }}
        />
      );
    case "roles":
      return (
        <input
          type="text"
          className="form-control"
          value={(row.roles ?? []).join(", ")}
          onChange={(e) =>
            onUpdate({
              roles: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="admin, devops"
        />
      );
    case "reserved":
      return (
        <input
          type="checkbox"
          checked={Boolean(row.reserved)}
          onChange={(e) => onUpdate({ reserved: e.target.checked })}
        />
      );
    case "description":
      return (
        <input
          type="text"
          className="form-control"
          value={row.description ?? ""}
          onChange={(e) => onUpdate({ description: e.target.value })}
        />
      );
    case "firstname":
    case "lastname":
    default:
      return (
        <input
          type="text"
          className="form-control"
          value={(row[key] as string | undefined) ?? ""}
          onChange={(e) =>
            onUpdate({ [key]: e.target.value } as Partial<UserRow>)
          }
        />
      );
  }
}

export default function UsersTabTable({
  rows,
  visibleColumns,
  filterEnabled,
  columnFilters,
  onColumnFilterChange,
  onUpdateRow,
  onRemoveRow,
  onOpenDetails,
  loading,
  totalCount,
  rowRef,
}: Props) {
  const orderedCols = COLUMNS.filter((c) => visibleColumns.has(c.key));

  return (
    <table className={styles.usersTabTable}>
      <thead>
        <tr>
          {orderedCols.map((col) => (
            <th key={col.key}>{col.label}</th>
          ))}
          <th aria-label="Actions" />
        </tr>
        {filterEnabled ? (
          <tr className={styles.usersTabFilterRow}>
            {orderedCols.map((col) => (
              <th key={`${col.key}-filter`}>
                <input
                  type="search"
                  className="form-control"
                  value={columnFilters[col.key] ?? ""}
                  placeholder={`Filter ${col.label.toLowerCase()}…`}
                  onChange={(e) => onColumnFilterChange(col.key, e.target.value)}
                  aria-label={`Filter by ${col.label}`}
                />
              </th>
            ))}
            <th aria-hidden="true" />
          </tr>
        ) : null}
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={orderedCols.length + 1}
              className={styles.usersTabEmptyRow}
            >
              {loading
                ? "Loading users…"
                : totalCount === 0
                  ? "No users yet. Click Add user to start."
                  : "No users match the current filter."}
            </td>
          </tr>
        ) : (
          rows.map((row, idx) => (
            <tr
              key={`row-${row.username}`}
              ref={idx === 0 ? rowRef : undefined}
            >
              {orderedCols.map((col) => (
                <td key={col.key}>
                  {inputForColumn(row, col.key, (patch) => onUpdateRow(row, patch))}
                </td>
              ))}
              <td className={styles.usersTabRowActions}>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => onOpenDetails(row)}
                  title="Edit detailed fields"
                >
                  <i className="fa-solid fa-sliders" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled} ${styles.smallButtonDanger}`}
                  onClick={() => onRemoveRow(row)}
                  title="Remove this user"
                >
                  <i className="fa-solid fa-trash" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
