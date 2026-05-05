import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import RoleDashboardMainLayout from "./MainLayout";
import type { BundleOptionalListColumnKey } from "../bundle/grid/View";
import type { OptionalListColumnKey } from "../role/ListView";
import type { Role, ViewMode } from "../types";
import type { ReleaseTrack, SoftwareScope } from "../dashboard-filters";

type RoleDashboardBodyContainerProps = {
  compact: boolean;
  filtering: any;
  selection: any;
  serverMetaByAlias?: Record<string, { logoEmoji?: string | null; color?: string | null }>;
  activeAlias?: string;
  scrollRef: RefObject<HTMLDivElement>;
  controlsRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  queryDraft: string;
  setQueryDraft: Dispatch<SetStateAction<string>>;
  setQuery: Dispatch<SetStateAction<string>>;
  applySearch: () => void;
  softwareScope: SoftwareScope;
  setSoftwareScope: Dispatch<SetStateAction<SoftwareScope>>;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  openFilters: () => void;
  filtersButtonRef: RefObject<HTMLButtonElement>;
  serverSwitcher?: ReactNode;
  viewMode: ViewMode;
  releaseTrack: ReleaseTrack;
  releaseTrackLocked: boolean;
  releaseTrackTooltip: string;
  setReleaseTrack: Dispatch<SetStateAction<ReleaseTrack>>;
  viewMenuOpen: boolean;
  setViewMenuOpen: Dispatch<SetStateAction<boolean>>;
  viewButtonRef: RefObject<HTMLButtonElement>;
  viewPopoverRef: RefObject<HTMLDivElement>;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  columnAnimationRunning: boolean;
  setColumnAnimationRunning: Dispatch<SetStateAction<boolean>>;
  bundleListForcedOpenColumns: BundleOptionalListColumnKey[];
  bundleListForcedClosedColumns: BundleOptionalListColumnKey[];
  setBundleListForcedOpenColumns: Dispatch<SetStateAction<BundleOptionalListColumnKey[]>>;
  setBundleListForcedClosedColumns: Dispatch<SetStateAction<BundleOptionalListColumnKey[]>>;
  selected: Set<string>;
  onToggleSelected: (roleId: string) => void;
  baseUrl?: string;
  setActiveVideo: Dispatch<SetStateAction<{ url: string; title: string } | null>>;
  listForcedOpenColumns: OptionalListColumnKey[];
  listForcedClosedColumns: OptionalListColumnKey[];
  setListForcedOpenColumns: Dispatch<SetStateAction<OptionalListColumnKey[]>>;
  setListForcedClosedColumns: Dispatch<SetStateAction<OptionalListColumnKey[]>>;
  setActiveDetails: Dispatch<SetStateAction<{ role: Role; alias: string } | null>>;
  setAnimatedBundleOffset: Dispatch<SetStateAction<number>>;
  setAnimatedRoleOffset: Dispatch<SetStateAction<number>>;
  setPage: Dispatch<SetStateAction<number>>;
};

export default function RoleDashboardBodyContainer({
  compact,
  filtering,
  selection,
  serverMetaByAlias,
  activeAlias,
  scrollRef,
  controlsRef,
  contentRef,
  queryDraft,
  setQueryDraft,
  setQuery,
  applySearch,
  softwareScope,
  setSoftwareScope,
  filtersOpen,
  setFiltersOpen,
  openFilters,
  filtersButtonRef,
  serverSwitcher,
  viewMode,
  releaseTrack,
  releaseTrackLocked,
  releaseTrackTooltip,
  setReleaseTrack,
  viewMenuOpen,
  setViewMenuOpen,
  viewButtonRef,
  viewPopoverRef,
  setViewMode,
  columnAnimationRunning,
  setColumnAnimationRunning,
  bundleListForcedOpenColumns,
  bundleListForcedClosedColumns,
  setBundleListForcedOpenColumns,
  setBundleListForcedClosedColumns,
  selected,
  onToggleSelected,
  baseUrl,
  setActiveVideo,
  listForcedOpenColumns,
  listForcedClosedColumns,
  setListForcedOpenColumns,
  setListForcedClosedColumns,
  setActiveDetails,
  setAnimatedBundleOffset,
  setAnimatedRoleOffset,
  setPage,
}: RoleDashboardBodyContainerProps) {
  const openRoleDetails = (role: Role) => {
    setActiveDetails({
      role,
      alias: String(activeAlias || "").trim() || selection.matrixAliases[0] || "server",
    });
  };

  return (
    <RoleDashboardMainLayout
      compact={compact}
      headerLoading={filtering.headerLoading}
      isBundleScope={filtering.isBundleScope}
      headerFilteredCount={filtering.headerFilteredCount}
      headerTotalCount={filtering.headerTotalCount}
      selectedCount={filtering.selectedCount}
      hiddenSelected={filtering.hiddenSelected}
      viewMode={viewMode}
      matrixAliases={selection.matrixAliases}
      activeAlias={activeAlias}
      headerError={filtering.headerError}
      scrollRef={scrollRef}
      controlsRef={controlsRef}
      contentRef={contentRef}
      queryDraft={queryDraft}
      onQueryDraftChange={(value) => {
        setQueryDraft(value);
        setQuery(value);
      }}
      onApplySearch={applySearch}
      softwareScope={softwareScope}
      onToggleSoftwareScope={() =>
        setSoftwareScope((prev) => (prev === "apps" ? "bundles" : "apps"))
      }
      filtersOpen={filtersOpen}
      onToggleFilters={() => {
        if (filtersOpen) {
          setFiltersOpen(false);
        } else {
          openFilters();
        }
      }}
      filtersButtonRef={filtersButtonRef}
      serverSwitcher={serverSwitcher}
      releaseTrack={releaseTrack}
      releaseTrackLocked={releaseTrackLocked}
      releaseTrackTooltip={releaseTrackTooltip}
      onToggleReleaseTrack={() =>
        setReleaseTrack((prev) => (prev === "preview" ? "stable" : "preview"))
      }
      viewMenuOpen={viewMenuOpen}
      onToggleViewMenu={() => setViewMenuOpen((prev) => !prev)}
      onSelectViewMode={(mode) => {
        setViewMode(mode);
        setViewMenuOpen(false);
      }}
      viewButtonRef={viewButtonRef}
      viewPopoverRef={viewPopoverRef}
      matrixColumnStyleByAlias={selection.matrixColumnStyleByAlias}
      serverMetaByAlias={serverMetaByAlias}
      paginatedBundles={filtering.paginatedBundles}
      bundleRoleCountById={selection.bundleRoleCountById}
      bundleStateByAlias={selection.bundleStateByAlias}
      canToggleAliasBundle={selection.canToggleAliasBundle}
      onEnableBundleForAlias={selection.requestEnableBundleForAlias}
      onDisableBundleForAlias={selection.disableBundleForAlias}
      viewConfig={filtering.viewConfig}
      rows={filtering.rows}
      rowLaneSize={filtering.rowLaneSize}
      columnLaneSize={filtering.columnLaneSize}
      columnAnimationRunning={columnAnimationRunning}
      bundleStateById={selection.bundleStateById}
      roleById={selection.roleById}
      roleServerCountByRole={selection.roleServerCountByRole}
      onOpenRoleDetails={openRoleDetails}
      onEnableBundle={selection.requestEnableBundle}
      onDisableBundle={selection.disableBundle}
      bundleListForcedOpenColumns={bundleListForcedOpenColumns}
      bundleListForcedClosedColumns={bundleListForcedClosedColumns}
      onBundleListColumnsChange={(open, closed) => {
        setBundleListForcedOpenColumns(open);
        setBundleListForcedClosedColumns(closed);
      }}
      computedColumns={filtering.computedColumns}
      gridGap={filtering.gridGap}
      paginatedRoles={filtering.paginatedRoles}
      selected={selected}
      onToggleSelected={onToggleSelected}
      rolePlanOptions={selection.rolePlanOptions}
      activeSelectedPlanByRole={selection.activeSelectedPlanByRole}
      onSelectRolePlan={(roleId, planId) =>
        selection.selectPlanByAlias(String(activeAlias || "").trim(), roleId, planId)
      }
      baseUrl={baseUrl}
      onOpenVideo={(url, title) => setActiveVideo({ url, title })}
      listForcedOpenColumns={listForcedOpenColumns}
      listForcedClosedColumns={listForcedClosedColumns}
      onListColumnsChange={(open, closed) => {
        setListForcedOpenColumns(open);
        setListForcedClosedColumns(closed);
      }}
      selectedLookup={selection.selectedLookup}
      canToggleAliasRole={selection.canToggleAliasRole}
      selectedPlanLookup={selection.selectedPlanLookup}
      onSelectPlanByAlias={selection.selectPlanByAlias}
      onToggleSelectedByAlias={selection.toggleSelectedByAlias}
      isLaneAnimatedView={filtering.isLaneAnimatedView}
      laneAnimatedItemCount={filtering.laneAnimatedItemCount}
      laneCount={filtering.laneCount}
      currentPage={filtering.currentPage}
      pageCount={filtering.pageCount}
      onToggleAnimation={() => setColumnAnimationRunning((prev) => !prev)}
      onPrevPage={() => {
        if (filtering.isLaneAnimatedView) {
          if (filtering.laneAnimatedItemCount === 0) return;
          const animatedStep = Math.max(1, filtering.laneCount);
          if (softwareScope === "bundles") {
            setAnimatedBundleOffset((prev) => prev - animatedStep);
          } else {
            setAnimatedRoleOffset((prev) => prev - animatedStep);
          }
          return;
        }
        setPage((prev) => Math.max(1, prev - 1));
      }}
      onNextPage={() => {
        if (filtering.isLaneAnimatedView) {
          if (filtering.laneAnimatedItemCount === 0) return;
          const animatedStep = Math.max(1, filtering.laneCount);
          if (softwareScope === "bundles") {
            setAnimatedBundleOffset((prev) => prev + animatedStep);
          } else {
            setAnimatedRoleOffset((prev) => prev + animatedStep);
          }
          return;
        }
        setPage((prev) => Math.min(filtering.pageCount, prev + 1));
      }}
    />
  );
}
