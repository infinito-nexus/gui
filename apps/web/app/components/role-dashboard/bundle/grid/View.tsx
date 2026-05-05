"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import BundleAppList from "../AppList";
import BundleDetailsModal from "../DetailsModal";
import BundleGridCardsSection from "./CardsSection";
import BundleGridListSection from "./ListSection";
import styles from "../../styles";
import type { Bundle, Role, ViewConfig, ViewMode } from "../types";
import type { BundleEntry, BundleState } from "../types";
import { buildBundleEntries } from "../entries";
import {
  BUNDLE_LIST_COLUMN_GAP_PX,
  BUNDLE_LIST_COLUMN_MIN_WIDTH,
  BUNDLE_LIST_COLUMN_ORDER,
  BUNDLE_LIST_COLUMN_TEMPLATE,
  BUNDLE_OPTIONAL_LIST_COLUMNS,
  type BundleListColumnKey,
  type BundleOptionalListColumnKey,
} from "../list-columns";
import useDeselectionFlash from "../../useDeselectionFlash";
import useSyncedTopScrollbar from "../../useSyncedTopScrollbar";

export type { BundleOptionalListColumnKey } from "../list-columns";
export { BUNDLE_OPTIONAL_LIST_COLUMNS } from "../list-columns";

type BundleGridViewProps = {
  bundles: Bundle[];
  viewMode: ViewMode;
  viewConfig: ViewConfig;
  computedColumns: number;
  gridGap: number;
  minHeight: number;
  activeAlias: string;
  bundleStates: Record<string, BundleState>;
  roleById: Record<string, Role>;
  roleServerCountByRole?: Record<string, number>;
  forcedOpenColumns: BundleOptionalListColumnKey[];
  forcedClosedColumns: BundleOptionalListColumnKey[];
  onListColumnsChange: (payload: {
    open: BundleOptionalListColumnKey[];
    closed: BundleOptionalListColumnKey[];
  }) => void;
  onOpenRoleDetails?: (role: Role) => void;
  onEnableBundle: (bundle: Bundle) => void;
  onDisableBundle: (bundle: Bundle) => void;
};

export default function BundleGridView({
  bundles,
  viewMode,
  viewConfig,
  computedColumns,
  gridGap,
  minHeight,
  activeAlias,
  bundleStates,
  roleById,
  roleServerCountByRole,
  forcedOpenColumns,
  forcedClosedColumns,
  onListColumnsChange,
  onOpenRoleDetails,
  onEnableBundle,
  onDisableBundle,
}: BundleGridViewProps) {
  const { flashingIds, clearDeselectionFlash, triggerDeselectionFlash } =
    useDeselectionFlash(3000);
  const [hoveredBundleId, setHoveredBundleId] = useState<string | null>(null);
  const [activeBundleDetailsId, setActiveBundleDetailsId] = useState<string | null>(null);
  const [pendingMiniDisableBundleId, setPendingMiniDisableBundleId] = useState<string | null>(
    null
  );

  const {
    listScrollRef,
    listTopScrollRef,
    listTopScrollInnerRef,
    containerWidth,
    showTopScrollbar,
    syncTopScrollbarMetrics,
  } = useSyncedTopScrollbar();

  const forcedOpenColumnSet = useMemo(
    () => new Set<BundleOptionalListColumnKey>(forcedOpenColumns),
    [forcedOpenColumns]
  );
  const forcedClosedColumnSet = useMemo(
    () => new Set<BundleOptionalListColumnKey>(forcedClosedColumns),
    [forcedClosedColumns]
  );

  const gridStyle = {
    "--role-grid-columns": computedColumns,
    "--role-grid-row-height": `${minHeight}px`,
    "--role-grid-gap": `${gridGap}px`,
  } as CSSProperties;

  const entries = useMemo<BundleEntry[]>(
    () =>
      buildBundleEntries(
        bundles,
        bundleStates,
        roleById,
        roleServerCountByRole
      ),
    [bundles, bundleStates, roleById, roleServerCountByRole]
  );

  const activeBundleDetails = useMemo(
    () => entries.find((entry) => entry.bundle.id === activeBundleDetailsId) || null,
    [entries, activeBundleDetailsId]
  );
  const pendingMiniDisableEntry = useMemo(
    () => entries.find((entry) => entry.bundle.id === pendingMiniDisableBundleId) || null,
    [entries, pendingMiniDisableBundleId]
  );

  const requestMiniDisable = (entry: BundleEntry) => {
    setPendingMiniDisableBundleId(entry.bundle.id);
  };

  const cancelMiniDisable = () => {
    setPendingMiniDisableBundleId(null);
  };

  const confirmMiniDisable = () => {
    if (!pendingMiniDisableEntry) return;
    const { bundle } = pendingMiniDisableEntry;
    setPendingMiniDisableBundleId(null);
    onDisableBundle(bundle);
    triggerDeselectionFlash(bundle.id);
  };

  const toggleBundle = (entry: BundleEntry) => {
    if (entry.state.enabled) {
      requestMiniDisable(entry);
      return;
    }
    setPendingMiniDisableBundleId(null);
    clearDeselectionFlash(entry.bundle.id);
    onEnableBundle(entry.bundle);
  };

  const renderBundleRoleList = (
    entry: BundleEntry,
    pageSize: number,
    compact = false
  ) => (
    <BundleAppList
      bundleId={`${viewMode}:${entry.bundle.id}`}
      rows={entry.roleRows}
      pageSize={pageSize}
      compact={compact}
      onOpenRoleDetails={onOpenRoleDetails}
    />
  );

  useEffect(() => {
    if (!activeBundleDetailsId) return;
    const exists = entries.some((entry) => entry.bundle.id === activeBundleDetailsId);
    if (!exists) setActiveBundleDetailsId(null);
  }, [entries, activeBundleDetailsId]);

  useEffect(() => {
    if (!pendingMiniDisableBundleId) return;
    const exists = entries.some((entry) => entry.bundle.id === pendingMiniDisableBundleId);
    if (!exists) setPendingMiniDisableBundleId(null);
  }, [entries, pendingMiniDisableBundleId]);

  const visibleColumns = useMemo(() => {
    const visible = new Set<BundleListColumnKey>(["bundle", "enabled"]);
    let usedWidth =
      BUNDLE_LIST_COLUMN_MIN_WIDTH.bundle +
      BUNDLE_LIST_COLUMN_MIN_WIDTH.enabled +
      BUNDLE_LIST_COLUMN_GAP_PX;

    BUNDLE_OPTIONAL_LIST_COLUMNS.forEach((column) => {
      if (forcedClosedColumnSet.has(column)) return;

      const minWidth = BUNDLE_LIST_COLUMN_MIN_WIDTH[column];
      const isForcedOpen = forcedOpenColumnSet.has(column);
      const fitsByDefault =
        containerWidth > 0
          ? usedWidth + BUNDLE_LIST_COLUMN_GAP_PX + minWidth <= containerWidth
          : false;

      if (!isForcedOpen && !fitsByDefault) return;

      visible.add(column);
      usedWidth += BUNDLE_LIST_COLUMN_GAP_PX + minWidth;
    });

    return BUNDLE_LIST_COLUMN_ORDER.filter((column) => visible.has(column));
  }, [containerWidth, forcedOpenColumnSet, forcedClosedColumnSet]);

  const listGridStyle = useMemo(() => {
    const minWidth =
      visibleColumns.reduce((sum, column) => sum + BUNDLE_LIST_COLUMN_MIN_WIDTH[column], 0) +
      Math.max(0, visibleColumns.length - 1) * BUNDLE_LIST_COLUMN_GAP_PX;
    return {
      gridTemplateColumns: visibleColumns
        .map((column) => BUNDLE_LIST_COLUMN_TEMPLATE[column])
        .join(" "),
      width: "100%",
      minWidth: `max(100%, ${minWidth}px)`,
    } as CSSProperties;
  }, [visibleColumns]);

  useEffect(() => {
    syncTopScrollbarMetrics();
  }, [visibleColumns, entries.length, syncTopScrollbarMetrics]);

  const toggleColumn = (column: BundleOptionalListColumnKey) => {
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
      open: BUNDLE_OPTIONAL_LIST_COLUMNS.filter((entry) => nextOpen.has(entry)),
      closed: BUNDLE_OPTIONAL_LIST_COLUMNS.filter((entry) => nextClosed.has(entry)),
    });
  };

  if (entries.length === 0) {
    return <div className={`text-body-secondary ${styles.columnEmpty}`}>No bundles match the filters.</div>;
  }

  if (viewMode === "list" || viewMode === "matrix") {
    return (
      <BundleGridListSection
        entries={entries}
        visibleColumns={visibleColumns}
        listGridStyle={listGridStyle}
        showTopScrollbar={showTopScrollbar}
        listScrollRef={listScrollRef}
        listTopScrollRef={listTopScrollRef}
        listTopScrollInnerRef={listTopScrollInnerRef}
        toggleColumn={toggleColumn}
        activeAlias={activeAlias}
        activeBundleDetails={activeBundleDetails}
        deselectionFlashBundleIds={flashingIds}
        viewIconSize={viewConfig.iconSize}
        onEnableBundle={onEnableBundle}
        onDisableBundle={onDisableBundle}
        clearDeselectionFlash={clearDeselectionFlash}
        triggerDeselectionFlash={triggerDeselectionFlash}
        setActiveBundleDetailsId={setActiveBundleDetailsId}
        renderBundleRoleList={renderBundleRoleList}
        onOpenRoleDetails={onOpenRoleDetails}
      />
    );
  }

  const isMiniView = viewMode === "mini";

  return (
    <>
      <div className={styles.gridRoot} style={gridStyle}>
        <BundleGridCardsSection
          entries={entries}
          viewMode={viewMode}
          viewConfig={viewConfig}
          activeAlias={activeAlias}
          deselectionFlashBundleIds={flashingIds}
          hoveredBundleId={hoveredBundleId}
          setHoveredBundleId={setHoveredBundleId}
          toggleBundle={toggleBundle}
          setActiveBundleDetailsId={(bundleId) => setActiveBundleDetailsId(bundleId)}
          onEnableBundle={onEnableBundle}
          onDisableBundle={onDisableBundle}
          clearDeselectionFlash={clearDeselectionFlash}
          triggerDeselectionFlash={triggerDeselectionFlash}
          renderBundleRoleList={renderBundleRoleList}
        />
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
      {isMiniView && pendingMiniDisableEntry && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.enableConfirmOverlay} onClick={cancelMiniDisable}>
              <div className={styles.enableConfirmCard} onClick={(event) => event.stopPropagation()}>
                <h4 className={styles.enableConfirmTitle}>Disable selection?</h4>
                <p className={styles.enableConfirmText}>
                  {activeAlias
                    ? `Warning: Disabling will remove bundle "${pendingMiniDisableEntry.bundle.title}" from device "${activeAlias}".`
                    : `Warning: Disabling will remove bundle "${pendingMiniDisableEntry.bundle.title}" from the current deployment selection.`}
                </p>
                <p className={styles.enableConfirmText}>
                  It will no longer be deployed until you enable it again.
                </p>
                <div className={styles.enableConfirmActions}>
                  <button
                    type="button"
                    onClick={cancelMiniDisable}
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
            </div>,
            document.body
          )
        : null}
    </>
  );
}
