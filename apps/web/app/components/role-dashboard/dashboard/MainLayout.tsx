import type { CSSProperties, ReactNode, RefObject } from "react";
import BundleColumnView from "../bundle/ColumnView";
import BundleGridView, {
  BUNDLE_OPTIONAL_LIST_COLUMNS,
  type BundleOptionalListColumnKey,
} from "../bundle/grid/View";
import RoleColumnView from "../role/ColumnView";
import RoleDashboardAppMatrixView from "./AppMatrixView";
import RoleDashboardBundleMatrixView from "./BundleMatrixView";
import RoleDashboardPagination from "./Pagination";
import RoleDashboardToolbar from "./Toolbar";
import RoleGridView from "../role/GridView";
import RoleListView, {
  OPTIONAL_LIST_COLUMNS,
  type OptionalListColumnKey,
} from "../role/ListView";
import { normalizeListColumnState, type ReleaseTrack, type SoftwareScope } from "../dashboard-filters";
import type { Bundle, Role, ViewConfig, ViewMode } from "../types";
import styles from "../../RoleDashboard.module.css";

type RoleDashboardMainLayoutProps = {
  compact: boolean;
  headerLoading: boolean;
  isBundleScope: boolean;
  headerFilteredCount: number;
  headerTotalCount: number;
  selectedCount: number;
  hiddenSelected: number;
  viewMode: ViewMode;
  matrixAliases: string[];
  activeAlias?: string;
  headerError: string | null;
  scrollRef: RefObject<HTMLDivElement>;
  controlsRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  queryDraft: string;
  onQueryDraftChange: (value: string) => void;
  onApplySearch: () => void;
  softwareScope: SoftwareScope;
  onToggleSoftwareScope: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  filtersButtonRef: RefObject<HTMLButtonElement>;
  serverSwitcher?: ReactNode;
  releaseTrack: ReleaseTrack;
  releaseTrackLocked: boolean;
  releaseTrackTooltip: string;
  onToggleReleaseTrack: () => void;
  viewMenuOpen: boolean;
  onToggleViewMenu: () => void;
  onSelectViewMode: (mode: ViewMode) => void;
  viewButtonRef: RefObject<HTMLButtonElement>;
  viewPopoverRef: RefObject<HTMLDivElement>;
  matrixColumnStyleByAlias: Record<string, CSSProperties>;
  serverMetaByAlias?: Record<string, { logoEmoji?: string | null; color?: string | null }>;
  paginatedBundles: Bundle[];
  bundleRoleCountById: Record<string, number>;
  bundleStateByAlias: Record<string, Record<string, { enabled: boolean; selectedCount: number; totalCount: number }>>;
  canToggleAliasBundle: (alias: string) => boolean;
  onEnableBundleForAlias: (bundle: Bundle, alias: string) => void;
  onDisableBundleForAlias: (bundle: Bundle, alias: string) => void;
  viewConfig: ViewConfig;
  rows: number;
  rowLaneSize: number;
  columnLaneSize: number;
  columnAnimationRunning: boolean;
  bundleStateById: Record<string, { enabled: boolean; selectedCount: number; totalCount: number }>;
  roleById: Record<string, Role>;
  roleServerCountByRole: Record<string, number>;
  onOpenRoleDetails: (role: Role) => void;
  onEnableBundle: (bundle: Bundle) => void;
  onDisableBundle: (bundle: Bundle) => void;
  bundleListForcedOpenColumns: BundleOptionalListColumnKey[];
  bundleListForcedClosedColumns: BundleOptionalListColumnKey[];
  onBundleListColumnsChange: (open: BundleOptionalListColumnKey[], closed: BundleOptionalListColumnKey[]) => void;
  computedColumns: number;
  gridGap: number;
  paginatedRoles: Role[];
  selected: Set<string>;
  onToggleSelected: (roleId: string) => void;
  rolePlanOptions: Record<string, { id: string; label: string }[]>;
  activeSelectedPlanByRole: Record<string, string | null>;
  onSelectRolePlan: (roleId: string, planId: string | null) => void;
  baseUrl?: string;
  onOpenVideo: (url: string, title: string) => void;
  listForcedOpenColumns: OptionalListColumnKey[];
  listForcedClosedColumns: OptionalListColumnKey[];
  onListColumnsChange: (open: OptionalListColumnKey[], closed: OptionalListColumnKey[]) => void;
  selectedLookup: Record<string, Set<string>>;
  canToggleAliasRole: (alias: string) => boolean;
  selectedPlanLookup: Record<string, Record<string, string | null>>;
  onSelectPlanByAlias: (alias: string, roleId: string, planId: string | null) => void;
  onToggleSelectedByAlias: (alias: string, roleId: string) => void;
  isLaneAnimatedView: boolean;
  laneAnimatedItemCount: number;
  laneCount: number;
  currentPage: number;
  pageCount: number;
  onToggleAnimation: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
};

export default function RoleDashboardMainLayout({
  compact,
  headerLoading,
  isBundleScope,
  headerFilteredCount,
  headerTotalCount,
  selectedCount,
  hiddenSelected,
  viewMode,
  matrixAliases,
  activeAlias,
  headerError,
  scrollRef,
  controlsRef,
  contentRef,
  queryDraft,
  onQueryDraftChange,
  onApplySearch,
  softwareScope,
  onToggleSoftwareScope,
  filtersOpen,
  onToggleFilters,
  filtersButtonRef,
  serverSwitcher,
  releaseTrack,
  releaseTrackLocked,
  releaseTrackTooltip,
  onToggleReleaseTrack,
  viewMenuOpen,
  onToggleViewMenu,
  onSelectViewMode,
  viewButtonRef,
  viewPopoverRef,
  matrixColumnStyleByAlias,
  serverMetaByAlias,
  paginatedBundles,
  bundleRoleCountById,
  bundleStateByAlias,
  canToggleAliasBundle,
  onEnableBundleForAlias,
  onDisableBundleForAlias,
  viewConfig,
  rows,
  rowLaneSize,
  columnLaneSize,
  columnAnimationRunning,
  bundleStateById,
  roleById,
  roleServerCountByRole,
  onOpenRoleDetails,
  onEnableBundle,
  onDisableBundle,
  bundleListForcedOpenColumns,
  bundleListForcedClosedColumns,
  onBundleListColumnsChange,
  computedColumns,
  gridGap,
  paginatedRoles,
  selected,
  onToggleSelected,
  rolePlanOptions,
  activeSelectedPlanByRole,
  onSelectRolePlan,
  baseUrl,
  onOpenVideo,
  listForcedOpenColumns,
  listForcedClosedColumns,
  onListColumnsChange,
  selectedLookup,
  canToggleAliasRole,
  selectedPlanLookup,
  onSelectPlanByAlias,
  onToggleSelectedByAlias,
  isLaneAnimatedView,
  laneAnimatedItemCount,
  laneCount,
  currentPage,
  pageCount,
  onToggleAnimation,
  onPrevPage,
  onNextPage,
}: RoleDashboardMainLayoutProps) {
  return (
    <>
      {!compact ? (
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={`text-body ${styles.title}`}>Software</h2>
            <p className={`text-body-secondary ${styles.subtitle}`}>
              Browse roles, filter fast, and keep your selections locked in while you
              explore.
            </p>
          </div>
          <div className={`text-body-secondary ${styles.headerRight}`}>
            {headerLoading ? (
              <span>{isBundleScope ? "Loading bundles…" : "Loading roles…"}</span>
            ) : (
              <span>
                {headerFilteredCount} / {headerTotalCount} {isBundleScope ? "bundles" : "roles"}
                {!isBundleScope && selectedCount > 0 ? (
                  <span>
                    {" "}· Enabled {selectedCount}
                    {hiddenSelected > 0 ? ` (${hiddenSelected} hidden)` : ""}
                  </span>
                ) : null}
                {!isBundleScope && viewMode === "matrix"
                  ? ` · Matrix: ${matrixAliases.length} devices`
                  : !isBundleScope && activeAlias
                    ? ` · Active: ${activeAlias}`
                    : ""}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {headerError ? <div className={`text-danger ${styles.error}`}>{headerError}</div> : null}

      <div className={styles.layout}>
        <div ref={scrollRef} className={styles.scrollArea}>
          <div ref={controlsRef} className={styles.controls}>
            <RoleDashboardToolbar
              queryDraft={queryDraft}
              onQueryDraftChange={onQueryDraftChange}
              onApplySearch={onApplySearch}
              softwareScope={softwareScope}
              onToggleSoftwareScope={onToggleSoftwareScope}
              filtersOpen={filtersOpen}
              onToggleFilters={onToggleFilters}
              filtersButtonRef={filtersButtonRef}
              serverSwitcher={serverSwitcher}
              viewMode={viewMode}
              releaseTrack={releaseTrack}
              releaseTrackLocked={releaseTrackLocked}
              releaseTrackTooltip={releaseTrackTooltip}
              onToggleReleaseTrack={onToggleReleaseTrack}
              viewMenuOpen={viewMenuOpen}
              onToggleViewMenu={onToggleViewMenu}
              onSelectViewMode={onSelectViewMode}
              viewButtonRef={viewButtonRef}
              viewPopoverRef={viewPopoverRef}
            />
          </div>

          <div
            ref={contentRef}
            className={`${styles.content} ${viewMode === "matrix" ? styles.contentMatrix : ""}`}
          >
            {softwareScope === "bundles" ? (
              viewMode === "matrix" ? (
                <RoleDashboardBundleMatrixView
                  matrixAliases={matrixAliases}
                  matrixColumnStyleByAlias={matrixColumnStyleByAlias}
                  serverMetaByAlias={serverMetaByAlias}
                  paginatedBundles={paginatedBundles}
                  bundleRoleCountById={bundleRoleCountById}
                  bundleStateByAlias={bundleStateByAlias}
                  canToggleAliasBundle={canToggleAliasBundle}
                  onEnableBundleForAlias={onEnableBundleForAlias}
                  onDisableBundleForAlias={onDisableBundleForAlias}
                />
              ) : viewMode === "row" || viewMode === "column" ? (
                <BundleColumnView
                  bundles={paginatedBundles}
                  iconSize={viewConfig.iconSize}
                  variant={viewMode}
                  laneCount={rows}
                  laneSize={viewMode === "row" ? rowLaneSize : columnLaneSize}
                  animationRunning={columnAnimationRunning}
                  activeAlias={String(activeAlias || "").trim() || matrixAliases[0] || "server"}
                  bundleStates={bundleStateById}
                  roleById={roleById}
                  roleServerCountByRole={roleServerCountByRole}
                  onOpenRoleDetails={onOpenRoleDetails}
                  onEnableBundle={onEnableBundle}
                  onDisableBundle={onDisableBundle}
                />
              ) : (
                <BundleGridView
                  bundles={paginatedBundles}
                  viewMode={viewMode}
                  viewConfig={viewConfig}
                  computedColumns={computedColumns}
                  gridGap={gridGap}
                  minHeight={viewConfig.minHeight}
                  activeAlias={String(activeAlias || "").trim() || matrixAliases[0] || "server"}
                  bundleStates={bundleStateById}
                  roleById={roleById}
                  roleServerCountByRole={roleServerCountByRole}
                  forcedOpenColumns={bundleListForcedOpenColumns}
                  forcedClosedColumns={bundleListForcedClosedColumns}
                  onListColumnsChange={({ open, closed }) => {
                    const normalized = normalizeListColumnState(
                      open,
                      closed,
                      BUNDLE_OPTIONAL_LIST_COLUMNS
                    );
                    onBundleListColumnsChange(normalized.open, normalized.closed);
                  }}
                  onOpenRoleDetails={onOpenRoleDetails}
                  onEnableBundle={onEnableBundle}
                  onDisableBundle={onDisableBundle}
                />
              )
            ) : viewMode === "matrix" ? (
              <RoleDashboardAppMatrixView
                matrixAliases={matrixAliases}
                matrixColumnStyleByAlias={matrixColumnStyleByAlias}
                serverMetaByAlias={serverMetaByAlias}
                paginatedRoles={paginatedRoles}
                selectedLookup={selectedLookup}
                canToggleAliasRole={canToggleAliasRole}
                rolePlanOptions={rolePlanOptions}
                selectedPlanLookup={selectedPlanLookup}
                onSelectPlanByAlias={onSelectPlanByAlias}
                onToggleSelectedByAlias={onToggleSelectedByAlias}
                baseUrl={baseUrl}
              />
            ) : viewMode === "list" ? (
              <RoleListView
                roles={paginatedRoles}
                selected={selected}
                iconSize={viewConfig.iconSize}
                onToggleSelected={onToggleSelected}
                rolePlans={rolePlanOptions}
                selectedPlanByRole={activeSelectedPlanByRole}
                onSelectRolePlan={onSelectRolePlan}
                roleServerCountByRole={roleServerCountByRole}
                baseUrl={baseUrl}
                onOpenVideo={onOpenVideo}
                forcedOpenColumns={listForcedOpenColumns}
                forcedClosedColumns={listForcedClosedColumns}
                onListColumnsChange={({ open, closed }) => {
                  const normalized = normalizeListColumnState(open, closed, OPTIONAL_LIST_COLUMNS);
                  onListColumnsChange(normalized.open, normalized.closed);
                }}
              />
            ) : viewMode === "row" || viewMode === "column" ? (
              <RoleColumnView
                roles={paginatedRoles}
                selected={selected}
                iconSize={viewConfig.iconSize}
                variant={viewMode}
                laneCount={rows}
                laneSize={viewMode === "row" ? rowLaneSize : columnLaneSize}
                animationRunning={columnAnimationRunning}
                onToggleSelected={onToggleSelected}
                rolePlans={rolePlanOptions}
                selectedPlanByRole={activeSelectedPlanByRole}
                onSelectRolePlan={onSelectRolePlan}
                roleServerCountByRole={roleServerCountByRole}
                baseUrl={baseUrl}
                onOpenVideo={onOpenVideo}
                onOpenDetails={onOpenRoleDetails}
              />
            ) : (
              <RoleGridView
                roles={paginatedRoles}
                selected={selected}
                onToggleSelected={onToggleSelected}
                rolePlans={rolePlanOptions}
                selectedPlanByRole={activeSelectedPlanByRole}
                onSelectRolePlan={onSelectRolePlan}
                roleServerCountByRole={roleServerCountByRole}
                baseUrl={baseUrl}
                viewMode={viewMode}
                viewConfig={viewConfig}
                computedColumns={computedColumns}
                gridGap={gridGap}
                onOpenVideo={onOpenVideo}
                onOpenDetails={onOpenRoleDetails}
              />
            )}
          </div>
        </div>

        <RoleDashboardPagination
          isLaneAnimatedView={isLaneAnimatedView}
          laneAnimatedItemCount={laneAnimatedItemCount}
          columnAnimationRunning={columnAnimationRunning}
          currentPage={currentPage}
          pageCount={pageCount}
          onToggleAnimation={onToggleAnimation}
          onPrev={onPrevPage}
          onNext={onNextPage}
        />
      </div>
    </>
  );
}
