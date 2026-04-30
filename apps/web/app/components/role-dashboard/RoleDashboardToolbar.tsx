import type { ReactNode, RefObject } from "react";
import styles from "../RoleDashboard.module.css";
import { VIEW_MODE_ICONS } from "./constants";
import {
  ANIMATED_VIEW_MODES,
  DEFAULT_VIEW_MODES,
  formatViewLabel,
  type ReleaseTrack,
  type SoftwareScope,
} from "./dashboard-filters";
import type { ViewMode } from "./types";

type RoleDashboardToolbarProps = {
  queryDraft: string;
  onQueryDraftChange: (value: string) => void;
  onApplySearch: () => void;
  softwareScope: SoftwareScope;
  onToggleSoftwareScope: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  filtersButtonRef: RefObject<HTMLButtonElement>;
  serverSwitcher?: ReactNode;
  viewMode: ViewMode;
  releaseTrack: ReleaseTrack;
  releaseTrackLocked: boolean;
  releaseTrackTooltip: string;
  onToggleReleaseTrack: () => void;
  viewMenuOpen: boolean;
  onToggleViewMenu: () => void;
  onSelectViewMode: (mode: ViewMode) => void;
  viewButtonRef: RefObject<HTMLButtonElement>;
  viewPopoverRef: RefObject<HTMLDivElement>;
};

export default function RoleDashboardToolbar({
  queryDraft,
  onQueryDraftChange,
  onApplySearch,
  softwareScope,
  onToggleSoftwareScope,
  filtersOpen,
  onToggleFilters,
  filtersButtonRef,
  serverSwitcher,
  viewMode,
  releaseTrack,
  releaseTrackLocked,
  releaseTrackTooltip,
  onToggleReleaseTrack,
  viewMenuOpen,
  onToggleViewMenu,
  onSelectViewMode,
  viewButtonRef,
  viewPopoverRef,
}: RoleDashboardToolbarProps) {
  return (
    <div className={styles.controlsRow}>
      <input
        value={queryDraft}
        onChange={(event) => onQueryDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onApplySearch();
          }
        }}
        placeholder={softwareScope === "bundles" ? "Search bundles" : "Search roles"}
        aria-label={softwareScope === "bundles" ? "Search bundles" : "Search roles"}
        className={`form-control ${styles.search}`}
      />
      <button
        ref={filtersButtonRef}
        onClick={onToggleFilters}
        className={`${styles.toolbarButton} ${styles.filterButton}`}
        aria-expanded={filtersOpen}
        title={
          softwareScope === "apps"
            ? "Open filters for rows, deploy target, lifecycle, selection, categories and tags"
            : "Open filters for rows, deploy target, lifecycle, categories and tags"
        }
      >
        <i className="fa-solid fa-filter" aria-hidden="true" />
        <span>Filters</span>
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
      {softwareScope === "apps" && serverSwitcher && viewMode !== "matrix" ? (
        <div className={styles.serverSwitcherSlot}>{serverSwitcher}</div>
      ) : null}
      <button
        type="button"
        onClick={onToggleSoftwareScope}
        className={`${styles.toolbarButton} ${styles.scopeToggleButton} ${
          softwareScope === "apps"
            ? styles.scopeToggleButtonApps
            : styles.scopeToggleButtonBundles
        }`}
        aria-label="Toggle apps and bundles"
        aria-pressed={softwareScope === "apps"}
        title={softwareScope === "apps" ? "Switch scope to bundles" : "Switch scope to apps"}
      >
        <i
          className={
            softwareScope === "apps" ? "fa-solid fa-toggle-on" : "fa-solid fa-toggle-off"
          }
          aria-hidden="true"
        />
        <span>{softwareScope === "apps" ? "Apps" : "Bundles"}</span>
      </button>
      <button
        type="button"
        onClick={onToggleReleaseTrack}
        className={`${styles.toolbarButton} ${styles.releaseTrackButton} ${
          releaseTrack === "preview"
            ? styles.releaseTrackButtonPreview
            : styles.releaseTrackButtonStable
        } ${releaseTrackLocked ? styles.releaseTrackButtonLocked : ""}`}
        aria-label="Toggle stable and preview release track"
        aria-pressed={releaseTrack === "preview"}
        title={releaseTrackTooltip}
        disabled={releaseTrackLocked}
      >
        <i
          className={
            releaseTrack === "preview" ? "fa-solid fa-flask" : "fa-solid fa-shield-halved"
          }
          aria-hidden="true"
        />
        <span>{releaseTrack === "preview" ? "Preview" : "Stable"}</span>
      </button>
      <div className={styles.viewModeControl}>
        <button
          ref={viewButtonRef}
          onClick={onToggleViewMenu}
          className={`${styles.viewModeButton} ${styles.viewModeButtonActive}`}
          aria-haspopup="menu"
          aria-expanded={viewMenuOpen}
        >
          <i className={VIEW_MODE_ICONS[viewMode]} aria-hidden="true" />
          <span>{formatViewLabel(viewMode)}</span>
          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
        {viewMenuOpen ? (
          <div ref={viewPopoverRef} className={styles.viewModeMenu} role="menu">
            {DEFAULT_VIEW_MODES.map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onSelectViewMode(mode)}
                  className={`${styles.viewModeMenuItem} ${
                    active ? styles.viewModeMenuItemActive : ""
                  }`}
                >
                  <i className={VIEW_MODE_ICONS[mode]} aria-hidden="true" />
                  <span>{formatViewLabel(mode)}</span>
                </button>
              );
            })}
            <div
              key="view-mode-group-animated"
              className={styles.viewModeMenuSectionLabel}
              role="presentation"
            >
              Animated
            </div>
            {ANIMATED_VIEW_MODES.map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onSelectViewMode(mode)}
                  className={`${styles.viewModeMenuItem} ${
                    active ? styles.viewModeMenuItemActive : ""
                  }`}
                >
                  <i className={VIEW_MODE_ICONS[mode]} aria-hidden="true" />
                  <span>{formatViewLabel(mode)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
