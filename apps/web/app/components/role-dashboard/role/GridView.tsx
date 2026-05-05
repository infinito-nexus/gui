"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorForStatus, displayTargets } from "../helpers";
import EnableDropdown from "../EnableDropdown";
import RoleLogoView from "./LogoView";
import RoleQuickLinks from "./QuickLinks";
import styles from "../styles";
import type { Role, ViewConfig, ViewMode } from "../types";

type RoleGridViewProps = {
  baseUrl?: string;
  roles: Role[];
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  roleServerCountByRole?: Record<string, number>;
  rolePlans?: Record<string, { id: string; label: string }[]>;
  selectedPlanByRole?: Record<string, string | null>;
  onSelectRolePlan?: (roleId: string, planId: string | null) => void;
  viewMode: ViewMode;
  viewConfig: ViewConfig;
  computedColumns: number;
  gridGap: number;
  onOpenVideo: (url: string, title: string) => void;
  onOpenDetails?: (role: Role) => void;
};

const DESELECTION_FADE_DURATION_MS = 3000;

export default function RoleGridView({
  baseUrl,
  roles,
  selected,
  onToggleSelected,
  roleServerCountByRole,
  rolePlans,
  selectedPlanByRole,
  onSelectRolePlan,
  viewMode,
  viewConfig,
  computedColumns,
  gridGap,
  onOpenVideo,
  onOpenDetails,
}: RoleGridViewProps) {
  const [hoveredRoleId, setHoveredRoleId] = useState<string | null>(null);
  const [pendingMiniDisableRoleId, setPendingMiniDisableRoleId] = useState<string | null>(null);
  const [deselectionFlashRoleIds, setDeselectionFlashRoleIds] = useState<Set<string>>(
    new Set()
  );
  const deselectionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const gridStyle = {
    "--role-grid-columns": computedColumns,
    "--role-grid-row-height": `${viewConfig.minHeight}px`,
    "--role-grid-gap": `${gridGap}px`,
  } as CSSProperties;

  const clearDeselectionFlash = (roleId: string) => {
    const timer = deselectionTimersRef.current[roleId];
    if (timer) {
      clearTimeout(timer);
      delete deselectionTimersRef.current[roleId];
    }
    setDeselectionFlashRoleIds((prev) => {
      if (!prev.has(roleId)) return prev;
      const next = new Set(prev);
      next.delete(roleId);
      return next;
    });
  };

  const triggerDeselectionFlash = (roleId: string) => {
    clearDeselectionFlash(roleId);
    setDeselectionFlashRoleIds((prev) => {
      const next = new Set(prev);
      next.add(roleId);
      return next;
    });
    deselectionTimersRef.current[roleId] = setTimeout(() => {
      setDeselectionFlashRoleIds((prev) => {
        if (!prev.has(roleId)) return prev;
        const next = new Set(prev);
        next.delete(roleId);
        return next;
      });
      delete deselectionTimersRef.current[roleId];
    }, DESELECTION_FADE_DURATION_MS);
  };

  const requestMiniToggle = (roleId: string, selectedState: boolean) => {
    if (!selectedState) {
      clearDeselectionFlash(roleId);
      onToggleSelected(roleId);
      return;
    }
    setPendingMiniDisableRoleId(roleId);
  };

  const pendingMiniDisableRole = useMemo(
    () => roles.find((role) => role.id === pendingMiniDisableRoleId) || null,
    [roles, pendingMiniDisableRoleId]
  );

  const confirmMiniDisable = () => {
    if (!pendingMiniDisableRoleId) return;
    const roleId = pendingMiniDisableRoleId;
    const stillSelected = selected.has(roleId);
    setPendingMiniDisableRoleId(null);
    if (!stillSelected) return;
    onToggleSelected(roleId);
    triggerDeselectionFlash(roleId);
  };

  useEffect(() => {
    return () => {
      Object.values(deselectionTimersRef.current).forEach((timer) => clearTimeout(timer));
      deselectionTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "mini") {
      setPendingMiniDisableRoleId(null);
    }
  }, [viewMode]);

  return (
    <>
      <div className={styles.gridRoot} style={gridStyle}>
        {roles.map((role) => {
          const selectedState = selected.has(role.id);
          const isDeselectionFlashing = deselectionFlashRoleIds.has(role.id);
          const plans = rolePlans?.[role.id] || [{ id: "community", label: "Community" }];
          const fallbackPlanId =
            plans.find((plan) => plan.id === "community")?.id || plans[0]?.id || "community";
          const selectedPlanId = selectedPlanByRole?.[role.id] ?? fallbackPlanId;
          const selectedPlanLabel =
            plans.find((plan) => plan.id === selectedPlanId)?.label || "Community";
          const roleServerCount = Math.max(
            0,
            Math.floor(Number(roleServerCountByRole?.[role.id] || 0))
          );
          const statusColors = colorForStatus(role.status);
          const statusStyle = {
            "--status-bg": statusColors.bg,
            "--status-fg": statusColors.fg,
            "--status-border": statusColors.border,
          } as CSSProperties;
          const cardHeightStyle = {
            "--role-card-min-height": `${viewConfig.minHeight}px`,
          } as CSSProperties;
          const logo = <RoleLogoView role={role} size={viewConfig.iconSize} />;

          if (viewConfig.horizontal) {
            return (
              <article
                key={role.id}
                data-role-id={role.id}
                data-testid="role-tile"
                className={`${styles.cardBase} ${styles.horizontalCard} ${
                  selectedState ? styles.cardSelected : styles.cardDefault
                } ${isDeselectionFlashing ? styles.cardDeselectedFlash : ""}`}
                style={cardHeightStyle}
              >
                <div className={styles.horizontalHeader}>
                  {logo}
                  <div className={styles.roleMetaWrap}>
                    <div className={styles.roleTitleRow}>
                      <h3 className={styles.roleTitle} title={role.display_name}>
                        {role.display_name}
                      </h3>
                      <span className={styles.statusBadge} style={statusStyle}>
                        {role.status}
                      </span>
                    </div>
                    {viewConfig.showDescription ? (
                      <p className={`text-body-secondary ${styles.roleDescriptionShort}`}>
                        {role.description || "No description provided."}
                      </p>
                    ) : null}
                    {viewConfig.showTargets ? (
                      <div className={styles.targetList}>
                        {displayTargets(role.deployment_targets ?? []).map((target) => (
                          <span key={`${role.id}-${target}`} className={styles.targetBadge}>
                            {target}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.roleActionButtons}>
                    <EnableDropdown
                      enabled={selectedState}
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
                </div>

                {viewConfig.showLinks ? (
                  <div className={styles.horizontalLinks}>
                    <RoleQuickLinks role={role} onOpenVideo={onOpenVideo} />
                  </div>
                ) : null}
              </article>
            );
          }

          if (viewMode === "mini") {
            const showTooltip = hoveredRoleId === role.id;
            const targets = displayTargets(role.deployment_targets ?? []);
            return (
              <article
                key={role.id}
                data-role-id={role.id}
                data-testid="role-tile"
                onMouseEnter={() => setHoveredRoleId(role.id)}
                onMouseLeave={() => setHoveredRoleId(null)}
                onFocus={() => setHoveredRoleId(role.id)}
                onBlur={() => setHoveredRoleId(null)}
                onClick={() => requestMiniToggle(role.id, selectedState)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    requestMiniToggle(role.id, selectedState);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-pressed={selectedState}
                className={`${styles.cardBase} ${styles.miniCard} ${
                  selectedState ? styles.miniCardSelected : styles.cardDefault
                } ${isDeselectionFlashing ? styles.miniCardDeselectedFlash : ""}`}
                style={cardHeightStyle}
              >
                {logo}
                <div className={styles.miniTitle} title={role.display_name}>
                  {role.display_name}
                </div>
                {selectedState ? (
                  <span className={styles.miniSelectedBadge}>
                    <i className="fa-solid fa-check" aria-hidden="true" />
                  </span>
                ) : null}
                {showTooltip ? (
                  <div className={styles.miniTooltip}>
                    <div className={styles.tooltipTitle}>{role.display_name}</div>
                    <span className={styles.statusBadge} style={statusStyle}>
                      {role.status}
                    </span>
                    {targets.length > 0 ? (
                      <div className={styles.targetList}>
                        {targets.map((target) => (
                          <span key={`${role.id}-${target}`} className={styles.targetBadgeTiny}>
                            {target}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className={`text-body-secondary ${styles.tooltipDescription}`}>
                      {role.description || "No description provided."}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          }

          return (
            <article
              key={role.id}
              data-role-id={role.id}
              data-testid="role-tile"
              className={`${styles.cardBase} ${styles.detailCard} ${
                selectedState ? styles.cardSelected : styles.cardDefault
              } ${isDeselectionFlashing ? styles.cardDeselectedFlash : ""}`}
              style={cardHeightStyle}
            >
              <div className={styles.detailHeader}>
                {logo}
                <div className={styles.detailHeaderMeta}>
                  <h3 className={styles.roleTitle} title={role.display_name}>
                    {role.display_name}
                  </h3>
                  <div className={styles.detailBadgeRow}>
                    <span className={styles.detailPlanBadge} title={selectedPlanLabel}>
                      {selectedPlanLabel}
                    </span>
                    <span className={styles.statusBadge} style={statusStyle}>
                      {role.status}
                    </span>
                  </div>
                </div>
              </div>

              {viewConfig.showDescription ? (
                <p className={styles.roleDescriptionOneLine}>
                  {role.description || "No description provided."}
                </p>
              ) : null}

              <div className={styles.detailFooterRow}>
                <div className={styles.detailControlRow}>
                  <EnableDropdown
                    enabled={selectedState}
                    variant="tile"
                    tileMeta={
                      <RoleQuickLinks role={role} onOpenVideo={onOpenVideo} adaptiveOverflow />
                    }
                    onOpenDetails={onOpenDetails ? () => onOpenDetails(role) : undefined}
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
              </div>
            </article>
          );
        })}
      </div>

      {pendingMiniDisableRole ? (
        <div
          className={styles.enableConfirmOverlay}
          onClick={() => setPendingMiniDisableRoleId(null)}
        >
          <div className={styles.enableConfirmCard} onClick={(event) => event.stopPropagation()}>
            <h4 className={styles.enableConfirmTitle}>Disable selection?</h4>
            <p className={styles.enableConfirmText}>
              Warning: Disabling will remove this app from the
              current deployment selection.
            </p>
            <p className={styles.enableConfirmText}>
              It will no longer be deployed until you enable it again.
            </p>
            <div className={styles.enableConfirmActions}>
              <button
                type="button"
                onClick={() => setPendingMiniDisableRoleId(null)}
                className={styles.enableCancelButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMiniDisable}
                className={styles.enableDisableButton}
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
