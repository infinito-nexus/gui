"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../DeploymentWorkspace.module.css";
import type { Role } from "../types";
import OrderItemsTable from "./order/OrderItemsTable";

type Props = {
  baseUrl: string;
  workspaceId: string;
  roles: Role[];
  servers: Array<{ alias: string; host?: string | null; user?: string | null }>;
  selectedRolesByAlias: Record<string, string[]>;
  selectedPlansByAlias: Record<string, Record<string, string | null>>;
};

type WizardStep = "overview" | "form";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

type OrderForm = {
  full_name: string;
  email: string;
  company: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  vat_id: string;
  payment_method: "invoice" | "credit_card" | "bank_transfer";
  terms_accepted: boolean;
  billing_cycle: "monthly" | "yearly";
  notes: string;
};

const EMPTY_FORM: OrderForm = {
  full_name: "",
  email: "",
  company: "",
  phone: "",
  street: "",
  postal_code: "",
  city: "",
  country: "",
  vat_id: "",
  payment_method: "invoice",
  terms_accepted: false,
  billing_cycle: "monthly",
  notes: "",
};

const ORDER_FORM_STORAGE_PREFIX = "infinito.order.draft.";

function loadDraft(workspaceId: string): OrderForm {
  if (typeof window === "undefined") return EMPTY_FORM;
  try {
    const raw = window.localStorage.getItem(
      `${ORDER_FORM_STORAGE_PREFIX}${workspaceId}`,
    );
    if (!raw) return EMPTY_FORM;
    const parsed = JSON.parse(raw) as Partial<OrderForm>;
    return { ...EMPTY_FORM, ...parsed };
  } catch {
    return EMPTY_FORM;
  }
}

function saveDraft(workspaceId: string, form: OrderForm): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `${ORDER_FORM_STORAGE_PREFIX}${workspaceId}`,
    JSON.stringify(form),
  );
}

function findRolePrice(
  role: Role | undefined,
  planId: string | null | undefined,
): { plan: string | null; amount: string | null; currency: string | null } {
  if (!role?.pricing) return { plan: null, amount: null, currency: null };
  const offerings = role.pricing.offerings ?? [];
  const offering = offerings[0];
  if (!offering) return { plan: null, amount: null, currency: null };
  const plans = offering.plans ?? [];
  const matched =
    (planId && plans.find((p) => p.id === planId)) ?? plans[0] ?? null;
  if (!matched) return { plan: null, amount: null, currency: null };
  // The pricing schema is loose; surface label + best-effort
  // `amount` / `currency` if either is present on the matched plan.
  const m = matched as Record<string, unknown>;
  const amount = typeof m.price === "string" ? m.price : null;
  const currency = typeof m.currency === "string" ? m.currency : null;
  return { plan: matched.label || matched.id, amount, currency };
}

export default function OrderTabPanel({
  baseUrl,
  workspaceId,
  roles,
  servers,
  selectedRolesByAlias,
  selectedPlansByAlias,
}: Props): JSX.Element {
  const [step, setStep] = useState<WizardStep>("overview");
  const [form, setForm] = useState<OrderForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(loadDraft(workspaceId));
    setConfirmation(null);
  }, [workspaceId]);

  const updateField = useCallback(
    <K extends keyof OrderForm>(key: K, value: OrderForm[K]) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        saveDraft(workspaceId, next);
        return next;
      });
      setConfirmation(null);
    },
    [workspaceId],
  );

  const rolesById = useMemo(() => {
    const map = new Map<string, Role>();
    for (const r of roles) map.set(r.id, r);
    return map;
  }, [roles]);

  const orderItems = useMemo(() => {
    const items: Array<{
      alias: string;
      role: Role | undefined;
      roleId: string;
      plan: string | null;
      amount: string | null;
      currency: string | null;
    }> = [];
    for (const [alias, roleIds] of Object.entries(selectedRolesByAlias)) {
      const plansForAlias = selectedPlansByAlias[alias] || {};
      for (const roleId of roleIds || []) {
        const role = rolesById.get(roleId);
        const planId = plansForAlias[roleId] ?? null;
        const { plan, amount, currency } = findRolePrice(role, planId);
        items.push({ alias, role, roleId, plan, amount, currency });
      }
    }
    return items;
  }, [rolesById, selectedRolesByAlias, selectedPlansByAlias]);

  const submit = useCallback(async () => {
    setError(null);
    if (!form.full_name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!form.terms_accepted) {
      setError("You must accept the terms before placing the order.");
      return;
    }
    if (orderItems.length === 0) {
      setError(
        "Your cart is empty. Pick at least one app from the Software tab and assign it to a server.",
      );
      return;
    }
    setSubmitting(true);
    const csrf = readCookie("csrf");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (csrf) headers["X-CSRF"] = csrf;
    const body = {
      ...form,
      items: orderItems.map((item) => ({
        alias: item.alias,
        role_id: item.roleId,
        plan_id: null,
        plan_label: item.plan,
        amount: item.amount,
        currency: item.currency,
      })),
    };
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/orders`,
        {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        let detail = "";
        try {
          detail = ((await res.json()) as { detail?: string }).detail || "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { order_id: string };
      setConfirmation(
        `Order ${data.order_id.slice(0, 8)} received. We'll be in touch at ${form.email.trim()} to confirm details and arrange access.`,
      );
      // Reset form draft on success so a follow-up order starts fresh.
      window.localStorage.removeItem(
        `${ORDER_FORM_STORAGE_PREFIX}${workspaceId}`,
      );
    } catch (err) {
      setError(`Failed to place order: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }, [baseUrl, form, orderItems, workspaceId]);

  if (!workspaceId) {
    return (
      <div className={styles.usersTabEmpty}>
        Select a workspace to place an order.
      </div>
    );
  }

  // Two-step wizard: the customer first reviews what's in the cart,
  // then proceeds to the contact + billing form. The Continue button
  // is disabled when the cart is empty so the form can never be
  // reached without something to order.
  if (step === "overview") {
    return (
      <div className={styles.orderTabRoot} data-step="overview">
        <div
          className={`${styles.orderTabSummary} ${styles.orderTabOverviewFull}`}
        >
          <div className={styles.orderTabSummaryHeader}>
            <h3 className={styles.orderTabTitle}>Order overview</h3>
            <span className={`text-body-secondary ${styles.orderTabHint}`}>
              {orderItems.length} item{orderItems.length === 1 ? "" : "s"} ·{" "}
              {servers.length} server{servers.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className={styles.orderTabItemsWrap}>
            <OrderItemsTable items={orderItems} />
          </div>
          <div className={styles.orderTabOverviewActions}>
            <button
              type="button"
              className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
              onClick={() => setStep("form")}
              disabled={orderItems.length === 0}
            >
              <span>Continue to checkout</span>
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.orderTabRoot} data-step="form">
      <div className={styles.orderTabSummary}>
        <div className={styles.orderTabSummaryHeader}>
          <h3 className={styles.orderTabTitle}>Your order</h3>
          <span className={`text-body-secondary ${styles.orderTabHint}`}>
            {orderItems.length} item{orderItems.length === 1 ? "" : "s"} ·{" "}
            {servers.length} server{servers.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className={styles.orderTabItemsWrap}>
          <OrderItemsTable items={orderItems} />
        </div>
      </div>

      <div className={styles.orderTabForm}>
        <div className={styles.orderTabFormSection}>
          <h4 className={styles.orderTabFormTitle}>Contact</h4>
          <div className={styles.orderTabFormGrid}>
            <label className={styles.orderTabField}>
              <span>
                Full name <em>*</em>
              </span>
              <input
                type="text"
                className="form-control"
                value={form.full_name}
                onChange={(e) => updateField("full_name", e.target.value)}
                autoComplete="name"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>
                Email <em>*</em>
              </span>
              <input
                type="email"
                className="form-control"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>Company</span>
              <input
                type="text"
                className="form-control"
                value={form.company}
                onChange={(e) => updateField("company", e.target.value)}
                autoComplete="organization"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>Phone</span>
              <input
                type="tel"
                className="form-control"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                autoComplete="tel"
              />
            </label>
          </div>
        </div>

        <div className={styles.orderTabFormSection}>
          <h4 className={styles.orderTabFormTitle}>Billing address</h4>
          <div className={styles.orderTabFormGrid}>
            <label className={`${styles.orderTabField} ${styles.orderTabFieldFull}`}>
              <span>Street</span>
              <input
                type="text"
                className="form-control"
                value={form.street}
                onChange={(e) => updateField("street", e.target.value)}
                autoComplete="street-address"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>Postal code</span>
              <input
                type="text"
                className="form-control"
                value={form.postal_code}
                onChange={(e) => updateField("postal_code", e.target.value)}
                autoComplete="postal-code"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>City</span>
              <input
                type="text"
                className="form-control"
                value={form.city}
                onChange={(e) => updateField("city", e.target.value)}
                autoComplete="address-level2"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>Country</span>
              <input
                type="text"
                className="form-control"
                value={form.country}
                onChange={(e) => updateField("country", e.target.value)}
                autoComplete="country-name"
              />
            </label>
            <label className={styles.orderTabField}>
              <span>VAT ID</span>
              <input
                type="text"
                className="form-control"
                value={form.vat_id}
                onChange={(e) => updateField("vat_id", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className={styles.orderTabFormSection}>
          <h4 className={styles.orderTabFormTitle}>Billing</h4>
          <div className={styles.orderTabFormGrid}>
            <label className={styles.orderTabField}>
              <span>Cycle</span>
              <select
                className="form-select"
                value={form.billing_cycle}
                onChange={(e) =>
                  updateField(
                    "billing_cycle",
                    e.target.value as OrderForm["billing_cycle"],
                  )
                }
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className={styles.orderTabField}>
              <span>Payment method</span>
              <select
                className="form-select"
                value={form.payment_method}
                onChange={(e) =>
                  updateField(
                    "payment_method",
                    e.target.value as OrderForm["payment_method"],
                  )
                }
              >
                <option value="invoice">Invoice</option>
                <option value="bank_transfer">Bank transfer (SEPA)</option>
                <option value="credit_card">Credit card</option>
              </select>
            </label>
            <label className={`${styles.orderTabField} ${styles.orderTabFieldFull}`}>
              <span>Notes (optional)</span>
              <textarea
                className="form-control"
                rows={3}
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                placeholder="Anything we should know about this order"
              />
            </label>
          </div>
        </div>

        {error ? (
          <p className={`text-danger ${styles.orderTabMessage}`}>{error}</p>
        ) : null}
        {confirmation ? (
          <p className={`text-success ${styles.orderTabMessage}`}>{confirmation}</p>
        ) : null}

        <div className={styles.orderTabSubmitRow}>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
            onClick={() => setStep("overview")}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            <span>Back to overview</span>
          </button>
          <label className={styles.orderTabCheckbox}>
            <input
              type="checkbox"
              checked={form.terms_accepted}
              onChange={(e) => updateField("terms_accepted", e.target.checked)}
            />
            <span>
              I accept the terms of service and confirm the order details
              above are correct.
            </span>
          </label>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled} ${styles.orderTabPlaceOrder}`}
            onClick={() => void submit()}
            disabled={submitting}
          >
            <i className="fa-solid fa-cart-shopping" aria-hidden="true" />
            <span>{submitting ? "Submitting…" : "Place order"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
