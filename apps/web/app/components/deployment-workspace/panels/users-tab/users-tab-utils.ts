import YAML, { Scalar } from "yaml";
import {
  toYamlUserEntry,
  USERNAME_PATTERN,
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
  // Font Awesome icon name (without the "fa-" prefix) shown next to
  // the column label and reused in the detail modal.
  icon: string;
  // Whether this column shows by default; users can toggle the rest
  // on via the Columns picker.
  defaultVisible: boolean;
};

export const COLUMNS: ColumnDef[] = [
  { key: "username", label: "Username", icon: "user", defaultVisible: true },
  { key: "firstname", label: "First name", icon: "id-card", defaultVisible: true },
  { key: "lastname", label: "Last name", icon: "id-card-clip", defaultVisible: true },
  { key: "email", label: "Email", icon: "envelope", defaultVisible: false },
  { key: "uid", label: "UID", icon: "hashtag", defaultVisible: false },
  { key: "gid", label: "GID", icon: "people-group", defaultVisible: false },
  { key: "roles", label: "Roles", icon: "user-shield", defaultVisible: false },
  { key: "description", label: "Description", icon: "align-left", defaultVisible: false },
  { key: "reserved", label: "Reserved", icon: "server", defaultVisible: false },
];

// Customer-mode shows the bare-minimum identity columns and hides
// every advanced control (filter, columns picker, import/export,
// per-row detail). The expert toggle re-enables everything.
export const CUSTOMER_VISIBLE_COLUMNS: ReadonlySet<ColumnKey> = new Set([
  "username",
  "firstname",
  "lastname",
]);

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

// Build the workspace YAML content with vault-encoded passwords
// emitted as `password: !vault |` block scalars. YAML.stringify
// alone would quote the multi-line $ANSIBLE_VAULT body inline, which
// trips the API's plaintext-secret detector — we walk through
// Document API instead to attach the !vault tag explicitly.
export function buildUsersYamlContent(
  doc: Record<string, unknown>,
  rows: UserRow[],
): string {
  const next = { ...doc };
  next.users = rowsToYamlMap(rows);
  const docNode = new YAML.Document(next);
  for (const row of rows) {
    const username = row.username.trim();
    if (!username) continue;
    const pw = row.password ?? "";
    if (typeof pw === "string" && pw.startsWith("$ANSIBLE_VAULT;")) {
      const scalar = new Scalar(pw);
      scalar.tag = "!vault";
      scalar.type = Scalar.BLOCK_LITERAL;
      docNode.setIn(["users", username, "password"], scalar);
    }
  }
  return docNode.toString();
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

// Validation helpers — used by the table cells and detail modal to
// give instant inline feedback. The hard "blocks save" check still
// lives in UsersTabPanel.validateRows; these mirror its rules so the
// red border lights up in real time.

// Mirror the HTML5 email-input pattern (RFC 5322 lite). Rejects
// commas, double dots, and other characters the previous loose
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/ accepted (e.g. "kevin@veen.world.,xyz").
const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function isValidEmail(value: string | undefined | null): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  return EMAIL_PATTERN.test(v);
}

export function isValidUsername(value: string | undefined | null): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  return USERNAME_PATTERN.test(v);
}

export function isUsernameAvailable(
  rows: UserRow[],
  candidate: string,
  currentRow: UserRow,
): boolean {
  const target = candidate.trim();
  if (!target) return true;
  return !rows.some((r) => r !== currentRow && r.username.trim() === target);
}

// UID/GID: any non-negative integer is structurally valid; we warn
// (not block) outside the conventional regular-user range so admins
// can still set system UIDs deliberately.
export function isValidUidGid(value: number | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  return Number.isInteger(value) && value >= 0;
}

// Strip every character that isn't a lowercase letter or digit, and
// downcase capitals on the way through. Used as an onChange filter
// so the username field can never carry an invalid char even
// transiently (the validation pattern is /^[a-z0-9]+$/).
export function sanitizeUsernameInput(raw: string): string {
  return (raw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// UID/GID inputs render as text + inputMode=numeric so we can fully
// own keystroke filtering across browsers. Drop everything that
// isn't a digit, including signs/decimal points/exponent letters
// that <input type=number> would otherwise let through.
export function sanitizeIntegerInput(raw: string): string {
  return (raw || "").replace(/[^\d]/g, "");
}

export type PasswordStatus = "unset" | "vault" | "plaintext";

// Categorize what's currently in row.password. The API rejects any
// plaintext value with key "password" via its plaintext-secret
// detector — we mirror that here so the modal can warn the user
// before the autosave fails.
export function classifyPassword(value: string | undefined | null): PasswordStatus {
  const v = (value ?? "").trim();
  if (!v) return "unset";
  if (v.startsWith("!vault") || v.startsWith("$ANSIBLE_VAULT;") || v.startsWith("{{")) {
    return "vault";
  }
  return "plaintext";
}

export function isConventionalUidGid(value: number | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  return Number.isInteger(value) && value >= 1000 && value <= 60000;
}

export function formatColumnValue(row: UserRow, key: ColumnKey): string {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
