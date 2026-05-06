"use client";

import { useEffect, useState, type FocusEvent } from "react";
import styles from "../../../deployment/workspace/Main.module.css";
import {
  COLUMNS,
  isUsernameAvailable,
  isValidEmail,
  isValidUidGid,
  isValidUsername,
  sanitizeIntegerInput,
  sanitizeUsernameInput,
  type ColumnFilters,
  type ColumnKey,
  type ColumnDef,
  type UserRow,
} from "./users-tab-utils";

type Props = {
  rows: UserRow[];
  visibleColumns: ReadonlySet<ColumnKey>;
  filterEnabled: boolean;
  columnFilters: ColumnFilters;
  onColumnFilterChange: (key: ColumnKey, value: string) => void;
  onUpdateRow: (row: UserRow, patch: Partial<UserRow>) => void;
  onRemoveRow: (row: UserRow) => void;
  onOpenDetails: (row: UserRow) => void;
  onCreateUser: (user: UserRow) => void;
  loading: boolean;
  totalCount: number;
  rowRef?: React.RefObject<HTMLTableRowElement>;
  isCustomer?: boolean;
  allRows: UserRow[];
};

function inputClass(invalid: boolean): string {
  return `form-control${invalid ? ` ${styles.formControlInvalid}` : ""}`;
}

// Refuse to release focus while the input is structurally invalid;
// other cells in the row are also disabled by the parent so the user
// has nowhere else to land. requestAnimationFrame waits one tick for
// the browser's blur cycle to settle before refocusing.
function refocusIfInvalid(
  invalid: boolean,
  e: FocusEvent<HTMLInputElement>,
): boolean {
  if (!invalid) return false;
  const target = e.currentTarget;
  requestAnimationFrame(() => target.focus());
  return true;
}

// Always-visible empty row at the bottom of the table that lets the
// user type a new entry directly. The username has the same
// pattern + uniqueness validation as a real row; once everything is
// valid, pressing Enter on any cell commits via onCreate. The
// row-action buttons stay disabled because there's nothing to detail
// or delete yet.
function DraftRow({
  allRows,
  orderedCols,
  onCreate,
  isCustomer,
}: {
  allRows: UserRow[];
  orderedCols: ColumnDef[];
  onCreate: (user: UserRow) => void;
  isCustomer?: boolean;
}) {
  const [draft, setDraft] = useState<UserRow>({
    username: "",
    firstname: "",
    lastname: "",
  });

  const trimmedUsername = draft.username.trim();
  const usernameInvalid =
    !isValidUsername(trimmedUsername) ||
    !isUsernameAvailable(allRows, trimmedUsername, draft);
  const emailInvalid = !isValidEmail(draft.email);
  const uidInvalid = !isValidUidGid(draft.uid);
  const gidInvalid = !isValidUidGid(draft.gid);

  const errors: Partial<Record<ColumnKey, boolean>> = {
    username: usernameInvalid,
    email: emailInvalid,
    uid: uidInvalid,
    gid: gidInvalid,
  };
  const hasError =
    usernameInvalid || emailInvalid || uidInvalid || gidInvalid;
  const cellDisabled = (key: ColumnKey) => hasError && !errors[key];

  const update = (patch: Partial<UserRow>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const tryCommit = () => {
    if (hasError || !trimmedUsername) return;
    const next: UserRow = { ...draft, username: trimmedUsername };
    onCreate(next);
    setDraft({ username: "", firstname: "", lastname: "" });
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryCommit();
    }
  };

  const renderCell = (key: ColumnKey): JSX.Element => {
    const disabled = cellDisabled(key);
    switch (key) {
      case "username":
        return (
          <input
            type="text"
            className={inputClass(usernameInvalid)}
            value={draft.username}
            placeholder="new-user"
            aria-invalid={usernameInvalid ? true : undefined}
            disabled={disabled}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) =>
              update({ username: sanitizeUsernameInput(e.target.value) })
            }
            onKeyDown={onCellKeyDown}
          />
        );
      case "email":
        return (
          <input
            type="email"
            className={inputClass(emailInvalid)}
            value={draft.email ?? ""}
            placeholder="user@example.com"
            aria-invalid={emailInvalid ? true : undefined}
            disabled={disabled}
            onChange={(e) => update({ email: e.target.value })}
            onKeyDown={onCellKeyDown}
          />
        );
      case "uid":
      case "gid": {
        const value = draft[key] as number | undefined;
        const invalid = key === "uid" ? uidInvalid : gidInvalid;
        return (
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            className={inputClass(invalid)}
            value={value ?? ""}
            placeholder={key === "uid" ? "1000" : "1000"}
            aria-invalid={invalid ? true : undefined}
            disabled={disabled}
            onKeyDown={(e) => {
              if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                e.preventDefault();
                return;
              }
              onCellKeyDown(e);
            }}
            onChange={(e) => {
              const v = sanitizeIntegerInput(e.target.value);
              update({ [key]: v === "" ? undefined : Number(v) } as Partial<UserRow>);
            }}
          />
        );
      }
      case "roles":
        return (
          <input
            type="text"
            className="form-control"
            value={(draft.roles ?? []).join(", ")}
            placeholder="admin, devops"
            disabled={disabled}
            onChange={(e) =>
              update({
                roles: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            onKeyDown={onCellKeyDown}
          />
        );
      case "reserved":
        return (
          <input
            type="checkbox"
            checked={Boolean(draft.reserved)}
            disabled={disabled}
            onChange={(e) => update({ reserved: e.target.checked })}
          />
        );
      case "description":
        return (
          <input
            type="text"
            className="form-control"
            value={draft.description ?? ""}
            placeholder="optional"
            disabled={disabled}
            onChange={(e) => update({ description: e.target.value })}
            onKeyDown={onCellKeyDown}
          />
        );
      case "firstname":
        return (
          <input
            type="text"
            className="form-control"
            value={draft.firstname ?? ""}
            placeholder="First"
            disabled={disabled}
            onChange={(e) => update({ firstname: e.target.value })}
            onKeyDown={onCellKeyDown}
          />
        );
      case "lastname":
      default:
        return (
          <input
            type="text"
            className="form-control"
            value={draft.lastname ?? ""}
            placeholder="Last"
            disabled={disabled}
            onChange={(e) => update({ lastname: e.target.value })}
            onKeyDown={onCellKeyDown}
          />
        );
    }
  };

  const draftHint = !trimmedUsername
    ? "Type a username and press Enter to add the user"
    : usernameInvalid
      ? "Fix the username before pressing Enter"
      : "Press Enter to add the user";

  return (
    <tr className={styles.usersTabDraftRow}>
      {orderedCols.map((col) => (
        <td key={col.key}>{renderCell(col.key)}</td>
      ))}
      <td className={styles.usersTabRowActions}>
        {isCustomer ? null : (
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
            disabled
            title={draftHint}
          >
            <i className="fa-solid fa-sliders" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
          onClick={tryCommit}
          disabled={hasError || !trimmedUsername}
          title={draftHint}
          aria-label="Add user"
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function TableRow({
  row,
  rows,
  orderedCols,
  onUpdateRow,
  onRemoveRow,
  onOpenDetails,
  rowRef,
  isCustomer,
}: {
  row: UserRow;
  rows: UserRow[];
  orderedCols: ColumnDef[];
  onUpdateRow: (row: UserRow, patch: Partial<UserRow>) => void;
  onRemoveRow: (row: UserRow) => void;
  onOpenDetails: (row: UserRow) => void;
  rowRef?: React.RefObject<HTMLTableRowElement>;
  isCustomer?: boolean;
}) {
  // Username uses blur-commit semantics — see the blur handler. Other
  // cells commit per-keystroke; their validity is read from row.* and
  // surfaced via aria-invalid + a row-wide lock that disables the
  // siblings until the offender is fixed.
  const [usernameDraft, setUsernameDraft] = useState(row.username);
  useEffect(() => setUsernameDraft(row.username), [row.username]);

  const trimmedUsername = usernameDraft.trim();
  const usernameInvalid =
    !isValidUsername(trimmedUsername) ||
    !isUsernameAvailable(rows, trimmedUsername, row);
  const emailInvalid = !isValidEmail(row.email);
  const uidInvalid = !isValidUidGid(row.uid);
  const gidInvalid = !isValidUidGid(row.gid);

  const errors: Partial<Record<ColumnKey, boolean>> = {
    username: usernameInvalid,
    email: emailInvalid,
    uid: uidInvalid,
    gid: gidInvalid,
  };
  const hasRowError =
    usernameInvalid || emailInvalid || uidInvalid || gidInvalid;
  // A specific cell stays interactive while the row is locked iff the
  // cell itself is the (or one of the) offender(s). Everything else
  // is grayed out so the user is funnelled into fixing the broken
  // value first.
  const cellDisabled = (key: ColumnKey) => hasRowError && !errors[key];

  const renderCell = (key: ColumnKey): JSX.Element => {
    const disabled = cellDisabled(key);
    switch (key) {
      case "username":
        return (
          <input
            type="text"
            className={inputClass(usernameInvalid)}
            value={usernameDraft}
            aria-invalid={usernameInvalid ? true : undefined}
            disabled={disabled}
            inputMode="text"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setUsernameDraft(sanitizeUsernameInput(e.target.value))}
            onBlur={(e) => {
              if (refocusIfInvalid(usernameInvalid, e)) return;
              if (trimmedUsername !== row.username) {
                onUpdateRow(row, { username: trimmedUsername });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="username"
          />
        );
      case "email":
        return (
          <input
            type="email"
            className={inputClass(emailInvalid)}
            value={row.email ?? ""}
            aria-invalid={emailInvalid ? true : undefined}
            disabled={disabled}
            onChange={(e) => onUpdateRow(row, { email: e.target.value })}
            onBlur={(e) => refocusIfInvalid(emailInvalid, e)}
          />
        );
      case "uid":
      case "gid": {
        const value = row[key] as number | undefined;
        const invalid = key === "uid" ? uidInvalid : gidInvalid;
        return (
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            className={inputClass(invalid)}
            value={value ?? ""}
            aria-invalid={invalid ? true : undefined}
            disabled={disabled}
            onKeyDown={(e) => {
              // Native number inputs let "e/E/+/-/.," through even
              // though they'd produce a non-integer; block them so
              // only digits + arrows + editing keys reach the value.
              if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                e.preventDefault();
              }
            }}
            onChange={(e) => {
              const v = sanitizeIntegerInput(e.target.value);
              onUpdateRow(row, {
                [key]: v === "" ? undefined : Number(v),
              } as Partial<UserRow>);
            }}
            onBlur={(e) => refocusIfInvalid(invalid, e)}
          />
        );
      }
      case "roles":
        return (
          <input
            type="text"
            className="form-control"
            value={(row.roles ?? []).join(", ")}
            disabled={disabled}
            onChange={(e) =>
              onUpdateRow(row, {
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
            disabled={disabled}
            onChange={(e) => onUpdateRow(row, { reserved: e.target.checked })}
          />
        );
      case "description":
        return (
          <input
            type="text"
            className="form-control"
            value={row.description ?? ""}
            disabled={disabled}
            onChange={(e) => onUpdateRow(row, { description: e.target.value })}
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
            disabled={disabled}
            onChange={(e) =>
              onUpdateRow(row, { [key]: e.target.value } as Partial<UserRow>)
            }
          />
        );
    }
  };

  return (
    <tr ref={rowRef}>
      {orderedCols.map((col) => (
        <td key={col.key}>{renderCell(col.key)}</td>
      ))}
      <td className={styles.usersTabRowActions}>
        {isCustomer ? null : (
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
            onClick={() => onOpenDetails(row)}
            disabled={hasRowError}
            title={
              hasRowError
                ? "Fix the highlighted field first"
                : "Edit detailed fields"
            }
          >
            <i className="fa-solid fa-sliders" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`${styles.smallButton} ${styles.smallButtonEnabled} ${styles.smallButtonDanger}`}
          onClick={() => onRemoveRow(row)}
          disabled={hasRowError}
          title={
            hasRowError ? "Fix the highlighted field first" : "Remove this user"
          }
        >
          <i className="fa-solid fa-trash" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
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
  onCreateUser,
  loading,
  totalCount,
  rowRef,
  isCustomer = false,
  allRows,
}: Props) {
  const orderedCols = COLUMNS.filter((c) => visibleColumns.has(c.key));

  return (
    <table className={styles.usersTabTable}>
      <thead>
        <tr>
          {orderedCols.map((col) => (
            <th key={col.key}>
              <i className={`fa-solid fa-${col.icon}`} aria-hidden="true" />{" "}
              {col.label}
            </th>
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
        {loading ? (
          <tr>
            <td
              colSpan={orderedCols.length + 1}
              className={styles.usersTabEmptyRow}
            >
              Loading users…
            </td>
          </tr>
        ) : (
          <>
            {totalCount > 0 && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={orderedCols.length + 1}
                  className={styles.usersTabEmptyRow}
                >
                  No users match the current filter.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <TableRow
                  key={`row-${row.username}`}
                  row={row}
                  rows={rows}
                  orderedCols={orderedCols}
                  onUpdateRow={onUpdateRow}
                  onRemoveRow={onRemoveRow}
                  onOpenDetails={onOpenDetails}
                  rowRef={idx === 0 ? rowRef : undefined}
                  isCustomer={isCustomer}
                />
              ))
            )}
            <DraftRow
              allRows={allRows}
              orderedCols={orderedCols}
              onCreate={onCreateUser}
              isCustomer={isCustomer}
            />
          </>
        )}
      </tbody>
    </table>
  );
}
