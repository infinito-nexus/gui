import { useCallback, useState } from "react";
import styles from "../../deployment/workspace/Main.module.css";
import {
  DEFAULT_PRIMARY_DOMAIN,
  normalizeDomainName,
} from "../domain-utils";
import type {
  DomainEntry,
  DomainFilterKind,
  DomainKind,
  DomainStatus,
} from "../types";
import { DomainStatusBadge } from "./domain/DomainStatusBadge";
import { transitionDomainStatus } from "./domain/domainStatusClient";

type DomainPanelProps = {
  filterQuery: string;
  onFilterQueryChange: (value: string) => void;
  filterKind: DomainFilterKind;
  onFilterKindChange: (value: DomainFilterKind) => void;
  onOpenAddDomain: (kind?: DomainKind) => void;
  primaryDomainError: string | null;
  filteredEntries: DomainEntry[];
  allEntries: DomainEntry[];
  devicesByDomain: Map<string, string[]>;
  primaryDomainDraft: string;
  onSelectPrimaryDomain: (domain: string) => void;
  onOpenAddSubdomain: (parentFqdn: string) => void;
  onRemoveDomain: (domain: string) => void;
  onDomainStatusChanged: (
    domain: string,
    status: DomainStatus,
    statusChangedAt: string | null
  ) => void;
  onDetachServerDomain: (alias: string) => void;
  isAdministrator: boolean;
  baseUrl: string;
  workspaceId: string;
};

type TransitionAction = {
  next: DomainStatus;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

const EXPERT_TRANSITIONS: Record<DomainStatus, TransitionAction[]> = {
  reserved: [{ next: "ordered", label: "Order now", icon: "fa-cart-shopping" }],
  ordered: [
    { next: "active", label: "Mark active", icon: "fa-circle-check", adminOnly: true },
    { next: "failed", label: "Mark failed", icon: "fa-triangle-exclamation", adminOnly: true },
    { next: "cancelled", label: "Cancel order", icon: "fa-ban" },
  ],
  active: [{ next: "disabled", label: "Disable", icon: "fa-power-off" }],
  disabled: [{ next: "active", label: "Enable", icon: "fa-play" }],
  failed: [
    { next: "ordered", label: "Retry", icon: "fa-rotate-right", adminOnly: true },
    { next: "cancelled", label: "Cancel order", icon: "fa-ban" },
  ],
  cancelled: [],
};

export default function DomainPanel({
  filterQuery,
  onFilterQueryChange,
  filterKind,
  onFilterKindChange,
  onOpenAddDomain,
  primaryDomainError,
  filteredEntries,
  allEntries,
  devicesByDomain,
  primaryDomainDraft,
  onSelectPrimaryDomain,
  onOpenAddSubdomain,
  onRemoveDomain,
  onDomainStatusChanged,
  onDetachServerDomain,
  isAdministrator,
  baseUrl,
  workspaceId,
}: DomainPanelProps) {
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const handleTransition = useCallback(
    async (domain: string, next: DomainStatus) => {
      if (!workspaceId) return;
      setBusyDomain(domain);
      setStatusError(null);
      try {
        const result = await transitionDomainStatus({
          baseUrl,
          workspaceId,
          domain,
          next,
        });
        onDomainStatusChanged(
          result.domain,
          result.status,
          result.status_changed_at ?? null
        );
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyDomain(null);
      }
    },
    [baseUrl, workspaceId, onDomainStatusChanged]
  );
  return (
    <div className={styles.domainPanel}>
      <div className={styles.domainTableFilters}>
        <input
          value={filterQuery}
          onChange={(event) => onFilterQueryChange(event.target.value)}
          placeholder="Filter domains"
          className={`form-control ${styles.domainFilterInput}`}
        />
        <select
          value={filterKind}
          onChange={(event) => onFilterKindChange(event.target.value as DomainFilterKind)}
          className={`form-select ${styles.domainFilterSelect}`}
        >
          <option value="all">All types</option>
          <option value="local">Local</option>
          <option value="fqdn">FQDN</option>
          <option value="subdomain">Subdomain</option>
        </select>
        <button
          type="button"
          onClick={() => onOpenAddDomain("fqdn")}
          className={styles.modeActionButton}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          <span>Add new</span>
        </button>
      </div>

      {primaryDomainError ? (
        <p className={styles.primaryDomainError}>{primaryDomainError}</p>
      ) : null}
      {statusError ? (
        <p className={styles.primaryDomainError}>{statusError}</p>
      ) : null}

      <div className={styles.domainTableWrap}>
        <table className={styles.domainTable}>
          <thead>
            <tr>
              <th>Default</th>
              <th>Domain</th>
              <th>Type</th>
              <th>Status</th>
              <th>Parent FQDN</th>
              <th>Devices</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.domainTableEmpty}>
                  No domains match the current filter.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => {
                const domainKey = normalizeDomainName(entry.domain);
                const devices = devicesByDomain.get(domainKey) || [];
                const inUse = devices.length > 0;
                const hasChildren = allEntries.some(
                  (item) =>
                    item.kind === "subdomain" &&
                    normalizeDomainName(item.parentFqdn || "") === domainKey
                );
                const isLocalhost = domainKey === DEFAULT_PRIMARY_DOMAIN;
                const canRemove =
                  !isLocalhost &&
                  !hasChildren &&
                  !inUse &&
                  entry.status === "disabled";
                const removeReason = isLocalhost
                  ? "localhost is required."
                  : hasChildren
                  ? "Remove linked subdomains first."
                  : inUse
                  ? "Detach all devices first."
                  : entry.status !== "disabled"
                  ? "Disable the domain before removing."
                  : "";
                const addSubdomainParent =
                  entry.kind === "fqdn"
                    ? normalizeDomainName(entry.domain)
                    : entry.kind === "subdomain"
                    ? normalizeDomainName(entry.parentFqdn || "")
                    : "";
                const addSubdomainBlocked = !addSubdomainParent;
                const addSubdomainTitle = addSubdomainBlocked
                  ? "Subdomains require a FQDN parent."
                  : `Add subdomain under ${addSubdomainParent}`;

                return (
                  <tr key={entry.id}>
                    <td>
                      <input
                        type="radio"
                        name="workspace-primary-domain-radio"
                        checked={normalizeDomainName(primaryDomainDraft) === domainKey}
                        onChange={() => onSelectPrimaryDomain(entry.domain)}
                        aria-label={`Set ${entry.domain} as workspace primary domain`}
                      />
                    </td>
                    <td>
                      <code>{entry.domain}</code>
                    </td>
                    <td>{entry.kind}</td>
                    <td>
                      <DomainStatusBadge status={entry.status} />
                    </td>
                    <td>{entry.parentFqdn ? <code>{entry.parentFqdn}</code> : "-"}</td>
                    <td>
                      {devices.length === 0 ? (
                        <span className={styles.domainTableEmpty}>—</span>
                      ) : (
                        <div className={styles.domainActionRow}>
                          {devices.map((alias) => (
                            <button
                              key={alias}
                              type="button"
                              onClick={() => onDetachServerDomain(alias)}
                              title={`Detach ${entry.domain} from ${alias}`}
                              className={styles.domainActionButton}
                            >
                              <span>{alias}</span>
                              <i className="fa-solid fa-xmark" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className={styles.domainActionRow}>
                        {(EXPERT_TRANSITIONS[entry.status] || [])
                          .filter((action) => !action.adminOnly || isAdministrator)
                          .map((action) => (
                            <button
                              key={action.next}
                              type="button"
                              disabled={busyDomain === entry.domain}
                              onClick={() => handleTransition(entry.domain, action.next)}
                              className={styles.domainActionButton}
                              title={action.label}
                            >
                              <i className={`fa-solid ${action.icon}`} aria-hidden="true" />
                              <span>{action.label}</span>
                            </button>
                          ))}
                        <button
                          type="button"
                          onClick={() => onOpenAddSubdomain(addSubdomainParent)}
                          disabled={addSubdomainBlocked}
                          title={addSubdomainTitle}
                          className={styles.domainActionButton}
                        >
                          <i className="fa-solid fa-sitemap" aria-hidden="true" />
                          <span>Add subdomain</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveDomain(entry.domain)}
                          disabled={!canRemove}
                          title={canRemove ? "Remove domain" : removeReason}
                          className={styles.domainRemoveButton}
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
