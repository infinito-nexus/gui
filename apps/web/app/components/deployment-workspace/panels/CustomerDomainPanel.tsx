"use client";

// Customer-mode counterpart of the Expert DomainPanel: workspace
// domains are listed read-only with a status badge and a small set of
// lifecycle buttons (Order/Release/Disable/Enable/Retry/Remove). No
// "Add new", no type filter, no "Add subdomain" — those live in the
// Expert view.

import { useCallback, useState } from "react";
import styles from "../../deployment/workspace/Main.module.css";
import {
  DEFAULT_PRIMARY_DOMAIN,
  normalizeDomainName,
} from "../domain-utils";
import type { DomainEntry, DomainStatus } from "../types";
import { DomainStatusBadge } from "./domain/DomainStatusBadge";
import { transitionDomainStatus } from "./domain/domainStatusClient";

type Props = {
  baseUrl: string;
  workspaceId: string;
  entries: DomainEntry[];
  devicesByDomain: Map<string, string[]>;
  primaryDomainDraft: string;
  onSelectPrimaryDomain: (domain: string) => void;
  onRemoveDomain: (domain: string) => void;
  onStatusChanged: (
    domain: string,
    next: DomainStatus,
    statusChangedAt: string | null
  ) => void;
  onAddReservedDomain: (
    fqdn: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  isAdministrator: boolean;
};

type ActionDescriptor = {
  label: string;
  next: DomainStatus;
  icon: string;
  adminOnly?: boolean;
};

function actionsFor(status: DomainStatus): ActionDescriptor[] {
  switch (status) {
    case "reserved":
      return [{ label: "Order now", next: "ordered", icon: "fa-cart-shopping" }];
    case "ordered":
      return [
        { label: "Mark active", next: "active", icon: "fa-circle-check", adminOnly: true },
        { label: "Mark failed", next: "failed", icon: "fa-triangle-exclamation", adminOnly: true },
        { label: "Cancel order", next: "cancelled", icon: "fa-ban" },
      ];
    case "active":
      return [{ label: "Disable", next: "disabled", icon: "fa-power-off" }];
    case "disabled":
      return [{ label: "Enable", next: "active", icon: "fa-play" }];
    case "failed":
      return [
        { label: "Retry", next: "ordered", icon: "fa-rotate-right", adminOnly: true },
        { label: "Cancel order", next: "cancelled", icon: "fa-ban" },
      ];
    default:
      return [];
  }
}

export default function CustomerDomainPanel({
  baseUrl,
  workspaceId,
  entries,
  devicesByDomain,
  primaryDomainDraft,
  onSelectPrimaryDomain,
  onRemoveDomain,
  onStatusChanged,
  onAddReservedDomain,
  isAdministrator,
}: Props) {
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSubmitSearch = useCallback(async () => {
    if (!searchValue.trim()) return;
    setSearchBusy(true);
    setSearchError(null);
    const result = await onAddReservedDomain(searchValue);
    if (!result.ok) {
      setSearchError(result.error);
    } else {
      setSearchValue("");
    }
    setSearchBusy(false);
  }, [searchValue, onAddReservedDomain]);

  const handleTransition = useCallback(
    async (domain: string, next: DomainStatus) => {
      if (!workspaceId) return;
      setBusyDomain(domain);
      setError(null);
      try {
        const result = await transitionDomainStatus({
          baseUrl,
          workspaceId,
          domain,
          next,
        });
        onStatusChanged(
          result.domain,
          result.status,
          result.status_changed_at ?? null
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyDomain(null);
      }
    },
    [baseUrl, workspaceId, onStatusChanged]
  );

  return (
    <div className={styles.domainPanel}>
      <div className={styles.domainTableFilters}>
        <input
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSubmitSearch();
            }
          }}
          placeholder="Search a domain to add (e.g. shop.example.org)"
          className={`form-control ${styles.domainFilterInput}`}
        />
        <button
          type="button"
          disabled={searchBusy || !searchValue.trim()}
          onClick={() => void handleSubmitSearch()}
          className={styles.modeActionButton}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          <span>{searchBusy ? "Reserving…" : "Reserve"}</span>
        </button>
      </div>
      {searchError ? (
        <p className={styles.primaryDomainError}>{searchError}</p>
      ) : null}
      {error ? <p className={styles.primaryDomainError}>{error}</p> : null}
      <div className={styles.domainTableWrap}>
        <table className={styles.domainTable}>
          <thead>
            <tr>
              <th>Default</th>
              <th>Domain</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.domainTableEmpty}>
                  No domains for this workspace yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const domainKey = normalizeDomainName(entry.domain);
                const inUse = (devicesByDomain.get(domainKey) || []).length > 0;
                const isLocalhost = domainKey === DEFAULT_PRIMARY_DOMAIN;
                const canRemove =
                  !isLocalhost && !inUse && entry.status === "disabled";
                const removeReason = isLocalhost
                  ? "localhost is required."
                  : inUse
                  ? "Detach all devices first."
                  : entry.status !== "disabled"
                  ? "Disable the domain before removing."
                  : "";
                const actions = actionsFor(entry.status);
                const busy = busyDomain === entry.domain;
                return (
                  <tr key={entry.id}>
                    <td>
                      <input
                        type="radio"
                        name="workspace-primary-domain-radio-customer"
                        checked={
                          normalizeDomainName(primaryDomainDraft) === domainKey
                        }
                        onChange={() => onSelectPrimaryDomain(entry.domain)}
                        aria-label={`Set ${entry.domain} as workspace primary domain`}
                      />
                    </td>
                    <td>
                      <code>{entry.domain}</code>
                    </td>
                    <td>
                      <DomainStatusBadge status={entry.status} />
                    </td>
                    <td>
                      <div className={styles.domainActionRow}>
                        {actions
                          .filter((action) => !action.adminOnly || isAdministrator)
                          .map((action) => (
                            <button
                              key={action.next}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleTransition(entry.domain, action.next)
                              }
                              className={styles.domainActionButton}
                              title={action.label}
                            >
                              <i
                                className={`fa-solid ${action.icon}`}
                                aria-hidden="true"
                              />
                              <span>{busy ? "…" : action.label}</span>
                            </button>
                          ))}
                        <button
                          type="button"
                          onClick={() => onRemoveDomain(entry.domain)}
                          disabled={busy || !canRemove}
                          className={styles.domainRemoveButton}
                          title={canRemove ? "Remove domain" : removeReason}
                        >
                          <i className="fa-solid fa-trash" aria-hidden="true" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
