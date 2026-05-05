import { createPortal } from "react-dom";
import type { RefObject } from "react";
import styles from "../../RoleDashboard.module.css";
import {
  FILTER_TOOLTIPS,
  STATUS_FILTER_META,
  TARGET_FILTER_META,
  TARGET_FILTER_OPTIONS,
  type DeployTargetFilter,
  type SoftwareScope,
} from "../dashboard-filters";

type RoleDashboardFiltersOverlayProps = {
  open: boolean;
  popoverRef: RefObject<HTMLDivElement>;
  position: { top: number; left: number };
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

export default function RoleDashboardFiltersOverlay({
  open,
  popoverRef,
  position,
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
}: RoleDashboardFiltersOverlayProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.dropdownCardOverlay}
      style={{ top: position.top, left: position.left }}
    >
      <div className={styles.group}>
        <span
          className={`text-body-tertiary ${styles.groupTitle}`}
          title={FILTER_TOOLTIPS.rows}
        >
          <i className={`fa-solid fa-grip ${styles.groupTitleIcon}`} aria-hidden="true" />
          <span>Rows</span>
        </span>
        <select
          value={rowsOverride ? String(rowsOverride) : "auto"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "auto") {
              onRowsOverrideChange(null);
              return;
            }
            const parsed = Number(value);
            onRowsOverrideChange(Number.isFinite(parsed) ? parsed : null);
          }}
          className={`form-select ${styles.rowSelect}`}
          title={FILTER_TOOLTIPS.rows}
        >
          <option value="auto">Auto ({computedRows})</option>
          {rowOptions.map((value) => (
            <option key={value} value={String(value)}>
              {value} rows
            </option>
          ))}
        </select>
      </div>

      <div className={styles.group}>
        <span
          className={`text-body-tertiary ${styles.groupTitle}`}
          title={FILTER_TOOLTIPS.deployTarget}
        >
          <i className={`fa-solid fa-crosshairs ${styles.groupTitleIcon}`} aria-hidden="true" />
          <span>Deploy target</span>
        </span>
        <div className={styles.groupButtons}>
          {TARGET_FILTER_OPTIONS.map((target) => (
            <button
              key={target}
              onClick={() => onTargetFilterChange(target)}
              className={`${styles.pillButton} ${
                targetFilter === target ? styles.pillButtonActive : ""
              }`}
              title={TARGET_FILTER_META[target].tooltip}
              aria-label={TARGET_FILTER_META[target].tooltip}
            >
              <i className={TARGET_FILTER_META[target].iconClass} aria-hidden="true" />
              <span>{target}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span
          className={`text-body-tertiary ${styles.groupTitle}`}
          title={FILTER_TOOLTIPS.lifecycle}
        >
          <i className={`fa-solid fa-wave-square ${styles.groupTitleIcon}`} aria-hidden="true" />
          <span>Lifecycle</span>
        </span>
        <div className={styles.groupButtons}>
          {lifecycleStatusOptions.map((status) => {
            const active = statusFilter.has(status);
            const statusMeta = STATUS_FILTER_META[status] || {
              iconClass: "fa-solid fa-circle",
              tooltip: `${status} lifecycle stage.`,
            };
            return (
              <button
                key={status}
                onClick={() => onToggleStatus(status)}
                className={`${styles.pillButton} ${active ? styles.pillButtonActive : ""}`}
                title={`${
                  softwareScope === "bundles" ? "Filter bundles" : "Filter apps"
                } by lifecycle: ${status}. ${statusMeta.tooltip}`}
              >
                <i className={statusMeta.iconClass} aria-hidden="true" />
                <span>{status}</span>
              </button>
            );
          })}
        </div>
        {lifecycleStatusOptions.length === 0 ? (
          <span className={styles.groupHint}>
            No lifecycle options available for this scope and mode.
          </span>
        ) : null}
      </div>

      {softwareScope === "apps" ? (
        <div className={styles.group}>
          <span
            className={`text-body-tertiary ${styles.groupTitle}`}
            title={FILTER_TOOLTIPS.selection}
          >
            <i className={`fa-solid fa-list-check ${styles.groupTitleIcon}`} aria-hidden="true" />
            <span>Selection</span>
          </span>
          <div className={styles.groupButtons}>
            {[
              {
                key: "all",
                label: "all",
                iconClass: "fa-solid fa-layer-group",
                tooltip: "Show all apps.",
                active: !showSelectedOnly,
              },
              {
                key: "selected",
                label: "enabled",
                iconClass: "fa-solid fa-circle-check",
                tooltip: "Show only enabled apps.",
                active: showSelectedOnly,
              },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => onShowSelectedOnlyChange(item.key === "selected")}
                className={`${styles.pillButton} ${item.active ? styles.pillButtonActive : ""}`}
                title={item.tooltip}
              >
                <i className={item.iconClass} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.group}>
        <span
          className={`text-body-tertiary ${styles.groupTitle}`}
          title={FILTER_TOOLTIPS.categories}
        >
          <i className={`fa-solid fa-folder-open ${styles.groupTitleIcon}`} aria-hidden="true" />
          <span>Categories</span>
        </span>
        <div className={styles.filterInputRow}>
          <input
            value={categoryDraft}
            onChange={(event) => onCategoryDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddCategoryFilter();
              }
            }}
            list="role-category-options"
            placeholder="Search/add category"
            className={`form-control ${styles.filterInput}`}
            title={FILTER_TOOLTIPS.categories}
          />
          <button
            type="button"
            onClick={onAddCategoryFilter}
            className={styles.filterAddButton}
            title="Add category filter"
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            Add
          </button>
        </div>
        <datalist id="role-category-options">
          {activeCategoryOptions.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
        {categoryFilter.size > 0 ? (
          <div className={styles.selectedTokenList}>
            {Array.from(categoryFilter).map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => onRemoveCategoryFilter(token)}
                className={styles.selectedToken}
                title={`Remove category filter: ${activeCategoryLabelByToken.get(token) || token}`}
              >
                <span>{activeCategoryLabelByToken.get(token) || token}</span>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <span className={styles.groupHint}>No category filter</span>
        )}
      </div>

      <div className={styles.group}>
        <span
          className={`text-body-tertiary ${styles.groupTitle}`}
          title={FILTER_TOOLTIPS.tags}
        >
          <i className={`fa-solid fa-tags ${styles.groupTitleIcon}`} aria-hidden="true" />
          <span>Tags</span>
        </span>
        <div className={styles.filterInputRow}>
          <input
            value={tagDraft}
            onChange={(event) => onTagDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddTagFilter();
              }
            }}
            list="role-tag-options"
            placeholder="Search/add tag"
            className={`form-control ${styles.filterInput}`}
            title={FILTER_TOOLTIPS.tags}
          />
          <button
            type="button"
            onClick={onAddTagFilter}
            className={styles.filterAddButton}
            title="Add tag filter"
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            Add
          </button>
        </div>
        <datalist id="role-tag-options">
          {activeTagOptions.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
        {tagFilter.size > 0 ? (
          <div className={styles.selectedTokenList}>
            {Array.from(tagFilter).map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => onRemoveTagFilter(token)}
                className={styles.selectedToken}
                title={`Remove tag filter: ${activeTagLabelByToken.get(token) || token}`}
              >
                <span>{activeTagLabelByToken.get(token) || token}</span>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <span className={styles.groupHint}>No tag filter</span>
        )}
      </div>
    </div>,
    document.body
  );
}
