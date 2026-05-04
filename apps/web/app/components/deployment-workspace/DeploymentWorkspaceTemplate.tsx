import { useCallback, useEffect, useState } from "react";
import ProviderOrderPanel from "../ProviderOrderPanel";
import WorkspaceNavSegment from "./WorkspaceNavSegment";
import styles from "../DeploymentWorkspace.module.css";
import { USER_STORAGE_KEY } from "../workspace-panel/utils";
import {
  PANEL_ICON_BY_KEY,
  type DomainCheckResult,
  type DomainKind,
  type OrderedProviderServer,
  type PanelKey,
  type WorkspaceTabPanel,
} from "./types";

// Shared with AccountPanel: dispatched on storage mutations so other
// components in the same tab pick up login/logout immediately (the
// browser only fires the native `storage` event on OTHER tabs).
const ACCOUNT_SESSION_UPDATED_EVENT = "infinito:account-session-updated";
// Opens AccountPanel's auth modal from outside (header Login button).
const ACCOUNT_OPEN_AUTH_EVENT = "infinito:account-open-auth";

type DeployRolePickerView = {
  open: boolean;
  query: string;
  summary: string;
  options: string[];
  selected: Set<string>;
  inventoryRoleIds: string[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onToggleRole: (roleId: string) => void;
};

type DetailSearchView = {
  open: boolean;
  targetAlias: string | null;
  baseUrl: string;
  workspaceId: string | null;
  workspacePrimaryDomain: string;
  onClose: () => void;
  onOrderedServer: (device: OrderedProviderServer) => void;
};

type ExpertModeConfirmView = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

type ModeSwitchView = {
  mode: "customer" | "expert";
  onModeChange: (mode: "customer" | "expert") => void;
};

type DomainPopupView = {
  open: boolean;
  saving: boolean;
  prompt: string | null;
  type: DomainKind;
  error: string | null;
  fqdnValue: string;
  fqdnCheckBusy: boolean;
  fqdnCheckResult: DomainCheckResult | null;
  localValue: string;
  subLabel: string;
  parentFqdn: string;
  fqdnOptions: string[];
  onClose: () => void;
  onSelectType: (kind: DomainKind) => void;
  onFqdnValueChange: (value: string) => void;
  onCheckFqdn: () => void;
  onLocalValueChange: (value: string) => void;
  onSubLabelChange: (value: string) => void;
  onParentFqdnChange: (value: string) => void;
  onAddDomain: () => void;
};

type DeploymentWorkspaceTemplateProps = {
  panels: WorkspaceTabPanel[];
  activePanel: PanelKey;
  onSelectPanel: (panel: PanelKey) => void;
  deployRolePicker: DeployRolePickerView;
  detailSearch: DetailSearchView;
  expertModeConfirm: ExpertModeConfirmView;
  modeSwitch: ModeSwitchView;
  domainPopup: DomainPopupView;
};

function readUserIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const value = String(window.localStorage.getItem(USER_STORAGE_KEY) || "")
    .trim()
    .toLowerCase();
  return value || null;
}

export default function DeploymentWorkspaceTemplate({
  panels,
  activePanel,
  onSelectPanel,
  deployRolePicker,
  detailSearch,
  expertModeConfirm,
  modeSwitch,
  domainPopup,
}: DeploymentWorkspaceTemplateProps) {
  // Mirror AccountPanel's localStorage session so the header switch
  // button stays in sync without lifting state up. We listen to both
  // the native cross-tab `storage` event and the in-tab custom event
  // AccountPanel dispatches whenever it mutates the session.
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  useEffect(() => {
    setAuthUserId(readUserIdFromStorage());
    if (typeof window === "undefined") return;
    const sync = () => setAuthUserId(readUserIdFromStorage());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== USER_STORAGE_KEY) return;
      sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ACCOUNT_SESSION_UPDATED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ACCOUNT_SESSION_UPDATED_EVENT, sync);
    };
  }, []);

  // Settings tab is auth-gated: hidden from the tablist + skipped by
  // next/prev nav when logged out. The panel content itself stays in
  // the tabFrame so the header Login button can still surface the
  // AccountPanel modal for anonymous visitors.
  const visiblePanels = panels.filter(
    (panel) => !(panel.key === "account" && !authUserId),
  );
  const enabledPanels = visiblePanels.filter((panel) => !panel.disabled);
  const activeIndex = enabledPanels.findIndex((panel) => panel.key === activePanel);
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < enabledPanels.length - 1;

  const onAuthClick = useCallback(() => {
    if (typeof window === "undefined") return;
    if (authUserId) {
      // Logout path: clear the session and announce the change so
      // AccountPanel + this footer both re-render anonymous. Stay on
      // the current panel — the user did not ask to leave it.
      window.localStorage.removeItem(USER_STORAGE_KEY);
      window.dispatchEvent(new Event(ACCOUNT_SESSION_UPDATED_EVENT));
      setAuthUserId(null);
    } else {
      // Login path: dispatch the open-auth event so AccountPanel's
      // portal-mounted modal overlays the current view. We do NOT
      // navigate to Settings — the user only asked for the modal.
      // AccountPanel must stay mounted (see keepMounted below) so its
      // event listener is alive even when Settings isn't the active
      // panel.
      window.dispatchEvent(new Event(ACCOUNT_OPEN_AUTH_EVENT));
    }
  }, [authUserId]);

  return (
    <div className={styles.root}>
      <div className={styles.panels}>
        <div
          className={styles.tabList}
          role="tablist"
          aria-label="Workspace sections"
        >
          {visiblePanels.map((panel) => {
            const isDisabled = Boolean(panel.disabled);
            const isActive = !isDisabled && activePanel === panel.key;
            return (
              <button
                key={panel.key}
                type="button"
                onClick={() => {
                  if (isDisabled) return;
                  onSelectPanel(panel.key);
                }}
                disabled={isDisabled}
                title={isDisabled ? panel.disabledReason : undefined}
                role="tab"
                id={`tab-${panel.key}`}
                aria-controls={`panel-${panel.key}`}
                aria-selected={isActive}
                data-panel-key={panel.key}
                className={`${styles.tabButton} ${
                  isActive ? styles.tabButtonActive : ""
                } ${isDisabled ? styles.tabButtonDisabled : ""}`}
              >
                <i
                  className={`fa-solid ${PANEL_ICON_BY_KEY[panel.key]} ${styles.tabIcon}`}
                  aria-hidden="true"
                />
                <span className={styles.tabTitle}>{panel.title}</span>
                {isDisabled ? <span className={styles.tabLock}>🔒</span> : null}
              </button>
            );
          })}
        </div>
        <div className={styles.tabFrame}>
          {panels.map((panel) => {
            const isDisabled = Boolean(panel.disabled);
            const isActive = !isDisabled && activePanel === panel.key;
            // AccountPanel must stay mounted so its global event
            // listener (ACCOUNT_OPEN_AUTH_EVENT) is alive even when
            // Settings is not the active tab. The modal it renders
            // is portaled to document.body so it overlays correctly.
            const keepMounted = panel.key === "inventory" || panel.key === "account";
            if (!isActive && !keepMounted) return null;
            return (
              <section
                key={panel.key}
                id={`panel-${panel.key}`}
                role="tabpanel"
                aria-labelledby={`tab-${panel.key}`}
                aria-hidden={!isActive}
                data-panel-key={panel.key}
                className={`${styles.tabPanel} ${isActive ? styles.tabPanelActive : ""}`}
              >
                {panel.content}
              </section>
            );
          })}
        </div>
      </div>
      {deployRolePicker.open ? (
        <div className={styles.rolePickerOverlay} onClick={deployRolePicker.onClose}>
          <div className={styles.rolePickerCard} onClick={(event) => event.stopPropagation()}>
            <div className={styles.rolePickerHeader}>
              <div>
                <h3 className={styles.rolePickerTitle}>Deploy App Filter</h3>
                <p className={`text-body-secondary ${styles.rolePickerHint}`}>
                  Selected apps are passed as <code>--id</code> for all selected
                  devices.
                </p>
              </div>
              <button
                type="button"
                onClick={deployRolePicker.onClose}
                className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
              >
                Close
              </button>
            </div>

            <input
              value={deployRolePicker.query}
              onChange={(event) => deployRolePicker.onQueryChange(event.target.value)}
              placeholder="Search apps"
              className={`form-control ${styles.rolePickerSearch}`}
            />

            <div className={styles.rolePickerActions}>
              <button
                type="button"
                onClick={deployRolePicker.onSelectAll}
                className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                disabled={deployRolePicker.inventoryRoleIds.length === 0}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={deployRolePicker.onClearAll}
                className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                disabled={deployRolePicker.inventoryRoleIds.length === 0}
              >
                Clear all
              </button>
              <span className={`text-body-secondary ${styles.rolePickerCount}`}>
                {deployRolePicker.summary}
              </span>
            </div>

            <div className={styles.rolePickerList}>
              {deployRolePicker.options.length === 0 ? (
                <span className={`text-body-secondary ${styles.rolePickerEmpty}`}>
                  No matching apps found.
                </span>
              ) : (
                deployRolePicker.options.map((roleId) => (
                  <label key={roleId} className={styles.rolePickerItem}>
                    <input
                      type="checkbox"
                      checked={deployRolePicker.selected.has(roleId)}
                      onChange={() => deployRolePicker.onToggleRole(roleId)}
                    />
                    <span>{roleId}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      {detailSearch.open ? (
        <div className={styles.detailSearchOverlay} onClick={detailSearch.onClose}>
          <div className={styles.detailSearchCard} onClick={(event) => event.stopPropagation()}>
            <div className={styles.detailSearchHeader}>
              <div>
                <h3 className={styles.detailSearchTitle}>Detailed Server Search</h3>
                <p className={`text-body-secondary ${styles.detailSearchHint}`}>
                  Use advanced provider filters and order directly into your workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={detailSearch.onClose}
                className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
              >
                Close
              </button>
            </div>
            <div className={styles.detailSearchBody}>
              <ProviderOrderPanel
                baseUrl={detailSearch.baseUrl}
                workspaceId={detailSearch.workspaceId}
                primaryDomain={detailSearch.workspacePrimaryDomain}
                mode="expert"
                compareAlias={detailSearch.targetAlias}
                onOrderedServer={detailSearch.onOrderedServer}
              />
            </div>
          </div>
        </div>
      ) : null}
      {expertModeConfirm.open ? (
        <div onClick={expertModeConfirm.onCancel} className={styles.modeConfirmOverlay}>
          <div onClick={(event) => event.stopPropagation()} className={styles.modeConfirmCard}>
            <div className={styles.modeConfirmTitleRow}>
              <i
                className={`fa-solid fa-triangle-exclamation ${styles.modeConfirmIcon}`}
                aria-hidden="true"
              />
              <h3 className={styles.modeConfirmTitle}>Enable Expert mode?</h3>
            </div>
            <p className={styles.modeConfirmText}>
              Expert mode unlocks direct app configuration editing. Wrong values can
              cause misconfigurations.
            </p>
            <div className={styles.modeConfirmActions}>
              <button
                onClick={expertModeConfirm.onCancel}
                className={`${styles.modeActionButton} ${styles.modeActionButtonSuccess}`}
              >
                <i className="fa-solid fa-circle-check" aria-hidden="true" />
                <span>Cancel</span>
              </button>
              <button
                onClick={expertModeConfirm.onConfirm}
                className={`${styles.modeActionButton} ${styles.modeActionButtonDanger}`}
              >
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                <span>Enable</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {domainPopup.open ? (
        <div
          className={styles.primaryDomainOverlay}
          onClick={() => {
            if (domainPopup.saving) return;
            domainPopup.onClose();
          }}
        >
          <div className={styles.primaryDomainCard} onClick={(event) => event.stopPropagation()}>
            <div className={styles.primaryDomainTitleRow}>
              <i
                className={`fa-solid fa-circle-plus ${styles.primaryDomainIcon}`}
                aria-hidden="true"
              />
              <h3 className={styles.primaryDomainTitle}>Add Domain</h3>
            </div>
            <p className={styles.primaryDomainText}>
              Choose how to add the domain entry. Subdomains must belong to an
              existing FQDN.
            </p>
            {domainPopup.prompt ? (
              <p className={styles.domainPopupPrompt}>{domainPopup.prompt}</p>
            ) : null}

            <div className={styles.domainPopupTypeRow}>
              <button
                type="button"
                onClick={() => domainPopup.onSelectType("fqdn")}
                className={`${styles.modeActionButton} ${
                  domainPopup.type === "fqdn" ? styles.modeActionButtonSuccess : ""
                }`}
              >
                <i className="fa-solid fa-globe" aria-hidden="true" />
                <span>FQDN</span>
              </button>
              <button
                type="button"
                onClick={() => domainPopup.onSelectType("local")}
                className={`${styles.modeActionButton} ${
                  domainPopup.type === "local" ? styles.modeActionButtonSuccess : ""
                }`}
              >
                <i className="fa-solid fa-house" aria-hidden="true" />
                <span>Local</span>
              </button>
              <button
                type="button"
                onClick={() => domainPopup.onSelectType("subdomain")}
                className={`${styles.modeActionButton} ${
                  domainPopup.type === "subdomain" ? styles.modeActionButtonSuccess : ""
                }`}
              >
                <i className="fa-solid fa-sitemap" aria-hidden="true" />
                <span>Subdomain</span>
              </button>
            </div>

            {domainPopup.type === "fqdn" ? (
              <div className={styles.domainPopupFieldGrid}>
                <input
                  value={domainPopup.fqdnValue}
                  onChange={(event) => domainPopup.onFqdnValueChange(event.target.value)}
                  placeholder="FQDN (example: shop.example.org)"
                  className={`form-control ${styles.primaryDomainInput}`}
                />
                <div className={styles.primaryDomainCheckRow}>
                  <button
                    type="button"
                    onClick={() => domainPopup.onCheckFqdn()}
                    disabled={domainPopup.fqdnCheckBusy}
                    className={`${styles.modeActionButton} ${styles.primaryDomainCheckButton}`}
                  >
                    <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    <span>
                      {domainPopup.fqdnCheckBusy ? "Checking..." : "Check availability"}
                    </span>
                  </button>
                  {domainPopup.fqdnCheckResult ? (
                    <p
                      className={`${styles.primaryDomainCheckNote} ${
                        domainPopup.fqdnCheckResult.available
                          ? styles.primaryDomainCheckAvailable
                          : styles.primaryDomainCheckTaken
                      }`}
                    >
                      {domainPopup.fqdnCheckResult.note}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {domainPopup.type === "local" ? (
              <input
                value={domainPopup.localValue}
                onChange={(event) => domainPopup.onLocalValueChange(event.target.value)}
                placeholder="localhost"
                className={`form-control ${styles.primaryDomainInput}`}
              />
            ) : null}

            {domainPopup.type === "subdomain" ? (
              <div className={styles.domainPopupFieldGrid}>
                <input
                  value={domainPopup.subLabel}
                  onChange={(event) => domainPopup.onSubLabelChange(event.target.value)}
                  placeholder="Subdomain label (example: api)"
                  className={`form-control ${styles.primaryDomainInput}`}
                />
                <select
                  value={domainPopup.parentFqdn}
                  onChange={(event) => domainPopup.onParentFqdnChange(event.target.value)}
                  className={`form-select ${styles.primaryDomainInput}`}
                >
                  <option value="">Select parent FQDN</option>
                  {domainPopup.fqdnOptions.map((fqdn) => (
                    <option key={fqdn} value={fqdn}>
                      {fqdn}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {domainPopup.error ? (
              <p className={styles.primaryDomainError}>{domainPopup.error}</p>
            ) : null}

            <div className={styles.primaryDomainActions}>
              <button
                type="button"
                onClick={domainPopup.onClose}
                className={styles.modeActionButton}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                onClick={domainPopup.onAddDomain}
                className={`${styles.modeActionButton} ${styles.modeActionButtonSuccess}`}
              >
                <i className="fa-solid fa-plus" aria-hidden="true" />
                <span>Add</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={styles.navRow}>
        <button
          onClick={() => hasPrev && onSelectPanel(enabledPanels[activeIndex - 1].key)}
          disabled={!hasPrev}
          className={`${styles.navButton} ${styles.backButton} ${
            hasPrev ? styles.backEnabled : styles.backDisabled
          }`}
        >
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          <span>Back</span>
        </button>
        <div className={styles.authModeGroup} role="group" aria-label="Session and mode">
          <button
            type="button"
            onClick={onAuthClick}
            data-testid="auth-toggle-button"
            aria-label={authUserId ? "Logout" : "Login"}
            className={`${styles.navButton} ${styles.authModeStart} ${
              authUserId ? styles.authNavLoggedIn : styles.authNavLoggedOut
            }`}
          >
            <i
              className={`fa-solid ${authUserId ? "fa-right-from-bracket" : "fa-right-to-bracket"}`}
              aria-hidden="true"
            />
            <span>{authUserId ? "Logout" : "Login"}</span>
          </button>
          <WorkspaceNavSegment />
          <button
            type="button"
            onClick={() =>
              modeSwitch.onModeChange(modeSwitch.mode === "expert" ? "customer" : "expert")
            }
            data-testid="mode-toggle-button"
            aria-label="Toggle basic/expert mode"
            aria-pressed={modeSwitch.mode === "expert"}
            className={`${styles.navButton} ${styles.authModeEnd} ${
              modeSwitch.mode === "expert" ? styles.modeExpert : styles.modeBasic
            }`}
          >
            <i
              className={`fa-solid ${
                modeSwitch.mode === "expert" ? "fa-toggle-on" : "fa-toggle-off"
              }`}
              aria-hidden="true"
            />
            <span>{modeSwitch.mode === "expert" ? "Expert" : "Basic"}</span>
          </button>
        </div>
        <button
          onClick={() => hasNext && onSelectPanel(enabledPanels[activeIndex + 1].key)}
          disabled={!hasNext}
          className={`${styles.navButton} ${styles.nextButton} ${
            hasNext ? styles.nextEnabled : styles.nextDisabled
          }`}
        >
          <span>Next</span>
          <i className="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
