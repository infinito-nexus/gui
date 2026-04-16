import YAML from "yaml";

export const USERS_GROUP_VARS_PATH = "group_vars/all.yml";
const PRICING_USERS_STORAGE_KEY = "infinito.pricing.users.v1";
const PRICING_USERS_UPDATED_EVENT = "infinito:pricing-users-updated";
export const USERNAME_PATTERN = /^[a-z0-9]+$/;

export type WorkspaceUser = {
  username: string;
  firstname: string;
  lastname: string;
  email?: string;
  password?: string;
  uid?: number;
  gid?: number;
  roles?: string[];
  tokens?: Record<string, unknown>;
  authorized_keys?: string[];
  reserved?: boolean;
  description?: string;
};

export type WorkspaceUserForm = {
  username: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  uid: string;
  gid: string;
  roles: string;
  tokens: string;
  authorized_keys: string;
  reserved: "" | "true" | "false";
  description: string;
};

const USER_CSV_HEADERS = [
  "username",
  "firstname",
  "lastname",
  "email",
  "password",
  "uid",
  "gid",
  "roles",
  "tokens",
  "authorized_keys",
  "reserved",
  "description",
];

export function emptyUserForm(): WorkspaceUserForm {
  return {
    username: "",
    firstname: "",
    lastname: "",
    email: "",
    password: "",
    uid: "",
    gid: "",
    roles: "",
    tokens: "",
    authorized_keys: "",
    reserved: "",
    description: "",
  };
}

export function userToForm(user: WorkspaceUser): WorkspaceUserForm {
  const reservedValue: "" | "true" | "false" =
    typeof user.reserved === "boolean"
      ? (String(user.reserved) as "true" | "false")
      : "";
  return {
    username: user.username,
    firstname: user.firstname,
    lastname: user.lastname,
    email: user.email ?? "",
    password: user.password ?? "",
    uid: user.uid !== undefined ? String(user.uid) : "",
    gid: user.gid !== undefined ? String(user.gid) : "",
    roles: user.roles ? user.roles.join(",") : "",
    tokens: user.tokens ? YAML.stringify(user.tokens).trim() : "",
    authorized_keys: user.authorized_keys ? user.authorized_keys.join("\n") : "",
    reserved: reservedValue,
    description: user.description ?? "",
  };
}

export function asTrimmed(value: unknown): string {
  return String(value ?? "").trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseOptionalInt(value: unknown): number | undefined {
  const raw = asTrimmed(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : undefined;
}

export function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.map((entry) => asTrimmed(entry)).filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  const raw = asTrimmed(value);
  if (!raw) return undefined;
  try {
    const parsed = YAML.parse(raw);
    if (Array.isArray(parsed)) {
      const values = parsed.map((entry) => asTrimmed(entry)).filter(Boolean);
      return values.length > 0 ? values : undefined;
    }
  } catch {
    // fall back to separator parsing
  }
  const values = raw
    .split(/[\n,|]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function parseOptionalObject(
  value: unknown
): Record<string, unknown> | undefined {
  if (isRecord(value)) return { ...value };
  const raw = asTrimmed(value);
  if (!raw) return undefined;
  try {
    const parsed = YAML.parse(raw);
    if (isRecord(parsed)) return parsed;
  } catch {
    // not a valid object
  }
  return undefined;
}

export function normalizeWorkspaceUser(
  value: unknown,
  fallbackUsername?: string
): WorkspaceUser | null {
  if (!isRecord(value)) return null;

  const username = asTrimmed(value.username ?? fallbackUsername).toLowerCase();
  const firstname = asTrimmed(value.firstname);
  const lastname = asTrimmed(value.lastname);
  if (!USERNAME_PATTERN.test(username) || !firstname || !lastname) return null;

  const user: WorkspaceUser = {
    username,
    firstname,
    lastname,
  };

  const email = asTrimmed(value.email);
  if (email) user.email = email;

  const password = asTrimmed(value.password);
  if (password) user.password = password;

  const uid = parseOptionalInt(value.uid);
  if (uid !== undefined) user.uid = uid;

  const gid = parseOptionalInt(value.gid);
  if (gid !== undefined) user.gid = gid;

  const roles = parseStringList(value.roles);
  if (roles?.length) user.roles = roles;

  const tokens = parseOptionalObject(value.tokens);
  if (tokens && Object.keys(tokens).length > 0) {
    user.tokens = tokens;
  }

  const authorizedKeys = parseStringList(
    value.authorized_keys ?? value.authorizedKeys
  );
  if (authorizedKeys?.length) user.authorized_keys = authorizedKeys;

  if (typeof value.reserved === "boolean") {
    user.reserved = value.reserved;
  } else {
    const reservedRaw = asTrimmed(value.reserved).toLowerCase();
    if (reservedRaw === "true") user.reserved = true;
    if (reservedRaw === "false") user.reserved = false;
  }

  const description = asTrimmed(value.description);
  if (description) user.description = description;

  return user;
}

export function dedupeWorkspaceUsers(users: WorkspaceUser[]): WorkspaceUser[] {
  const next = new Map<string, WorkspaceUser>();
  users.forEach((user) => {
    if (!user.username) return;
    if (next.has(user.username)) {
      next.delete(user.username);
    }
    next.set(user.username, user);
  });
  return Array.from(next.values());
}

export function extractWorkspaceUsers(value: unknown): WorkspaceUser[] {
  if (Array.isArray(value)) {
    return dedupeWorkspaceUsers(
      value
        .map((entry) => normalizeWorkspaceUser(entry))
        .filter((entry): entry is WorkspaceUser => Boolean(entry))
    );
  }

  if (!isRecord(value)) return [];

  if ("users" in value) {
    return extractWorkspaceUsers(value.users);
  }

  if ("username" in value || "firstname" in value || "lastname" in value) {
    const single = normalizeWorkspaceUser(value);
    return single ? [single] : [];
  }

  const users: WorkspaceUser[] = [];
  Object.entries(value).forEach(([username, entry]) => {
    if (!isRecord(entry)) return;
    const normalized = normalizeWorkspaceUser(
      { ...entry, username: entry.username ?? username },
      username
    );
    if (normalized) users.push(normalized);
  });
  return dedupeWorkspaceUsers(users);
}

export function toYamlUserEntry(user: WorkspaceUser): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    username: user.username,
    firstname: user.firstname,
    lastname: user.lastname,
  };
  if (user.email) entry.email = user.email;
  if (user.password) entry.password = user.password;
  if (user.uid !== undefined) entry.uid = user.uid;
  if (user.gid !== undefined) entry.gid = user.gid;
  if (user.roles && user.roles.length > 0) entry.roles = user.roles;
  if (user.tokens && Object.keys(user.tokens).length > 0) entry.tokens = user.tokens;
  if (user.authorized_keys && user.authorized_keys.length > 0) {
    entry.authorized_keys = user.authorized_keys;
  }
  if (typeof user.reserved === "boolean") entry.reserved = user.reserved;
  if (user.description) entry.description = user.description;
  return entry;
}

export function toYamlUsersMap(
  users: WorkspaceUser[]
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  users.forEach((user) => {
    out[user.username] = toYamlUserEntry(user);
  });
  return out;
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows
    .map((entries) => entries.map((entry) => entry.replace(/^\uFEFF/, "")))
    .filter((entries) => entries.some((entry) => asTrimmed(entry).length > 0));
}

export function parseUsersFromCsv(content: string): WorkspaceUser[] {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) =>
    asTrimmed(header)
      .toLowerCase()
      .replace(/\s+/g, "_")
  );

  const users: WorkspaceUser[] = [];
  rows.slice(1).forEach((cells) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = cells[index] ?? "";
    });

    const user = normalizeWorkspaceUser({
      username: record.username ?? record.user ?? record.login,
      firstname: record.firstname ?? record.first_name,
      lastname: record.lastname ?? record.last_name,
      email: record.email,
      password: record.password,
      uid: record.uid,
      gid: record.gid,
      roles: record.roles,
      tokens: record.tokens,
      authorized_keys:
        record.authorized_keys ?? record.authorizedkeys ?? record.authorized_key,
      reserved: record.reserved,
      description: record.description,
    });
    if (user) users.push(user);
  });

  return dedupeWorkspaceUsers(users);
}

export function usersToCsv(users: WorkspaceUser[]): string {
  const lines: string[] = [USER_CSV_HEADERS.join(",")];
  users.forEach((user) => {
    const row = [
      user.username,
      user.firstname,
      user.lastname,
      user.email ?? "",
      user.password ?? "",
      user.uid ?? "",
      user.gid ?? "",
      user.roles ? JSON.stringify(user.roles) : "",
      user.tokens ? JSON.stringify(user.tokens) : "",
      user.authorized_keys ? JSON.stringify(user.authorized_keys) : "",
      typeof user.reserved === "boolean" ? String(user.reserved) : "",
      user.description ?? "",
    ].map(escapeCsvCell);
    lines.push(row.join(","));
  });
  return lines.join("\n");
}

export function syncPricingUsersStorage(users: WorkspaceUser[]) {
  if (typeof window === "undefined") return;
  const payload = users.map((user) => ({
    username: user.username,
    firstname: user.firstname,
    lastname: user.lastname,
    ...(user.email ? { email: user.email } : {}),
  }));
  window.localStorage.setItem(PRICING_USERS_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event(PRICING_USERS_UPDATED_EVENT));
}
