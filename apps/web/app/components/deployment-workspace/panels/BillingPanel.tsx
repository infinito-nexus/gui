import { useEffect, useMemo, useState } from "react";
import styles from "../../deployment/workspace/Main.module.css";
import { parseApiError } from "../helpers";
import type { Role } from "../types";

type BillingPanelProps = {
  baseUrl: string;
  roles: Role[];
  selectedRolesByAlias: Record<string, string[]>;
  selectedPlansByAlias: Record<string, Record<string, string | null>>;
};

const PRICING_USERS_STORAGE_KEY = "infinito.pricing.users.v1";
const PRICING_USERS_UPDATED_EVENT = "infinito:pricing-users-updated";

type PricingQuoteOut = {
  total: number | null;
  currency: string;
  region: string;
  interval: string;
  breakdown?: { setup_fee?: number | null };
  notes?: string[] | null;
  contact_sales?: boolean | null;
};

type BillingRow = {
  key: string;
  item: string;
  quantity: number;
  currency: string;
  unit: number | null;
  recurring: number | null;
  setup: number | null;
  contactSales: boolean;
  note: string | null;
};

type BillingGroup = {
  key: string;
  roleId: string;
  roleLabel: string;
  planId: string;
  planLabel: string;
  offeringId: string;
  currency: string;
  region: string;
  serverCount: number;
};

function asTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function parsePricingUsersCount(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(PRICING_USERS_STORAGE_KEY);
    if (!raw) return 1;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 1;
    const count = parsed.filter((entry) => asTrimmedString((entry as any)?.username)).length;
    return Math.max(1, count);
  } catch {
    return 1;
  }
}

function resolveRolePlan(role: Role | null, selectedPlanId: string | null): string {
  const preferred = asTrimmedString(selectedPlanId) || asTrimmedString(role?.pricing?.default_plan_id);
  return preferred || "community";
}

function resolveOfferingId(role: Role | null, planId: string): string {
  const offerings = Array.isArray(role?.pricing?.offerings) ? role?.pricing?.offerings : [];
  const defaultOfferingId = asTrimmedString(role?.pricing?.default_offering_id);
  const defaultOffering =
    offerings.find((offering) => asTrimmedString((offering as any)?.id) === defaultOfferingId) ||
    offerings[0] ||
    null;
  const hasPlan = (offering: any) =>
    Array.isArray(offering?.plans) &&
    offering.plans.some((plan: any) => asTrimmedString(plan?.id) === planId);
  if (defaultOffering && hasPlan(defaultOffering)) {
    return asTrimmedString((defaultOffering as any)?.id) || defaultOfferingId || "default";
  }
  const matching = offerings.find((offering) => hasPlan(offering));
  if (matching) {
    return asTrimmedString((matching as any)?.id) || defaultOfferingId || "default";
  }
  return asTrimmedString((defaultOffering as any)?.id) || defaultOfferingId || "default";
}

function resolvePlanLabel(role: Role | null, planId: string): string {
  const offerings = Array.isArray(role?.pricing?.offerings) ? role?.pricing?.offerings : [];
  for (const offering of offerings) {
    const plans = Array.isArray((offering as any)?.plans) ? (offering as any).plans : [];
    const match = plans.find((plan: any) => asTrimmedString(plan?.id) === planId);
    if (match) {
      return asTrimmedString(match?.label) || planId;
    }
  }
  return planId;
}

function resolveCurrency(role: Role | null): string {
  const currencies = Array.isArray(role?.pricing_summary?.currencies) ? role?.pricing_summary?.currencies : [];
  const normalized = currencies.map((cur) => asTrimmedString(cur).toUpperCase()).filter(Boolean);
  if (normalized.includes("EUR")) return "EUR";
  return normalized[0] || "EUR";
}

function resolveRegion(role: Role | null): string {
  const regions = Array.isArray(role?.pricing_summary?.regions) ? role?.pricing_summary?.regions : [];
  const normalized = regions.map((region) => asTrimmedString(region).toLowerCase()).filter(Boolean);
  if (normalized.includes("global")) return "global";
  return normalized[0] || "global";
}

function toBillingRow(
  group: BillingGroup,
  result: { quote?: PricingQuoteOut; error?: string }
): BillingRow {
  const quote = result.quote;
  const fallbackCurrency = asTrimmedString(group.currency || quote?.currency || "EUR").toUpperCase() || "EUR";
  if (result.error) {
    return {
      key: group.key,
      item: group.roleLabel,
      quantity: group.serverCount,
      currency: fallbackCurrency,
      unit: null,
      recurring: null,
      setup: null,
      contactSales: false,
      note: result.error,
    };
  }
  const contactSales = Boolean(quote?.contact_sales) || quote?.total === null;
  if (contactSales) {
    const note =
      Array.isArray(quote?.notes) && quote.notes.length > 0
        ? quote.notes.join(" ")
        : "Contact sales for pricing.";
    return {
      key: group.key,
      item: group.roleLabel,
      quantity: group.serverCount,
      currency: fallbackCurrency,
      unit: null,
      recurring: null,
      setup: null,
      contactSales: true,
      note,
    };
  }
  const total = Number(quote?.total ?? 0);
  const setupFee = Number(quote?.breakdown?.setup_fee ?? 0);
  const interval = asTrimmedString(quote?.interval).toLowerCase() || "month";
  const recurring = total - setupFee;
  const recurringMonthly =
    interval === "year" ? recurring / 12 : interval === "once" ? 0 : recurring;
  const setupOnce = interval === "once" ? total : setupFee;
  const qty = Math.max(1, group.serverCount);
  const unit = recurringMonthly / qty;
  return {
    key: group.key,
    item: group.roleLabel,
    quantity: group.serverCount,
    currency: fallbackCurrency,
    unit,
    recurring: recurringMonthly,
    setup: setupOnce,
    contactSales: false,
    note: null,
  };
}

export default function BillingPanel({
  baseUrl,
  roles,
  selectedRolesByAlias,
  selectedPlansByAlias,
}: BillingPanelProps) {
  const [pricingUsersCount, setPricingUsersCount] = useState(1);
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPricingUsersCount(parsePricingUsersCount());
    if (typeof window === "undefined") return;
    const sync = () => setPricingUsersCount(parsePricingUsersCount());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== PRICING_USERS_STORAGE_KEY) return;
      sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PRICING_USERS_UPDATED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PRICING_USERS_UPDATED_EVENT, sync);
    };
  }, []);

  const groups = useMemo(() => {
    const roleLookup = new Map<string, Role>();
    roles.forEach((role) => {
      const roleId = asTrimmedString(role?.id);
      if (!roleId) return;
      roleLookup.set(roleId, role);
    });

    const grouped = new Map<string, BillingGroup>();
    Object.entries(selectedRolesByAlias || {}).forEach(([aliasRaw, roleIdsRaw]) => {
      const alias = asTrimmedString(aliasRaw);
      if (!alias) return;
      const roleIds = Array.isArray(roleIdsRaw) ? roleIdsRaw : [];
      roleIds
        .map((roleId) => asTrimmedString(roleId))
        .filter(Boolean)
        .forEach((roleId) => {
          const role = roleLookup.get(roleId) || null;
          const selectedPlanId = selectedPlansByAlias?.[alias]?.[roleId] ?? null;
          const planId = resolveRolePlan(role, selectedPlanId);
          const offeringId = resolveOfferingId(role, planId);
          const currency = resolveCurrency(role);
          const region = resolveRegion(role);
          const planLabel = resolvePlanLabel(role, planId);
          const roleLabel =
            role?.display_name
              ? `${role.display_name} · ${planLabel}`
              : `${roleId} · ${planLabel}`;
          const groupKey = `${roleId}::${offeringId}::${planId}::${currency}::${region}`;
          const existing = grouped.get(groupKey);
          if (existing) {
            existing.serverCount += 1;
            return;
          }
          grouped.set(groupKey, {
            key: groupKey,
            roleId,
            roleLabel,
            planId,
            planLabel,
            offeringId,
            currency,
            region,
            serverCount: 1,
          });
        });
    });

    const out = Array.from(grouped.values());
    out.sort((a, b) => a.roleLabel.localeCompare(b.roleLabel));
    return out;
  }, [roles, selectedRolesByAlias, selectedPlansByAlias]);

  useEffect(() => {
    let cancelled = false;
    const fetchQuotes = async () => {
      if (groups.length === 0) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          groups.map(async (group) => {
            try {
              const payload = {
                role_id: group.roleId,
                offering_id: group.offeringId,
                plan_id: group.planId,
                inputs: {
                  users: asPositiveInt(pricingUsersCount, 1) || 1,
                  servers: asPositiveInt(group.serverCount, 1) || 1,
                  devices: asPositiveInt(group.serverCount, 1) || 1,
                  nodes: asPositiveInt(group.serverCount, 1) || 1,
                  instances: asPositiveInt(group.serverCount, 1) || 1,
                },
                currency: group.currency,
                region: group.region,
                include_setup_fee: true,
              };
              const res = await fetch(`${baseUrl}/api/pricing/quote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              if (!res.ok) {
                throw new Error(await parseApiError(res));
              }
              const quote = (await res.json()) as PricingQuoteOut;
              return { group, quote } as const;
            } catch (err: any) {
              return {
                group,
                error: err?.message ?? "failed to quote pricing",
              } as const;
            }
          })
        );
        if (cancelled) return;
        setRows(
          results.map(({ group, ...rest }) => toBillingRow(group, rest))
        );
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? "failed to load pricing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchQuotes();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, groups, pricingUsersCount]);

  const currencyForTotals = useMemo(() => {
    const currencies = new Set(rows.map((row) => row.currency).filter(Boolean));
    if (currencies.size === 1) {
      return Array.from(currencies)[0] || "EUR";
    }
    return null;
  }, [rows]);

  const recurringTotal = useMemo(() => {
    if (!currencyForTotals) return null;
    return rows.reduce((sum, row) => sum + (row.recurring ?? 0), 0);
  }, [rows, currencyForTotals]);

  const setupTotal = useMemo(() => {
    if (!currencyForTotals) return null;
    return rows.reduce((sum, row) => sum + (row.setup ?? 0), 0);
  }, [rows, currencyForTotals]);

  return (
    <div className={styles.billingPanel}>
      <div className={styles.billingTableWrap}>
        <table className={styles.billingTable}>
          <thead>
            <tr>
              <th>Position</th>
              <th>Menge</th>
              <th>Einzelpreis (EUR/Monat)</th>
              <th>Laufend (EUR/Monat)</th>
              <th>Einmalig (EUR)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.item}</td>
                <td>{row.quantity}</td>
                <td>
                  {row.contactSales ? (
                    <span className="text-body-secondary">Contact sales</span>
                  ) : row.unit == null ? (
                    <span className="text-body-secondary">—</span>
                  ) : (
                    row.unit.toFixed(2)
                  )}
                </td>
                <td>
                  {row.contactSales ? (
                    <span className="text-body-secondary">Contact sales</span>
                  ) : row.recurring == null ? (
                    <span className="text-body-secondary">—</span>
                  ) : (
                    row.recurring.toFixed(2)
                  )}
                </td>
                <td>
                  {row.contactSales ? (
                    <span className="text-body-secondary">Contact sales</span>
                  ) : row.setup == null ? (
                    <span className="text-body-secondary">—</span>
                  ) : (
                    row.setup.toFixed(2)
                  )}
                </td>
              </tr>
            ))}
            {rows.some((row) => row.note) ? (
              <tr>
                <td colSpan={5} className={styles.billingNoteRow}>
                  {rows
                    .filter((row) => row.note)
                    .map((row) => `${row.item}: ${row.note}`)
                    .join(" · ")}
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td>Summe</td>
              <td />
              <td />
              <td>
                {recurringTotal == null ? (
                  <span className="text-body-secondary">—</span>
                ) : (
                  recurringTotal.toFixed(2)
                )}
              </td>
              <td>
                {setupTotal == null ? (
                  <span className="text-body-secondary">—</span>
                ) : (
                  setupTotal.toFixed(2)
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.billingHint}>
        {loading
          ? "Berechne Preise…"
          : error
          ? `Billing konnte nicht geladen werden: ${error}`
          : rows.length === 0
          ? "Keine Apps ausgewaehlt."
          : currencyForTotals
          ? `Basierend auf ${pricingUsersCount} Usern (Waehrung: ${currencyForTotals}).`
          : `Basierend auf ${pricingUsersCount} Usern (gemischte Waehrungen).`}
      </p>
    </div>
  );
}
