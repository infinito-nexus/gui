import styles from "./AuditLogsPanel.module.css";

export type AuditLogMode =
  | "all"
  | "writes-only"
  | "auth-only"
  | "deployment-only"
  | "errors-only";

export type AuditLogConfig = {
  workspace_id: string;
  retention_days: number;
  mode: AuditLogMode;
  exclude_health_endpoints: boolean;
};

export type AuditLogEntry = {
  id: number;
  timestamp: string;
  workspace_id?: string | null;
  user: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip: string;
  request_id?: string | null;
  user_agent?: string | null;
};

export type AuditLogEntryList = {
  entries: AuditLogEntry[];
  page: number;
  page_size: number;
  total: number;
};

export type Filters = {
  from: string;
  to: string;
  user: string;
  ip: string;
  q: string;
  status: string;
  method: string;
};

export const DEFAULT_FILTERS: Filters = {
  from: "",
  to: "",
  user: "",
  ip: "",
  q: "",
  status: "",
  method: "",
};

export const DEFAULT_CONFIG: AuditLogConfig = {
  workspace_id: "",
  retention_days: 180,
  mode: "all",
  exclude_health_endpoints: false,
};

export function toDateTimeInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function toIsoFilter(value: string) {
  return value ? new Date(value).toISOString() : "";
}

export function buildQuery(filters: Filters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  if (filters.from) {
    params.set("from", toIsoFilter(filters.from));
  }
  if (filters.to) {
    params.set("to", toIsoFilter(filters.to));
  }
  if (filters.user) {
    params.set("user", filters.user);
  }
  if (filters.ip) {
    params.set("ip", filters.ip);
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.method) {
    params.set("method", filters.method.toUpperCase());
  }
  return params.toString();
}

export function statusClass(status: number) {
  if (status >= 400) {
    return `${styles.status} ${styles.statusError}`;
  }
  if (status >= 200 && status < 300) {
    return `${styles.status} ${styles.statusSuccess}`;
  }
  return styles.status;
}
