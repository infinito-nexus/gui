import type { DomainEntry, DomainKind, DomainStatus } from "./types";

export const DEFAULT_PRIMARY_DOMAIN = "localhost";
export const GROUP_VARS_DOMAIN_CATALOG_KEY = "INFINITO_DOMAINS";
export const GROUP_VARS_ALL_PATH = "group_vars/all.yml";

const DOMAIN_STATUSES: ReadonlySet<DomainStatus> = new Set([
  "reserved",
  "ordered",
  "active",
  "disabled",
  "failed",
  "cancelled",
]);

export function normalizeDomainStatus(value: unknown): DomainStatus {
  const raw = String(value || "").trim().toLowerCase();
  return (DOMAIN_STATUSES.has(raw as DomainStatus)
    ? (raw as DomainStatus)
    : "active");
}

export function normalizeDomainName(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeDomainLabel(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

export function isValidDomainToken(value: string): boolean {
  return Boolean(value) && /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

export function isLikelyFqdn(value: string): boolean {
  const normalized = normalizeDomainName(value);
  if (!normalized || normalized.includes(" ") || !normalized.includes(".")) {
    return false;
  }
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-")
  );
}

export function inferDomainKind(value: string): DomainKind {
  const normalized = normalizeDomainName(value);
  if (!normalized || normalized === DEFAULT_PRIMARY_DOMAIN || !normalized.includes(".")) {
    return "local";
  }
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2) return "fqdn";
  return "subdomain";
}

export function buildDomainEntryId(
  kind: DomainKind,
  domain: string,
  parentFqdn: string | null
): string {
  const parentPart = parentFqdn ? `:${parentFqdn}` : "";
  return `${kind}:${domain}${parentPart}`;
}

export function createDefaultDomainEntries(): DomainEntry[] {
  return [
    {
      id: buildDomainEntryId("local", DEFAULT_PRIMARY_DOMAIN, null),
      kind: "local",
      domain: DEFAULT_PRIMARY_DOMAIN,
      parentFqdn: null,
      status: "active",
      statusChangedAt: null,
      orderId: null,
    },
  ];
}

export function buildDomainCatalogPayload(
  entries: DomainEntry[]
): Array<Record<string, string>> {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const row: Record<string, string> = {
      type: entry.kind,
      domain: entry.domain,
      status: entry.status,
    };
    if (entry.kind === "subdomain" && entry.parentFqdn) {
      row.parent_fqdn = entry.parentFqdn;
    }
    if (entry.statusChangedAt) row.status_changed_at = entry.statusChangedAt;
    if (entry.orderId) row.order_id = entry.orderId;
    return row;
  });
}

export function readPrimaryDomainFromGroupVars(data: Record<string, unknown>): string {
  const value = data.DOMAIN_PRIMARY;
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function parseDomainCatalogFromGroupVars(
  data: Record<string, unknown>
): DomainEntry[] {
  const rawCatalog = data[GROUP_VARS_DOMAIN_CATALOG_KEY];
  const rawItems = Array.isArray(rawCatalog) ? rawCatalog : [];
  const staged: Array<{
    kind: DomainKind;
    domain: string;
    parentFqdn: string | null;
    status: DomainStatus;
    statusChangedAt: string | null;
    orderId: string | null;
  }> = [];

  rawItems.forEach((item) => {
    if (typeof item === "string") {
      const domain = normalizeDomainName(item);
      if (!domain) return;
      staged.push({
        kind: inferDomainKind(domain),
        domain,
        parentFqdn: null,
        status: "active",
        statusChangedAt: null,
        orderId: null,
      });
      return;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const node = item as Record<string, unknown>;
    const domain = normalizeDomainName(node.domain ?? node.value ?? node.name);
    if (!domain) return;
    const rawKind = normalizeDomainName(node.type ?? node.kind);
    const kind: DomainKind =
      rawKind === "local" || rawKind === "fqdn" || rawKind === "subdomain"
        ? (rawKind as DomainKind)
        : inferDomainKind(domain);
    const parentFqdn = normalizeDomainName(
      node.parent_fqdn ?? node.parentFqdn ?? node.parent
    );
    const status = normalizeDomainStatus(node.status);
    const statusChangedAtRaw = node.status_changed_at ?? node.statusChangedAt;
    const orderIdRaw = node.order_id ?? node.orderId;
    staged.push({
      kind,
      domain,
      parentFqdn: parentFqdn || null,
      status,
      statusChangedAt:
        typeof statusChangedAtRaw === "string" && statusChangedAtRaw
          ? statusChangedAtRaw
          : null,
      orderId:
        typeof orderIdRaw === "string" && orderIdRaw ? orderIdRaw : null,
    });
  });

  const fallbackPrimary = normalizeDomainName(readPrimaryDomainFromGroupVars(data));
  if (fallbackPrimary) {
    staged.push({
      kind: inferDomainKind(fallbackPrimary),
      domain: fallbackPrimary,
      parentFqdn: null,
      status: "active",
      statusChangedAt: null,
      orderId: null,
    });
  }

  const entries: DomainEntry[] = [];
  const seenDomains = new Set<string>();
  const fqdnDomains = new Set<string>();

  type PushMeta = {
    status?: DomainStatus;
    statusChangedAt?: string | null;
    orderId?: string | null;
  };
  const pushEntry = (
    kind: DomainKind,
    domain: string,
    parentFqdn: string | null = null,
    meta: PushMeta = {}
  ) => {
    const normalizedDomain = normalizeDomainName(domain);
    if (!normalizedDomain || seenDomains.has(normalizedDomain)) return;
    if (kind === "local" && !isValidDomainToken(normalizedDomain)) return;
    if (kind === "fqdn" && !isLikelyFqdn(normalizedDomain)) return;
    const status = meta.status ?? "active";
    const statusChangedAt = meta.statusChangedAt ?? null;
    const orderId = meta.orderId ?? null;
    if (kind === "subdomain") {
      if (!normalizedDomain.includes(".")) return;
      const normalizedParent = normalizeDomainName(
        parentFqdn || normalizedDomain.split(".").slice(1).join(".")
      );
      if (!normalizedParent || !isLikelyFqdn(normalizedParent)) return;
      if (!seenDomains.has(normalizedParent)) {
        pushEntry("fqdn", normalizedParent, null);
      }
      entries.push({
        id: buildDomainEntryId("subdomain", normalizedDomain, normalizedParent),
        kind: "subdomain",
        domain: normalizedDomain,
        parentFqdn: normalizedParent,
        status,
        statusChangedAt,
        orderId,
      });
      seenDomains.add(normalizedDomain);
      return;
    }
    entries.push({
      id: buildDomainEntryId(kind, normalizedDomain, null),
      kind,
      domain: normalizedDomain,
      parentFqdn: null,
      status,
      statusChangedAt,
      orderId,
    });
    seenDomains.add(normalizedDomain);
    if (kind === "fqdn") {
      fqdnDomains.add(normalizedDomain);
    }
  };

  staged.forEach((entry) => {
    const meta: PushMeta = {
      status: entry.status,
      statusChangedAt: entry.statusChangedAt,
      orderId: entry.orderId,
    };
    if (entry.kind === "subdomain") {
      const parentFqdn =
        normalizeDomainName(entry.parentFqdn || "") ||
        normalizeDomainName(entry.domain.split(".").slice(1).join("."));
      if (parentFqdn && !fqdnDomains.has(parentFqdn)) {
        pushEntry("fqdn", parentFqdn, null);
      }
      pushEntry("subdomain", entry.domain, parentFqdn || null, meta);
      return;
    }
    pushEntry(entry.kind, entry.domain, null, meta);
  });

  if (!seenDomains.has(DEFAULT_PRIMARY_DOMAIN)) {
    entries.unshift({
      id: buildDomainEntryId("local", DEFAULT_PRIMARY_DOMAIN, null),
      kind: "local",
      domain: DEFAULT_PRIMARY_DOMAIN,
      parentFqdn: null,
      status: "active",
      statusChangedAt: null,
      orderId: null,
    });
    seenDomains.add(DEFAULT_PRIMARY_DOMAIN);
  }

  const typeOrder: Record<DomainKind, number> = { local: 0, fqdn: 1, subdomain: 2 };
  return entries
    .slice()
    .sort(
      (a, b) =>
        typeOrder[a.kind] - typeOrder[b.kind] ||
        a.domain.localeCompare(b.domain, undefined, { sensitivity: "base" })
    );
}

export function persistServerPrimaryDomain(
  baseUrl: string,
  workspaceId: string,
  alias: string,
  primaryDomain: string | null
): Promise<void> {
  return fetch(`${baseUrl}/api/providers/primary-domain`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      alias,
      primary_domain: primaryDomain,
    }),
  }).then(() => undefined).catch(() => undefined);
}

export async function fetchDomainAvailability(
  baseUrl: string,
  fqdn: string
): Promise<{ available: boolean; note: string } | { error: string }> {
  try {
    const res = await fetch(
      `${baseUrl}/api/providers/domain-availability?domain=${encodeURIComponent(fqdn)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (typeof data?.detail === "string" && data.detail.trim()) {
          detail = data.detail.trim();
        }
      } catch {
        const text = await res.text();
        if (text.trim()) detail = text.trim();
      }
      return { error: detail };
    }
    const data = (await res.json()) as { available?: boolean; note?: string };
    return {
      available: Boolean(data?.available),
      note: String(data?.note || "").trim(),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Domain availability check failed.",
    };
  }
}

export function normalizePrimaryDomainSelection(
  value: unknown,
  entries: DomainEntry[]
): string {
  // Returns empty string when nothing is selected — the UI surfaces a
  // search field in that case rather than auto-falling back to
  // localhost. Existing workspaces with a saved DOMAIN_PRIMARY keep
  // their choice as long as the entry still exists.
  const desired = normalizeDomainName(value);
  if (!desired) return "";
  const lookup = new Map<string, string>();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const domain = normalizeDomainName(entry.domain);
    if (!domain) return;
    if (!lookup.has(domain)) {
      lookup.set(domain, entry.domain);
    }
  });
  return lookup.get(desired) || "";
}
