"use client";

import { useRef, useState } from "react";
import {
  BUNDLE_OPTIONAL_LIST_COLUMNS,
  type BundleOptionalListColumnKey,
} from "./role-dashboard/bundle/grid/View";
import RoleDashboardBodyContainer from "./role-dashboard/dashboard/BodyContainer";
import RoleDashboardOverlays from "./role-dashboard/dashboard/Overlays";
import {
  OPTIONAL_LIST_COLUMNS,
  type OptionalListColumnKey,
} from "./role-dashboard/role/ListView";
import {
  normalizeFacet,
  type DeployTargetFilter,
  type ReleaseTrack,
  type SoftwareScope,
} from "./role-dashboard/dashboard-filters";
import type { Bundle, Role, ViewMode } from "./role-dashboard/types";
import type { RoleDashboardProps } from "./role-dashboard/role-dashboard-types";
import { useRoleDashboardBootstrap } from "./role-dashboard/useRoleDashboardBootstrap";
import { useRoleDashboardEditor } from "./role-dashboard/useRoleDashboardEditor";
import { useRoleDashboardFiltering } from "./role-dashboard/useRoleDashboardFiltering";
import { useRoleDashboardSelection } from "./role-dashboard/useRoleDashboardSelection";
import styles from "./RoleDashboard.module.css";

function initialSoftwareScope(): SoftwareScope {
  if (typeof window === "undefined") {
    return "bundles";
  }
  const scopeParam = String(
    new URLSearchParams(window.location.search).get("sw_scope") || ""
  )
    .trim()
    .toLowerCase();
  return scopeParam === "apps" || scopeParam === "bundles" ? scopeParam : "bundles";
}

export default function RoleDashboard({
  baseUrl,
  roles,
  loading,
  error,
  selected,
  onToggleSelected,
  onLoadRoleAppConfig,
  onSaveRoleAppConfig,
  onImportRoleAppDefaults,
  activeAlias,
  serverAliases,
  serverMetaByAlias,
  selectedByAlias,
  onToggleSelectedForAlias,
  selectedPlanByAlias,
  onSelectPlanForAlias,
  serverSwitcher,
  onCreateServerForTarget,
  mode: controlledMode,
  onModeChange,
  compact = false,
}: RoleDashboardProps) {
  const Wrapper = compact ? "div" : "section";
  const wrapperClassName = compact ? styles.root : `${styles.root} ${styles.wrapper}`;

  const [query, setQuery] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [targetFilter, setTargetFilter] = useState<DeployTargetFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [categoryDraft, setCategoryDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [softwareScope, setSoftwareScope] = useState<SoftwareScope>(initialSoftwareScope);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("detail");
  const [columnAnimationRunning, setColumnAnimationRunning] = useState(true);
  const [animatedRoleOffset, setAnimatedRoleOffset] = useState(0);
  const [animatedBundleOffset, setAnimatedBundleOffset] = useState(0);
  const [releaseTrack, setReleaseTrack] = useState<ReleaseTrack>("stable");
  const [rowsOverride, setRowsOverride] = useState<number | null>(null);
  const [listForcedOpenColumns, setListForcedOpenColumns] = useState<
    OptionalListColumnKey[]
  >([]);
  const [listForcedClosedColumns, setListForcedClosedColumns] = useState<
    OptionalListColumnKey[]
  >([]);
  const [bundleListForcedOpenColumns, setBundleListForcedOpenColumns] = useState<
    BundleOptionalListColumnKey[]
  >([]);
  const [bundleListForcedClosedColumns, setBundleListForcedClosedColumns] = useState<
    BundleOptionalListColumnKey[]
  >([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const filtersButtonRef = useRef<HTMLButtonElement | null>(null);
  const filtersPopoverRef = useRef<HTMLDivElement | null>(null);
  const viewButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewPopoverRef = useRef<HTMLDivElement | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersPos, setFiltersPos] = useState({ top: 0, left: 0 });
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [localMode, setLocalMode] = useState<"customer" | "expert">("customer");
  const activeMode = controlledMode ?? localMode;
  const isExpertMode = activeMode === "expert";
  const [activeVideo, setActiveVideo] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [activeDetails, setActiveDetails] = useState<{
    role: Role;
    alias: string;
  } | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundlesLoading, setBundlesLoading] = useState(false);
  const [bundlesError, setBundlesError] = useState<string | null>(null);
  const [bundleMergePrompt, setBundleMergePrompt] = useState<{
    bundle: Bundle;
    alias: string;
  } | null>(null);
  const querySyncReadyRef = useRef(false);

  const editor = useRoleDashboardEditor({
    onLoadRoleAppConfig,
    onSaveRoleAppConfig,
    onImportRoleAppDefaults,
  });

  useRoleDashboardBootstrap({
    baseUrl,
    isExpertMode,
    releaseTrack,
    setReleaseTrack,
    setSoftwareScope,
    setQuery,
    setQueryDraft,
    setTargetFilter,
    setStatusFilter,
    setCategoryFilter,
    setTagFilter,
    setShowSelectedOnly,
    setViewMode,
    setRowsOverride,
    setListForcedOpenColumns,
    setListForcedClosedColumns,
    setBundleListForcedOpenColumns,
    setBundleListForcedClosedColumns,
    optionalListColumns: OPTIONAL_LIST_COLUMNS,
    bundleOptionalListColumns: BUNDLE_OPTIONAL_LIST_COLUMNS,
    querySyncReadyRef,
    activeVideo,
    setActiveVideo,
    activeDetails,
    setActiveDetails,
    setBundles,
    setBundlesLoading,
    setBundlesError,
    scrollRef,
    controlsRef,
    contentRef,
    setGridSize,
    filtersOpen,
    setFiltersOpen,
    filtersPopoverRef,
    filtersButtonRef,
    viewMenuOpen,
    setViewMenuOpen,
    viewPopoverRef,
    viewButtonRef,
    softwareScope,
    query,
    targetFilter,
    statusFilter,
    categoryFilter,
    tagFilter,
    showSelectedOnly,
    viewMode,
    rowsOverride,
    listForcedOpenColumns,
    listForcedClosedColumns,
    bundleListForcedOpenColumns,
    bundleListForcedClosedColumns,
    editingRole: editor.editingRole,
    setEditingRole: editor.setEditingRole,
  });

  const selection = useRoleDashboardSelection({
    roles,
    bundles,
    activeAlias,
    serverAliases,
    serverMetaByAlias,
    selected,
    selectedByAlias,
    onToggleSelected,
    selectedPlanByAlias,
    onToggleSelectedForAlias,
    onSelectPlanForAlias,
    onCreateServerForTarget,
    activeDetails,
    setBundleMergePrompt,
  });

  const filtering = useRoleDashboardFiltering({
    roles,
    bundles,
    loading,
    error,
    selected,
    statusFilter,
    setStatusFilter,
    targetFilter,
    categoryFilter,
    tagFilter,
    query,
    showSelectedOnly,
    viewMode,
    softwareScope,
    isExpertMode,
    releaseTrack,
    matrixAliases: selection.matrixAliases,
    selectedLookup: selection.selectedLookup,
    gridSize,
    rowsOverride,
    page,
    setPage,
    animatedRoleOffset,
    setAnimatedRoleOffset,
    animatedBundleOffset,
    setAnimatedBundleOffset,
    activeMode,
    bundlesLoading,
    bundlesError,
  });

  const toggleStatus = (status: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const addCategoryFilter = () => {
    const token = normalizeFacet(categoryDraft);
    if (!token) return;
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      next.add(token);
      return next;
    });
    setCategoryDraft("");
  };

  const addTagFilter = () => {
    const token = normalizeFacet(tagDraft);
    if (!token) return;
    setTagFilter((prev) => {
      const next = new Set(prev);
      next.add(token);
      return next;
    });
    setTagDraft("");
  };

  const removeCategoryFilter = (token: string) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      next.delete(token);
      return next;
    });
  };

  const removeTagFilter = (token: string) => {
    setTagFilter((prev) => {
      const next = new Set(prev);
      next.delete(token);
      return next;
    });
  };

  const applySearch = () => {
    setQuery(queryDraft.trim());
  };

  const openFilters = () => {
    const button = filtersButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 360;
    setFiltersPos({
      top: rect.bottom + 8,
      left: Math.max(12, rect.right - width),
    });
    setFiltersOpen(true);
  };

  const applyMode = (mode: "customer" | "expert") => {
    if (onModeChange) {
      onModeChange(mode);
      return;
    }
    setLocalMode(mode);
  };

  const handleModeChange = (mode: "customer" | "expert") => {
    applyMode(mode);
    if (mode === "customer") {
      editor.setEditingRole(null);
      setReleaseTrack("stable");
    }
  };

  const releaseTrackLocked = !isExpertMode;
  const releaseTrackTooltip = releaseTrackLocked
    ? "Preview features require Expert mode. Switch to Expert mode to unlock preview."
    : releaseTrack === "preview"
      ? "Preview mode active. Alpha lifecycle filters are additionally available."
      : "Stable mode active. Lifecycle filters are limited to beta and maintenance/stable.";

  return (
    <Wrapper className={wrapperClassName}>
      <RoleDashboardBodyContainer
        compact={compact}
        filtering={filtering}
        selection={selection}
        serverMetaByAlias={serverMetaByAlias}
        activeAlias={activeAlias}
        scrollRef={scrollRef}
        controlsRef={controlsRef}
        contentRef={contentRef}
        queryDraft={queryDraft}
        setQueryDraft={setQueryDraft}
        setQuery={setQuery}
        applySearch={applySearch}
        softwareScope={softwareScope}
        setSoftwareScope={setSoftwareScope}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        openFilters={openFilters}
        filtersButtonRef={filtersButtonRef}
        serverSwitcher={serverSwitcher}
        viewMode={viewMode}
        releaseTrack={releaseTrack}
        releaseTrackLocked={releaseTrackLocked}
        releaseTrackTooltip={releaseTrackTooltip}
        setReleaseTrack={setReleaseTrack}
        viewMenuOpen={viewMenuOpen}
        setViewMenuOpen={setViewMenuOpen}
        viewButtonRef={viewButtonRef}
        viewPopoverRef={viewPopoverRef}
        setViewMode={setViewMode}
        columnAnimationRunning={columnAnimationRunning}
        bundleListForcedOpenColumns={bundleListForcedOpenColumns}
        bundleListForcedClosedColumns={bundleListForcedClosedColumns}
        setBundleListForcedOpenColumns={setBundleListForcedOpenColumns}
        setBundleListForcedClosedColumns={setBundleListForcedClosedColumns}
        selected={selected}
        onToggleSelected={onToggleSelected}
        baseUrl={baseUrl}
        setActiveVideo={setActiveVideo}
        listForcedOpenColumns={listForcedOpenColumns}
        listForcedClosedColumns={listForcedClosedColumns}
        setListForcedOpenColumns={setListForcedOpenColumns}
        setListForcedClosedColumns={setListForcedClosedColumns}
        setActiveDetails={setActiveDetails}
        setAnimatedBundleOffset={setAnimatedBundleOffset}
        setAnimatedRoleOffset={setAnimatedRoleOffset}
        setColumnAnimationRunning={setColumnAnimationRunning}
        setPage={setPage}
      />

      <RoleDashboardOverlays
        activeVideo={activeVideo}
        onCloseVideo={() => setActiveVideo(null)}
        activeDetails={activeDetails}
        detailAliases={selection.detailAliases}
        activeDetailsAlias={selection.activeDetailsAlias}
        activeDetailsSelected={selection.activeDetailsSelected}
        activeDetailsPlans={selection.activeDetailsPlans}
        activeDetailsPlanId={selection.activeDetailsPlanId}
        activeMode={activeMode}
        onDetailsAliasChange={(alias) =>
          setActiveDetails((prev) => (prev ? { ...prev, alias } : prev))
        }
        onDetailsSelectPlan={(planId) => {
          if (!selection.activeDetailsRoleId) return;
          selection.selectPlanByAlias(
            selection.activeDetailsAlias,
            selection.activeDetailsRoleId,
            planId
          );
        }}
        onDetailsEnable={() => {
          if (!selection.activeDetailsRoleId || selection.activeDetailsSelected) return;
          selection.toggleSelectedByAlias(
            selection.activeDetailsAlias,
            selection.activeDetailsRoleId
          );
        }}
        onDetailsDisable={() => {
          if (!selection.activeDetailsRoleId || !selection.activeDetailsSelected) return;
          selection.toggleSelectedByAlias(
            selection.activeDetailsAlias,
            selection.activeDetailsRoleId
          );
        }}
        onDetailsEditRoleConfig={
          onLoadRoleAppConfig && activeDetails
            ? () => {
                setActiveDetails(null);
                void editor.startEditRoleConfig(activeDetails.role, selection.activeDetailsAlias);
              }
            : undefined
        }
        onDetailsOpenVideo={(url, title) => setActiveVideo({ url, title })}
        onCloseDetails={() => setActiveDetails(null)}
        bundleMergePrompt={bundleMergePrompt}
        onCloseBundleMergePrompt={() => setBundleMergePrompt(null)}
        onMergeBundlePrompt={() => {
          if (!bundleMergePrompt) return;
          selection.applyBundleToAlias(
            bundleMergePrompt.bundle,
            bundleMergePrompt.alias,
            "merge"
          );
          setBundleMergePrompt(null);
        }}
        onOverwriteBundlePrompt={() => {
          if (!bundleMergePrompt) return;
          selection.applyBundleToAlias(
            bundleMergePrompt.bundle,
            bundleMergePrompt.alias,
            "overwrite"
          );
          setBundleMergePrompt(null);
        }}
        editingRole={editor.editingRole}
        editorAlias={editor.editorAlias}
        editorPath={editor.editorPath}
        editorContent={editor.editorContent}
        editorBusy={editor.editorBusy}
        editorError={editor.editorError}
        editorStatus={editor.editorStatus}
        canImportDefaults={Boolean(onImportRoleAppDefaults)}
        canSave={Boolean(onSaveRoleAppConfig)}
        onCloseEditor={() => editor.setEditingRole(null)}
        onEditorContentChange={(value) => {
          editor.setEditorContent(value);
          editor.setEditorStatus(null);
          editor.setEditorError(null);
        }}
        onImportDefaults={() => void editor.importRoleDefaults()}
        onSaveEditor={() => void editor.saveRoleConfig()}
        filtersOpen={filtersOpen}
        filtersPopoverRef={filtersPopoverRef}
        filtersPos={filtersPos}
        rowsOverride={rowsOverride}
        computedRows={filtering.computedRows}
        rowOptions={filtering.rowOptions}
        onRowsOverrideChange={setRowsOverride}
        targetFilter={targetFilter}
        onTargetFilterChange={setTargetFilter}
        lifecycleStatusOptions={filtering.lifecycleStatusOptions}
        statusFilter={statusFilter}
        onToggleStatus={toggleStatus}
        softwareScope={softwareScope}
        showSelectedOnly={showSelectedOnly}
        onShowSelectedOnlyChange={setShowSelectedOnly}
        categoryDraft={categoryDraft}
        onCategoryDraftChange={setCategoryDraft}
        onAddCategoryFilter={addCategoryFilter}
        activeCategoryOptions={filtering.activeCategoryOptions}
        categoryFilter={categoryFilter}
        activeCategoryLabelByToken={filtering.activeCategoryLabelByToken}
        onRemoveCategoryFilter={removeCategoryFilter}
        tagDraft={tagDraft}
        onTagDraftChange={setTagDraft}
        onAddTagFilter={addTagFilter}
        activeTagOptions={filtering.activeTagOptions}
        tagFilter={tagFilter}
        activeTagLabelByToken={filtering.activeTagLabelByToken}
        onRemoveTagFilter={removeTagFilter}
      />
    </Wrapper>
  );
}
