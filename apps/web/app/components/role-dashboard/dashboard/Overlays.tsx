import RoleDashboardBundleMergePrompt from "./BundleMergePrompt";
import RoleDashboardConfigEditorModal from "./ConfigEditorModal";
import RoleDashboardFiltersOverlay from "./FiltersOverlay";
import RoleDetailsModal from "../role/details/Modal";
import RoleVideoModal from "../role/VideoModal";
import type { RefObject } from "react";
import type { Bundle, Role } from "../types";
import type { DeployTargetFilter, SoftwareScope } from "../dashboard-filters";

type RoleDashboardOverlaysProps = {
  activeVideo: { url: string; title: string } | null;
  onCloseVideo: () => void;
  activeDetails: { role: Role; alias: string } | null;
  detailAliases: string[];
  activeDetailsAlias: string;
  activeDetailsSelected: boolean;
  activeDetailsPlans: { id: string; label: string }[];
  activeDetailsPlanId: string | null;
  activeMode: "customer" | "expert";
  onDetailsAliasChange: (alias: string) => void;
  onDetailsSelectPlan: (planId: string | null) => void;
  onDetailsEnable: () => void;
  onDetailsDisable: () => void;
  onDetailsEditRoleConfig?: () => void;
  onDetailsOpenVideo: (url: string, title: string) => void;
  onCloseDetails: () => void;
  bundleMergePrompt: { bundle: Bundle; alias: string } | null;
  onCloseBundleMergePrompt: () => void;
  onMergeBundlePrompt: () => void;
  onOverwriteBundlePrompt: () => void;
  editingRole: Role | null;
  editorAlias: string;
  editorPath: string;
  editorContent: string;
  editorBusy: boolean;
  editorError: string | null;
  editorStatus: string | null;
  canImportDefaults: boolean;
  canSave: boolean;
  onCloseEditor: () => void;
  onEditorContentChange: (value: string) => void;
  onImportDefaults: () => void;
  onSaveEditor: () => void;
  filtersOpen: boolean;
  filtersPopoverRef: RefObject<HTMLDivElement>;
  filtersPos: { top: number; left: number };
  rowsOverride: number | null;
  computedRows: number;
  rowOptions: number[];
  onRowsOverrideChange: (rows: number | null) => void;
  targetFilter: DeployTargetFilter;
  onTargetFilterChange: (target: DeployTargetFilter) => void;
  lifecycleStatusOptions: string[];
  statusFilter: Set<string>;
  onToggleStatus: (status: string) => void;
  softwareScope: SoftwareScope;
  showSelectedOnly: boolean;
  onShowSelectedOnlyChange: (selectedOnly: boolean) => void;
  categoryDraft: string;
  onCategoryDraftChange: (value: string) => void;
  onAddCategoryFilter: () => void;
  activeCategoryOptions: string[];
  categoryFilter: Set<string>;
  activeCategoryLabelByToken: Map<string, string>;
  onRemoveCategoryFilter: (token: string) => void;
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
  onAddTagFilter: () => void;
  activeTagOptions: string[];
  tagFilter: Set<string>;
  activeTagLabelByToken: Map<string, string>;
  onRemoveTagFilter: (token: string) => void;
};

export default function RoleDashboardOverlays({
  activeVideo,
  onCloseVideo,
  activeDetails,
  detailAliases,
  activeDetailsAlias,
  activeDetailsSelected,
  activeDetailsPlans,
  activeDetailsPlanId,
  activeMode,
  onDetailsAliasChange,
  onDetailsSelectPlan,
  onDetailsEnable,
  onDetailsDisable,
  onDetailsEditRoleConfig,
  onDetailsOpenVideo,
  onCloseDetails,
  bundleMergePrompt,
  onCloseBundleMergePrompt,
  onMergeBundlePrompt,
  onOverwriteBundlePrompt,
  editingRole,
  editorAlias,
  editorPath,
  editorContent,
  editorBusy,
  editorError,
  editorStatus,
  canImportDefaults,
  canSave,
  onCloseEditor,
  onEditorContentChange,
  onImportDefaults,
  onSaveEditor,
  filtersOpen,
  filtersPopoverRef,
  filtersPos,
  rowsOverride,
  computedRows,
  rowOptions,
  onRowsOverrideChange,
  targetFilter,
  onTargetFilterChange,
  lifecycleStatusOptions,
  statusFilter,
  onToggleStatus,
  softwareScope,
  showSelectedOnly,
  onShowSelectedOnlyChange,
  categoryDraft,
  onCategoryDraftChange,
  onAddCategoryFilter,
  activeCategoryOptions,
  categoryFilter,
  activeCategoryLabelByToken,
  onRemoveCategoryFilter,
  tagDraft,
  onTagDraftChange,
  onAddTagFilter,
  activeTagOptions,
  tagFilter,
  activeTagLabelByToken,
  onRemoveTagFilter,
}: RoleDashboardOverlaysProps) {
  return (
    <>
      <RoleVideoModal activeVideo={activeVideo} onClose={onCloseVideo} />

      {activeDetails ? (
        <RoleDetailsModal
          role={activeDetails.role}
          aliases={detailAliases}
          selectedAlias={activeDetailsAlias}
          selected={activeDetailsSelected}
          plans={activeDetailsPlans}
          selectedPlanId={activeDetailsPlanId}
          serverCount={activeDetailsSelected ? 1 : 0}
          onAliasChange={onDetailsAliasChange}
          onSelectPlan={onDetailsSelectPlan}
          onEnable={onDetailsEnable}
          onDisable={onDetailsDisable}
          expertMode={activeMode === "expert"}
          onEditRoleConfig={onDetailsEditRoleConfig}
          onOpenVideo={onDetailsOpenVideo}
          onClose={onCloseDetails}
        />
      ) : null}

      {bundleMergePrompt ? (
        <RoleDashboardBundleMergePrompt
          prompt={bundleMergePrompt}
          onCancel={onCloseBundleMergePrompt}
          onMerge={onMergeBundlePrompt}
          onOverwrite={onOverwriteBundlePrompt}
        />
      ) : null}

      {editingRole ? (
        <RoleDashboardConfigEditorModal
          editingRole={editingRole}
          editorAlias={editorAlias}
          editorPath={editorPath}
          editorContent={editorContent}
          editorBusy={editorBusy}
          editorError={editorError}
          editorStatus={editorStatus}
          canImportDefaults={canImportDefaults}
          canSave={canSave}
          onClose={onCloseEditor}
          onEditorContentChange={onEditorContentChange}
          onImportDefaults={onImportDefaults}
          onSave={onSaveEditor}
        />
      ) : null}

      <RoleDashboardFiltersOverlay
        open={filtersOpen}
        popoverRef={filtersPopoverRef}
        position={filtersPos}
        rowsOverride={rowsOverride}
        computedRows={computedRows}
        rowOptions={rowOptions}
        onRowsOverrideChange={onRowsOverrideChange}
        targetFilter={targetFilter}
        onTargetFilterChange={onTargetFilterChange}
        lifecycleStatusOptions={lifecycleStatusOptions}
        statusFilter={statusFilter}
        onToggleStatus={onToggleStatus}
        softwareScope={softwareScope}
        showSelectedOnly={showSelectedOnly}
        onShowSelectedOnlyChange={onShowSelectedOnlyChange}
        categoryDraft={categoryDraft}
        onCategoryDraftChange={onCategoryDraftChange}
        onAddCategoryFilter={onAddCategoryFilter}
        activeCategoryOptions={activeCategoryOptions}
        categoryFilter={categoryFilter}
        activeCategoryLabelByToken={activeCategoryLabelByToken}
        onRemoveCategoryFilter={onRemoveCategoryFilter}
        tagDraft={tagDraft}
        onTagDraftChange={onTagDraftChange}
        onAddTagFilter={onAddTagFilter}
        activeTagOptions={activeTagOptions}
        tagFilter={tagFilter}
        activeTagLabelByToken={activeTagLabelByToken}
        onRemoveTagFilter={onRemoveTagFilter}
      />
    </>
  );
}
