"use client";

import type { ReactNode, RefObject } from "react";

import styles from "../DeploymentCredentialsForm.module.css";
import RemoveServerModal from "./RemoveServerModal";
import ServerCollectionView from "./ServerCollectionView";
import {
  ANIMATED_SERVER_VIEW_MODES,
  DEFAULT_SERVER_VIEW_MODES,
  SERVER_VIEW_ICONS,
  formatViewLabel,
} from "./DeploymentCredentialsForm.constants";
import type {
  CredentialBlurPayload,
  PendingServerAction,
} from "./DeploymentCredentialsForm.types";
import type { ConnectionResult, ServerState, ServerViewMode } from "./types";

type DeploymentCredentialsFormTemplateProps = {
  compact: boolean;
  baseUrl: string;
  wrapperTag: "div" | "section";
  wrapperClassName: string;
  scrollRef: RefObject<HTMLDivElement>;
  controlsRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  filtersButtonRef: RefObject<HTMLButtonElement>;
  viewButtonRef: RefObject<HTMLButtonElement>;
  viewPopoverRef: RefObject<HTMLDivElement>;
  queryDraft: string;
  onQueryDraftChange: (value: string) => void;
  onApplySearch: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onAddServer: () => void;
  deviceMode?: "customer" | "expert";
  onDeviceModeChange?: (mode: "customer" | "expert") => void;
  viewMode: ServerViewMode;
  viewMenuOpen: boolean;
  onToggleViewMenu: () => void;
  onSelectViewMode: (mode: ServerViewMode) => void;
  paginatedServers: ServerState[];
  computedColumns: number;
  laneCount: number;
  laneSize: number;
  aliasCounts: Record<string, number>;
  connectionResults: Record<string, ConnectionResult>;
  workspaceId: string | null;
  onAliasChange: (alias: string, nextAlias: string) => void;
  onPatchServer: (alias: string, patch: Partial<ServerState>) => void;
  onOpenDetail: (alias: string) => void;
  onGenerateKey: (alias: string) => Promise<void> | void;
  onCredentialFieldBlur: (payload: CredentialBlurPayload) => Promise<void> | void;
  onRequestDelete: (aliases: string[]) => void;
  onRequestPurge: (aliases: string[]) => void;
  requestedDetailAlias: string | null;
  onRequestedDetailAliasHandled: () => void;
  onOpenDetailSearch?: (alias?: string) => void;
  primaryDomainOptions: string[];
  onRequestAddPrimaryDomain?: (request?: {
    alias?: string;
    value?: string;
    kind?: "local" | "fqdn" | "subdomain";
    parentFqdn?: string;
    subLabel?: string;
    reason?: "missing" | "unknown";
  }) => void;
  currentPage: number;
  pageCount: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  pendingAction: PendingServerAction;
  actionBusy: boolean;
  actionError: string | null;
  onCancelAction: () => void;
  onConfirmAction: () => void;
  filtersOverlay: ReactNode;
};

export default function DeploymentCredentialsFormTemplate({
  compact,
  baseUrl,
  wrapperTag: Wrapper,
  wrapperClassName,
  scrollRef,
  controlsRef,
  contentRef,
  filtersButtonRef,
  viewButtonRef,
  viewPopoverRef,
  queryDraft,
  onQueryDraftChange,
  onApplySearch,
  filtersOpen,
  onToggleFilters,
  onAddServer,
  deviceMode,
  onDeviceModeChange,
  viewMode,
  viewMenuOpen,
  onToggleViewMenu,
  onSelectViewMode,
  paginatedServers,
  computedColumns,
  laneCount,
  laneSize,
  aliasCounts,
  connectionResults,
  workspaceId,
  onAliasChange,
  onPatchServer,
  onOpenDetail,
  onGenerateKey,
  onCredentialFieldBlur,
  onRequestDelete,
  onRequestPurge,
  requestedDetailAlias,
  onRequestedDetailAliasHandled,
  onOpenDetailSearch,
  primaryDomainOptions,
  onRequestAddPrimaryDomain,
  currentPage,
  pageCount,
  onPrevPage,
  onNextPage,
  pendingAction,
  actionBusy,
  actionError,
  onCancelAction,
  onConfirmAction,
  filtersOverlay,
}: DeploymentCredentialsFormTemplateProps) {
  return (
    <Wrapper className={wrapperClassName}>
      {!compact ? (
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={`text-body ${styles.title}`}>Device</h2>
            <p className={`text-body-secondary ${styles.subtitle}`}>
              Configure device connections for deployments. Secrets can be stored in
              the workspace vault and are never persisted in browser storage.
            </p>
          </div>
          <div className={`text-body-secondary ${styles.headerRight}`}>
            API Base: <code>{baseUrl}</code>
          </div>
        </div>
      ) : null}

      <div className={`${styles.main} ${compact ? styles.mainCompact : ""}`}>
        <div ref={scrollRef} className={styles.scrollArea}>
          <div ref={controlsRef} className={styles.controls}>
            <div className={styles.controlsRow}>
              <input
                value={queryDraft}
                onChange={(event) => {
                  onQueryDraftChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApplySearch();
                  }
                }}
                placeholder="Search devices"
                aria-label="Search devices"
                className={`form-control ${styles.search}`}
              />
              <button
                ref={filtersButtonRef}
                onClick={onToggleFilters}
                className={`${styles.toolbarButton} ${styles.filterButton}`}
                aria-expanded={filtersOpen}
              >
                <i className="fa-solid fa-filter" aria-hidden="true" />
                <span>Filters</span>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
              </button>
              <button
                onClick={onAddServer}
                className={`${styles.toolbarButton} ${styles.addButton}`}
              >
                <i className="fa-solid fa-plus" aria-hidden="true" />
                <span>Add</span>
              </button>
              <div className={styles.controlsRight}>
                <div className={styles.viewModeControl}>
                  <button
                    ref={viewButtonRef}
                    onClick={onToggleViewMenu}
                    className={`${styles.modeButton} ${styles.modeButtonActive}`}
                    aria-haspopup="menu"
                    aria-expanded={viewMenuOpen}
                  >
                    <i className={SERVER_VIEW_ICONS[viewMode]} aria-hidden="true" />
                    <span>{formatViewLabel(viewMode)}</span>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </button>
                  {viewMenuOpen ? (
                    <div
                      ref={viewPopoverRef}
                      className={styles.viewModeMenu}
                      role="menu"
                    >
                      {DEFAULT_SERVER_VIEW_MODES.map((mode) => {
                        const active = viewMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => onSelectViewMode(mode)}
                            className={`${styles.viewModeMenuItem} ${
                              active ? styles.viewModeMenuItemActive : ""
                            }`}
                          >
                            <i className={SERVER_VIEW_ICONS[mode]} aria-hidden="true" />
                            <span>{formatViewLabel(mode)}</span>
                          </button>
                        );
                      })}
                      <span
                        className={`text-body-tertiary ${styles.viewModeMenuSectionLabel}`}
                      >
                        Animated
                      </span>
                      {ANIMATED_SERVER_VIEW_MODES.map((mode) => {
                        const active = viewMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => onSelectViewMode(mode)}
                            className={`${styles.viewModeMenuItem} ${
                              active ? styles.viewModeMenuItemActive : ""
                            }`}
                          >
                            <i className={SERVER_VIEW_ICONS[mode]} aria-hidden="true" />
                            <span>{formatViewLabel(mode)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div ref={contentRef} className={styles.contentWrap}>
            <ServerCollectionView
              viewMode={viewMode}
              paginatedServers={paginatedServers}
              computedColumns={computedColumns}
              laneCount={laneCount}
              laneSize={laneSize}
              aliasCounts={aliasCounts}
              testResults={connectionResults}
              workspaceId={workspaceId}
              onAliasChange={onAliasChange}
              onPatchServer={onPatchServer}
              onOpenDetail={onOpenDetail}
              onGenerateKey={onGenerateKey}
              onCredentialFieldBlur={onCredentialFieldBlur}
              onRequestDelete={onRequestDelete}
              onRequestPurge={onRequestPurge}
              requestedDetailAlias={requestedDetailAlias}
              onRequestedDetailAliasHandled={onRequestedDetailAliasHandled}
              deviceMode={deviceMode}
              onOpenDetailSearch={onOpenDetailSearch}
              primaryDomainOptions={primaryDomainOptions}
              onRequestAddPrimaryDomain={onRequestAddPrimaryDomain}
            />
          </div>
        </div>

        <div className={`text-body-secondary ${styles.pagination}`}>
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className={`${styles.pageButton} ${
              currentPage <= 1 ? styles.pageButtonDisabled : styles.pageButtonEnabled
            }`}
          >
            Prev
          </button>
          <span>
            Page {currentPage} / {pageCount}
          </span>
          <button
            onClick={onNextPage}
            disabled={currentPage >= pageCount}
            className={`${styles.pageButton} ${
              currentPage >= pageCount
                ? styles.pageButtonDisabled
                : styles.pageButtonEnabled
            }`}
          >
            Next
          </button>
        </div>
      </div>

      <RemoveServerModal
        mode={pendingAction?.mode ?? null}
        targets={pendingAction?.aliases ?? []}
        removeBusy={actionBusy}
        removeError={actionError}
        onCancel={onCancelAction}
        onConfirm={onConfirmAction}
      />
      {filtersOverlay}
    </Wrapper>
  );
}
