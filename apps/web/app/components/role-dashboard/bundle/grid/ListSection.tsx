import type { CSSProperties, MutableRefObject, ReactNode } from "react";
import BundleDetailsModal from "../DetailsModal";
import EnableDropdown from "../../EnableDropdown";
import styles from "../../styles";
import { bundleLogo, targetStatusStyle } from "../visuals";
import type { BundleEntry } from "../types";
import {
  BUNDLE_LIST_COLUMN_LABEL,
  BUNDLE_OPTIONAL_LIST_COLUMNS,
  type BundleListColumnKey,
  type BundleOptionalListColumnKey,
} from "../list-columns";
import type { Role } from "../types";

type BundleGridListSectionProps = {
  entries: BundleEntry[];
  visibleColumns: BundleListColumnKey[];
  listGridStyle: CSSProperties;
  showTopScrollbar: boolean;
  listScrollRef: MutableRefObject<HTMLDivElement | null>;
  listTopScrollRef: MutableRefObject<HTMLDivElement | null>;
  listTopScrollInnerRef: MutableRefObject<HTMLDivElement | null>;
  toggleColumn: (column: BundleOptionalListColumnKey) => void;
  activeAlias: string;
  activeBundleDetails: BundleEntry | null;
  deselectionFlashBundleIds: Set<string>;
  viewIconSize: number;
  onEnableBundle: (bundle: BundleEntry["bundle"]) => void;
  onDisableBundle: (bundle: BundleEntry["bundle"]) => void;
  clearDeselectionFlash: (bundleId: string) => void;
  triggerDeselectionFlash: (bundleId: string) => void;
  setActiveBundleDetailsId: (bundleId: string | null) => void;
  renderBundleRoleList: (entry: BundleEntry, pageSize: number, compact?: boolean) => ReactNode;
  onOpenRoleDetails?: (role: Role) => void;
};

export default function BundleGridListSection({
  entries,
  visibleColumns,
  listGridStyle,
  showTopScrollbar,
  listScrollRef,
  listTopScrollRef,
  listTopScrollInnerRef,
  toggleColumn,
  activeAlias,
  activeBundleDetails,
  deselectionFlashBundleIds,
  viewIconSize,
  onEnableBundle,
  onDisableBundle,
  clearDeselectionFlash,
  triggerDeselectionFlash,
  setActiveBundleDetailsId,
  renderBundleRoleList,
  onOpenRoleDetails,
}: BundleGridListSectionProps) {
  return (
    <>
      <div className={styles.listRoot}>
        <div className={styles.listStickyBar}>
          <div className={styles.listColumnToolbar}>
            <span className={styles.listColumnToolbarLabel}>Columns</span>
            {BUNDLE_OPTIONAL_LIST_COLUMNS.map((column) => {
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
                      ? `Collapse ${BUNDLE_LIST_COLUMN_LABEL[column]}`
                      : `Expand ${BUNDLE_LIST_COLUMN_LABEL[column]}`
                  }
                >
                  <span>{BUNDLE_LIST_COLUMN_LABEL[column]}</span>
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
                {BUNDLE_LIST_COLUMN_LABEL[column]}
                {column === "bundle" || column === "enabled" ? (
                  <i className="fa-solid fa-lock" aria-hidden="true" />
                ) : null}
              </span>
            ))}
          </div>
          {entries.map((entry) => {
            const { bundle, roleIds, state } = entry;
            const isDeselectionFlashing = deselectionFlashBundleIds.has(bundle.id);
            return (
              <div
                key={bundle.id}
                className={`${styles.listGrid} ${styles.listRow} ${
                  state.enabled ? styles.listRowSelected : styles.listRowDefault
                } ${isDeselectionFlashing ? styles.listRowDeselectedFlash : ""}`}
                style={listGridStyle}
              >
                {visibleColumns.map((column) => {
                  if (column === "bundle") {
                    return (
                      <div key={`${bundle.id}:bundle`} className={styles.listRoleCell}>
                        {bundleLogo(bundle, Math.max(28, viewIconSize - 8), styles)}
                        <div className={styles.listRoleText}>
                          <div className={styles.listRoleName}>{bundle.title}</div>
                          <div className={`text-body-secondary ${styles.listRoleId}`}>
                            {bundle.id}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (column === "target") {
                    return (
                      <span
                        key={`${bundle.id}:target`}
                        className={`${styles.statusBadge} ${styles.listStatusBadge}`}
                        style={targetStatusStyle(bundle.deploy_target)}
                      >
                        {bundle.deploy_target || "bundle"}
                      </span>
                    );
                  }

                  if (column === "description") {
                    return (
                      <div
                        key={`${bundle.id}:description`}
                        className={`text-body-secondary ${styles.listDescription}`}
                      >
                        {bundle.description || "No description provided."}
                      </div>
                    );
                  }

                  if (column === "apps") {
                    return (
                      <div key={`${bundle.id}:apps`} className={styles.bundleListAppsCell}>
                        {renderBundleRoleList(entry, 2, true)}
                      </div>
                    );
                  }

                  if (column === "price") {
                    return (
                      <div key={`${bundle.id}:price`} className={styles.listPriceCell}>
                        <span className={styles.listPriceValue}>{entry.totalPriceLabel}</span>
                        <span className={`${styles.listPriceCaption} ${styles.bundlePerMonthCaption}`}>
                          per month
                        </span>
                      </div>
                    );
                  }

                  if (column === "details") {
                    return (
                      <div key={`${bundle.id}:details`} className={styles.bundleListDetailsCell}>
                        <button
                          type="button"
                          className={styles.bundleListDetailsButton}
                          onClick={() => setActiveBundleDetailsId(bundle.id)}
                          title={`Open details for ${bundle.title}`}
                        >
                          <i className="fa-solid fa-circle-info" aria-hidden="true" />
                          <span>Details</span>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div key={`${bundle.id}:enabled`} className={styles.listPickActions}>
                      <EnableDropdown
                        enabled={state.enabled}
                        compact
                        showPlanField={false}
                        pricingModel="bundle"
                        plans={[{ id: "community", label: "Community" }]}
                        selectedPlanId="community"
                        appCount={Math.max(1, roleIds.length)}
                        contextLabel={`device "${activeAlias}" for bundle "${bundle.title}"`}
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
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <BundleDetailsModal
        bundle={activeBundleDetails?.bundle || null}
        roleRows={activeBundleDetails?.roleRows || []}
        totalPriceLabel={activeBundleDetails?.totalPriceLabel || "€0.00"}
        appsCaption={
          activeBundleDetails
            ? `${activeBundleDetails.state.selectedCount}/${activeBundleDetails.state.totalCount}`
            : "0/0"
        }
        onOpenRoleDetails={onOpenRoleDetails}
        onClose={() => setActiveBundleDetailsId(null)}
      />
    </>
  );
}
