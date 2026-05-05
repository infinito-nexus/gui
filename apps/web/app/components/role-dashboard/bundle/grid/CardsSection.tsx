import type { CSSProperties, ReactNode } from "react";
import EnableDropdown from "../../EnableDropdown";
import styles from "../../styles";
import { bundleLogo, targetStatusStyle } from "../visuals";
import type { BundleEntry } from "../types";
import type { ViewConfig, ViewMode } from "../types";

type BundleGridCardsSectionProps = {
  entries: BundleEntry[];
  viewMode: ViewMode;
  viewConfig: ViewConfig;
  activeAlias: string;
  deselectionFlashBundleIds: Set<string>;
  hoveredBundleId: string | null;
  setHoveredBundleId: (bundleId: string | null) => void;
  toggleBundle: (entry: BundleEntry) => void;
  setActiveBundleDetailsId: (bundleId: string) => void;
  onEnableBundle: (bundle: BundleEntry["bundle"]) => void;
  onDisableBundle: (bundle: BundleEntry["bundle"]) => void;
  clearDeselectionFlash: (bundleId: string) => void;
  triggerDeselectionFlash: (bundleId: string) => void;
  renderBundleRoleList: (entry: BundleEntry, pageSize: number, compact?: boolean) => ReactNode;
};

export default function BundleGridCardsSection({
  entries,
  viewMode,
  viewConfig,
  activeAlias,
  deselectionFlashBundleIds,
  hoveredBundleId,
  setHoveredBundleId,
  toggleBundle,
  setActiveBundleDetailsId,
  onEnableBundle,
  onDisableBundle,
  clearDeselectionFlash,
  triggerDeselectionFlash,
  renderBundleRoleList,
}: BundleGridCardsSectionProps) {
  const isMiniView = viewMode === "mini";
  const isHorizontalView = viewMode === "row" || viewMode === "column";

  return (
    <>
      {entries.map((entry) => {
        const { bundle, roleIds, state } = entry;
        const isDeselectionFlashing = deselectionFlashBundleIds.has(bundle.id);
        const cardHeightStyle = {
          "--role-card-min-height": `${viewConfig.minHeight}px`,
        } as CSSProperties;
        const logo = bundleLogo(bundle, Math.max(38, viewConfig.iconSize), styles);
        const statusStyle = targetStatusStyle(bundle.deploy_target);

        if (isMiniView) {
          const tooltipOpen = hoveredBundleId === bundle.id;
          return (
            <article
              key={bundle.id}
              onMouseEnter={() => setHoveredBundleId(bundle.id)}
              onMouseLeave={() => setHoveredBundleId(null)}
              onFocus={() => setHoveredBundleId(bundle.id)}
              onBlur={() => setHoveredBundleId(null)}
              onClick={() => toggleBundle(entry)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleBundle(entry);
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={state.enabled}
              className={`${styles.cardBase} ${styles.miniCard} ${
                state.enabled ? styles.miniCardSelected : styles.cardDefault
              } ${isDeselectionFlashing ? styles.miniCardDeselectedFlash : ""}`}
              style={cardHeightStyle}
            >
              {logo}
              <div className={styles.miniTitle} title={bundle.title}>
                {bundle.title}
              </div>
              {state.enabled ? (
                <span className={styles.miniSelectedBadge}>
                  <i className="fa-solid fa-check" aria-hidden="true" />
                </span>
              ) : null}
              {tooltipOpen ? (
                <div className={styles.miniTooltip}>
                  <div className={styles.tooltipTitle}>{bundle.title}</div>
                  <span className={styles.statusBadge} style={statusStyle}>
                    {bundle.deploy_target || "bundle"}
                  </span>
                  <div className={`text-body-secondary ${styles.tooltipDescription}`}>
                    {bundle.description || "No description provided."}
                  </div>
                </div>
              ) : null}
            </article>
          );
        }

        if (isHorizontalView) {
          return (
            <article
              key={bundle.id}
              className={`${styles.cardBase} ${styles.horizontalCard} ${
                state.enabled ? styles.cardSelected : styles.cardDefault
              } ${isDeselectionFlashing ? styles.cardDeselectedFlash : ""}`}
              style={cardHeightStyle}
            >
              <div className={styles.horizontalHeader}>
                {logo}
                <div className={styles.roleMetaWrap}>
                  <div className={styles.roleTitleRow}>
                    <h3 className={styles.roleTitle} title={bundle.title}>
                      {bundle.title}
                    </h3>
                    <span className={styles.statusBadge} style={statusStyle}>
                      {bundle.deploy_target || "bundle"}
                    </span>
                  </div>
                  <p className={`text-body-secondary ${styles.roleDescriptionShort}`}>
                    {bundle.description || "No description provided."}
                  </p>
                  <div className={styles.listPriceCell}>
                    <span className={styles.listPriceValue}>{entry.totalPriceLabel}</span>
                    <span className={`${styles.listPriceCaption} ${styles.bundlePerMonthCaption}`}>
                      per month
                    </span>
                  </div>
                </div>
                <div className={styles.roleActionButtons}>
                  <EnableDropdown
                    enabled={state.enabled}
                    compact
                    showPlanField={false}
                    pricingModel="bundle"
                    plans={[{ id: "community", label: "Community" }]}
                    selectedPlanId="community"
                    appCount={Math.max(1, roleIds.length)}
                    contextLabel={`device "${activeAlias}" for bundle "${bundle.title}"`}
                    onOpenDetails={() => setActiveBundleDetailsId(bundle.id)}
                    onEnable={() => {
                      clearDeselectionFlash(bundle.id);
                      onEnableBundle(bundle);
                    }}
                    onDisable={() => {
                      if (!state.enabled) return;
                      onDisableBundle(bundle);
                      triggerDeselectionFlash(bundle.id);
                    }}
                  />
                </div>
              </div>
              <div className={styles.horizontalLinks}>{renderBundleRoleList(entry, 3)}</div>
            </article>
          );
        }

        return (
          <article
            key={bundle.id}
            className={`${styles.cardBase} ${styles.detailCard} ${
              state.enabled ? styles.cardSelected : styles.cardDefault
            } ${isDeselectionFlashing ? styles.cardDeselectedFlash : ""}`}
            style={cardHeightStyle}
          >
            <div className={styles.detailHeader}>
              {logo}
              <div className={styles.detailHeaderMeta}>
                <h3 className={styles.roleTitle} title={bundle.title}>
                  {bundle.title}
                </h3>
                <div className={styles.detailBadgeRow}>
                  <span className={styles.statusBadge} style={statusStyle}>
                    {bundle.deploy_target || "bundle"}
                  </span>
                </div>
              </div>
            </div>

            <p className={styles.roleDescriptionShort}>
              {bundle.description || "No description provided."}
            </p>
            <div className={styles.listPriceCell}>
              <span className={styles.listPriceValue}>{entry.totalPriceLabel}</span>
              <span className={`${styles.listPriceCaption} ${styles.bundlePerMonthCaption}`}>
                per month
              </span>
            </div>

            <div className={styles.detailFooterRow}>
              <div className={styles.detailControlRow}>
                <EnableDropdown
                  enabled={state.enabled}
                  compact
                  showPlanField={false}
                  pricingModel="bundle"
                  plans={[{ id: "community", label: "Community" }]}
                  selectedPlanId="community"
                  appCount={Math.max(1, roleIds.length)}
                  contextLabel={`device "${activeAlias}" for bundle "${bundle.title}"`}
                  onOpenDetails={() => setActiveBundleDetailsId(bundle.id)}
                  onEnable={() => {
                    clearDeselectionFlash(bundle.id);
                    onEnableBundle(bundle);
                  }}
                  onDisable={() => {
                    if (!state.enabled) return;
                    onDisableBundle(bundle);
                    triggerDeselectionFlash(bundle.id);
                  }}
                />
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
}
