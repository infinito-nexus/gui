import YAML from "yaml";
import {
  toYamlUserEntry,
  type WorkspaceUser,
} from "../../../workspace-panel/users-utils";

export const USERS_GROUP_VARS_PATH = "group_vars/all.yml";
export const AUTOSAVE_DEBOUNCE_MS = 500;
export const REMOTE_POLL_MS = 5_000;
export const ROW_HEIGHT_PX = 44;

export type UserRow = WorkspaceUser & {
  // Local-only flag — cleared after the row's first successful save.
  isNew?: boolean;
};

export type SyncState = "idle" | "saving" | "saved" | "error";

export type ColumnKey =
  | "username"
  | "firstname"
  | "lastname"
  | "email"
  | "uid"
  | "gid"
  | "roles"
  | "description"
  | "reserved";

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  // Whether this column shows by default; users can toggle the rest
  // on via the Columns picker.
  defaultVisible: boolean;
};

export const COLUMNS: ColumnDef[] = [
  { key: "username", label: "Username", defaultVisible: true },
  { key: "firstname", label: "First name", defaultVisible: true },
  { key: "lastname", label: "Last name", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "uid", label: "UID", defaultVisible: false },
  { key: "gid", label: "GID", defaultVisible: false },
  { key: "roles", label: "Roles", defaultVisible: false },
  { key: "description", label: "Description", defaultVisible: false },
  { key: "reserved", label: "Reserved", defaultVisible: false },
];

export const FILTER_FIELDS: Array<keyof WorkspaceUser> = [
  "username",
  "firstname",
  "lastname",
  "email",
  "description",
];

export type ColumnFilters = Partial<Record<ColumnKey, string>>;

export function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

/**
 * Walk a parsed YAML doc and pull out every user entry, regardless of
 * whether `users:` is a map (`alice: {...}`) or a list (`- {...}`).
 *
 * Every key the entry carried is preserved verbatim — uid, gid,
 * roles, tokens, authorized_keys, password, reserved, description —
 * so the UI's column set never silently drops fields. The Detail
 * modal exposes the full set; on save we re-emit every key.
 */
export function entryToRow(rawKey: string, rawValue: unknown): UserRow | null {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return null;
  }
  const value = rawValue as Record<string, unknown>;
  const username = String(value.username ?? rawKey ?? "").trim();
  if (!username) return null;

  const row: UserRow = {
    username,
    firstname: String(value.firstname ?? "").trim(),
    lastname: String(value.lastname ?? "").trim(),
  };
  if (typeof value.email === "string") row.email = value.email.trim();
  if (typeof value.password === "string") row.password = value.password;
  if (typeof value.uid === "number") row.uid = value.uid;
  if (typeof value.gid === "number") row.gid = value.gid;
  if (typeof value.description === "string") row.description = value.description;
  if (typeof value.reserved === "boolean") row.reserved = value.reserved;
  if (Array.isArray(value.roles)) {
    row.roles = value.roles.filter((v) => typeof v === "string").map((v) => String(v));
  }
  if (Array.isArray(value.authorized_keys)) {
    row.authorized_keys = value.authorized_keys
      .filter((v) => typeof v === "string")
      .map((v) => String(v));
  }
  if (value.tokens && typeof value.tokens === "object" && !Array.isArray(value.tokens)) {
    row.tokens = value.tokens as Record<string, unknown>;
  }
  return row;
}

export function parseDoc(content: string): {
  doc: Record<string, unknown>;
  rows: UserRow[];
} {
  if (!content.trim()) return { doc: {}, rows: [] };
  let parsed: unknown = {};
  try {
    parsed = YAML.parse(content) ?? {};
  } catch {
    return { doc: {}, rows: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { doc: {}, rows: [] };
  }
  const doc = parsed as Record<string, unknown>;
  const rawUsers = doc.users;
  const rows: UserRow[] = [];
  if (Array.isArray(rawUsers)) {
    for (const entry of rawUsers) {
      const row = entryToRow("", entry);
      if (row) rows.push(row);
    }
  } else if (rawUsers && typeof rawUsers === "object") {
    for (const [key, value] of Object.entries(rawUsers as Record<string, unknown>)) {
      const row = entryToRow(key, value);
      if (row) rows.push(row);
    }
  }
  return { doc, rows };
}

export function rowsToYamlMap(rows: UserRow[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const username = row.username.trim();
    if (!username) continue;
    out[username] = toYamlUserEntry({ ...row, username });
  }
  return out;
}

export function rowsFingerprint(rows: UserRow[]): string {
  // Stable key for "did anything change" comparisons against the
  // remote copy. Using the YAML map output avoids being thrown off
  // by property-order differences within rows.
  return JSON.stringify(rowsToYamlMap(rows));
}

export function downloadBlob(filename: string, mime: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function rowMatchesColumnFilters(
  row: UserRow,
  filters: ColumnFilters,
): boolean {
  for (const [key, raw] of Object.entries(filters)) {
    const q = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!q) continue;
    const value = formatColumnValue(row, key as ColumnKey).toLowerCase();
    if (!value.includes(q)) return false;
  }
  return true;
}

export function formatColumnValue(row: UserRow, key: ColumnKey): string {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
