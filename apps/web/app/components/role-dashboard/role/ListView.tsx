"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { colorForStatus, displayTargets } from "../helpers";
import EnableDropdown from "../EnableDropdown";
import RoleLogoView from "./LogoView";
import RoleQuickLinks from "./QuickLinks";
import styles from "../styles";
import type { Role } from "../types";
import { formatMonthlyPrice } from "../formatting";
import {
  LIST_COLUMN_GAP_PX,
  LIST_COLUMN_LABEL,
  LIST_COLUMN_MIN_WIDTH,
  LIST_COLUMN_ORDER,
  LIST_COLUMN_TEMPLATE,
  OPTIONAL_LIST_COLUMNS,
  collapseEmojiForRole,
  type ListColumnKey,
  type OptionalListColumnKey,
} from "../role-list-columns";
import useDeselectionFlash from "../useDeselectionFlash";
import useSyncedTopScrollbar from "../useSyncedTopScrollbar";

export type { OptionalListColumnKey } from "../role-list-columns";
export { OPTIONAL_LIST_COLUMNS } from "../role-list-columns";

type RoleListViewProps = {
  baseUrl?: string;
  roles: Role[];
  selected: Set<string>;
  iconSize: number;
  onToggleSelected: (id: string) => void;
  roleServerCountByRole?: Record<string, number>;
  rolePlans?: Record<string, { id: string; label: string }[]>;
  selectedPlanByRole?: Record<string, string | null>;
  onSelectRolePlan?: (roleId: string, planId: string | null) => void;
  onOpenVideo: (url: string, title: string) => void;
  forcedOpenColumns: OptionalListColumnKey[];
  forcedClosedColumns: OptionalListColumnKey[];
  onListColumnsChange: (payload: {
    open: OptionalListColumnKey[];
    closed: OptionalListColumnKey[];
  }) => void;
};

export default function RoleListView({
  baseUrl,
  roles,
  selected,
  iconSize,
  onToggleSelected,
  roleServerCountByRole,
  rolePlans,
  selectedPlanByRole,
  onSelectRolePlan,
  onOpenVideo,
  forcedOpenColumns,
  forcedClosedColumns,
  onListColumnsChange,
}: RoleListViewProps) {
  const [expandedTitleIds, setExpandedTitleIds] = useState<Set<string>>(new Set());
  const { flashingIds, clearDeselectionFlash, triggerDeselectionFlash } =
    useDeselectionFlash(3000);
  const {
    listScrollRef,
    listTopScrollRef,
    listTopScrollInnerRef,
    containerWidth,
    showTopScrollbar,
    syncTopScrollbarMetrics,
  } = useSyncedTopScrollbar();

  const forcedOpenColumnSet = useMemo(
    () => new Set<OptionalListColumnKey>(forcedOpenColumns),
    [forcedOpenColumns]
  );
  const forcedClosedColumnSet = useMemo(
    () => new Set<OptionalListColumnKey>(forcedClosedColumns),
    [forcedClosedColumns]
  );

  const toggleTitleExpansion = (roleId: string) => {
    setExpandedTitleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) {
        next.delete(roleId);
      } else {
        next.add(roleId);
      }
      return next;
    });
  };

  const visibleColumns = useMemo(() => {
    const visible = new Set<ListColumnKey>(["software", "enabled"]);
    let usedWidth =
      LIST_COLUMN_MIN_WIDTH.software +
      LIST_COLUMN_MIN_WIDTH.enabled +
      LIST_COLUMN_GAP_PX;

    OPTIONAL_LIST_COLUMNS.forEach((column) => {
      if (forcedClosedColumnSet.has(column)) return;

      const minWidth = LIST_COLUMN_MIN_WIDTH[column];
      const isForcedOpen = forcedOpenColumnSet.has(column);
      const fitsByDefault =
        containerWidth > 0
          ? usedWidth + LIST_COLUMN_GAP_PX + minWidth <= containerWidth
          : false;

      if (!isForcedOpen && !fitsByDefault) return;

      visible.add(column);
      usedWidth += LIST_COLUMN_GAP_PX + minWidth;
    });

    return LIST_COLUMN_ORDER.filter((column) => visible.has(column));
  }, [containerWidth, forcedOpenColumnSet, forcedClosedColumnSet]);

  const listGridStyle = useMemo(() => {
    const minWidth =
      visibleColumns.reduce((sum, column) => sum + LIST_COLUMN_MIN_WIDTH[column], 0) +
      Math.max(0, visibleColumns.length - 1) * LIST_COLUMN_GAP_PX;
    return {
      gridTemplateColumns: visibleColumns.map((column) => LIST_COLUMN_TEMPLATE[column]).join(" "),
      width: "100%",
      minWidth: `max(100%, ${minWidth}px)`,
    } as CSSProperties;
  }, [visibleColumns]);

  useEffect(() => {
    syncTopScrollbarMetrics();
  }, [visibleColumns, roles.length, syncTopScrollbarMetrics]);

  const toggleColumn = (column: OptionalListColumnKey) => {
    const isCurrentlyVisible = visibleColumns.includes(column);
    const nextOpen = new Set(forcedOpenColumnSet);
    const nextClosed = new Set(forcedClosedColumnSet);
    if (isCurrentlyVisible) {
      nextOpen.delete(column);
      nextClosed.add(column);
    } else {
      nextClosed.delete(column);
      nextOpen.add(column);
    }

    onListColumnsChange({
      open: OPTIONAL_LIST_COLUMNS.filter((entry) => nextOpen.has(entry)),
      closed: OPTIONAL_LIST_COLUMNS.filter((entry) => nextClosed.has(entry)),
    });
  };

  return (
    <div className={styles.listRoot}>
      <div className={styles.listStickyBar}>
        <div className={styles.listColumnToolbar}>
          <span className={styles.listColumnToolbarLabel}>Columns</span>
          {OPTIONAL_LIST_COLUMNS.map((column) => {
            const visible = visibleColumns.includes(column);
            return (
              <button
                key={column}
                type="button"
                onClick={() => toggleColumn(column)}
                className={`${styles.listColumnToggle} ${
                  visible ? styles.listColumnToggleActive : styles.listColumnToggleCollapsed
                }`}
                aria-pressed={visible}
                title={
                  visible
                    ? `Collapse ${LIST_COLUMN_LABEL[column]}`
                    : `Expand ${LIST_COLUMN_LABEL[column]}`
                }
              >
                <span>{LIST_COLUMN_LABEL[column]}</span>
                <i
                  className={visible ? "fa-solid fa-minus" : "fa-solid fa-plus"}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
        <div
          ref={listTopScrollRef}
          className={`${styles.listTopScrollbar} ${
            showTopScrollbar ? styles.listTopScrollbarVisible : styles.listTopScrollbarHidden
          }`}
          aria-hidden="true"
        >
          <div ref={listTopScrollInnerRef} className={styles.listTopScrollbarInner} />
        </div>
      </div>

      <div ref={listScrollRef} className={styles.listScrollPane}>
        <div className={`${styles.listGrid} ${styles.listHeader}`} style={listGridStyle}>
          {visibleColumns.map((column) => (
            <span key={`header-${column}`} className={styles.listHeaderCell}>
              {LIST_COLUMN_LABEL[column]}
              {column === "software" || column === "enabled" ? (
                <i className="fa-solid fa-lock" aria-hidden="true" />
              ) : null}
            </span>
          ))}
        </div>

        {roles.map((role) => {
          const selectedState = selected.has(role.id);
          const isDeselectionFlashing = flashingIds.has(role.id);
          const roleServerCount = Math.max(
            0,
            Math.floor(Number(roleServerCountByRole?.[role.id] || 0))
          );
          const plans = rolePlans?.[role.id] || [{ id: "community", label: "Community" }];
          const fallbackPlanId =
            plans.find((plan) => plan.id === "community")?.id ?? plans[0]?.id ?? "community";
          const selectedPlanId = selectedPlanByRole?.[role.id] ?? fallbackPlanId;
          const selectedPlanLabel =
            plans.find((plan) => plan.id === selectedPlanId)?.label ??
            plans.find((plan) => plan.id === fallbackPlanId)?.label ??
            "Community";
          const monthlyPriceLabel = formatMonthlyPrice(Math.max(1, roleServerCount));

          const name = String(role.display_name || "").trim();
          const collapsedByLength = name.length > 30;
          const expanded = expandedTitleIds.has(role.id);
          const collapseName = collapsedByLength && !expanded;
          const collapseEmoji = collapseEmojiForRole(role);
          const statusColors = colorForStatus(role.status);
          const statusStyle = {
            "--status-bg": statusColors.bg,
            "--status-fg": statusColors.fg,
            "--status-border": statusColors.border,
          } as CSSProperties;

          return (
            <div
              key={role.id}
              data-role-id={role.id}
              data-testid="role-tile"
              className={`${styles.listGrid} ${styles.listRow} ${
                selectedState ? styles.listRowSelected : styles.listRowDefault
              } ${isDeselectionFlashing ? styles.listRowDeselectedFlash : ""}`}
              style={listGridStyle}
            >
              {visibleColumns.map((column) => {
                if (column === "software") {
                  return (
                    <div key={`${role.id}:software`} className={styles.listRoleCell}>
                      <RoleLogoView role={role} size={iconSize} />
                      <div className={styles.listRoleText}>
                        {collapseName ? (
                          <button
                            type="button"
                            onClick={() => toggleTitleExpansion(role.id)}
                            className={styles.listRoleExpandButton}
                            title={name}
                            aria-label={`Expand title for ${name}`}
                          >
                            <span aria-hidden="true">{collapseEmoji}</span>
                          </button>
                        ) : collapsedByLength ? (
                          <button
                            type="button"
                            onClick={() => toggleTitleExpansion(role.id)}
                            className={styles.listRoleExpandedButton}
                            title="Collapse title"
                            aria-label={`Collapse title for ${name}`}
                          >
                            <span className={styles.listRoleNameExpanded}>{name}</span>
                            <span aria-hidden="true">🔽</span>
                          </button>
                        ) : (
                          <div className={styles.listRoleName}>{name}</div>
                        )}
                      </div>
                    </div>
                  );
                }

                if (column === "version") {
                  return (
                    <div key={`${role.id}:version`} className={styles.listVersionCell}>
                      <span className={styles.detailPlanBadge}>{selectedPlanLabel}</span>
                    </div>
                  );
                }

                if (column === "status") {
                  return (
                    <span
                      key={`${role.id}:status`}
                      className={`${styles.statusBadge} ${styles.listStatusBadge}`}
                      style={statusStyle}
                    >
                      {role.status}
                    </span>
                  );
                }

                if (column === "targets") {
                  return (
                    <div key={`${role.id}:targets`} className={styles.targetList}>
                      {displayTargets(role.deployment_targets ?? []).map((target) => (
                        <span key={`${role.id}-${target}`} className={styles.targetBadgeTiny}>
                          {target}
                        </span>
                      ))}
                    </div>
                  );
                }

                if (column === "description") {
                  return (
                    <div
                      key={`${role.id}:description`}
                      className={`text-body-secondary ${styles.listDescription}`}
                    >
                      {role.description || "No description provided."}
                    </div>
                  );
                }

                if (column === "links") {
                  return (
                    <div key={`${role.id}:links`} className={styles.horizontalLinks}>
                      <RoleQuickLinks role={role} onOpenVideo={onOpenVideo} />
                    </div>
                  );
                }

                if (column === "price") {
                  return (
                    <div key={`${role.id}:price`} className={styles.listPriceCell}>
                      <span className={styles.listPriceValue}>{monthlyPriceLabel}</span>
                      <span className={styles.listPriceCaption}>per month</span>
                    </div>
                  );
                }

                return (
                  <div key={`${role.id}:enabled`} className={styles.listPickActions}>
                    <EnableDropdown
                      enabled={selectedState}
                      compact
                      showPlanField={false}
                      pricingModel="app"
                      plans={plans}
                      selectedPlanId={selectedPlanId}
                      onSelectPlan={(planId) => {
                        onSelectRolePlan?.(role.id, planId);
                        if (selectedState && !planId) {
                          triggerDeselectionFlash(role.id);
                          return;
                        }
                        if (planId) clearDeselectionFlash(role.id);
                      }}
                      roleId={role.id}
                      pricing={role.pricing || null}
                      pricingSummary={role.pricing_summary || null}
                      baseUrl={baseUrl}
                      serverCount={roleServerCount}
                      appCount={1}
                      onEnable={() => {
                        clearDeselectionFlash(role.id);
                        if (!selectedState) onToggleSelected(role.id);
                      }}
                      onDisable={() => {
                        if (selectedState) {
                          onToggleSelected(role.id);
                          triggerDeselectionFlash(role.id);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
