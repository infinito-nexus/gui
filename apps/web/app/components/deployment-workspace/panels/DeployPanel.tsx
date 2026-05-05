import type { CSSProperties } from "react";
import LiveDeploymentView from "../../live/View";
import styles from "../../deployment/workspace/Main.module.css";
import type { ServerState } from "../../deployment-credentials/types";
import {
  createDeviceStyle,
  isPortInvalid,
  normalizePortValue,
} from "../helpers";

type DeployConnectionState = {
  rowClass: string;
  label: string;
  toneClass: string;
  tooltip: string;
};

type DeployPanelProps = {
  baseUrl: string;
  streamBaseUrl?: string;
  deployViewTab: "live-log" | "terminal";
  onDeployViewTabChange: (tab: "live-log" | "terminal") => void;
  deployError: string | null;
  liveError: string | null;
  infinitoNexusVersion: string;
  infinitoNexusVersionOptions: Array<{ value: string; label: string }>;
  infinitoNexusVersionBusy: boolean;
  infinitoNexusVersionError: string | null;
  onInfinitoNexusVersionChange: (value: string) => void;
  deployTableStyle: CSSProperties;
  deploySelection: Set<string>;
  servers: ServerState[];
  selectedRolesByAlias: Record<string, string[]>;
  deployRoleFilter: Set<string>;
  deployedAliases: Set<string>;
  onUpdateServer: (alias: string, patch: Partial<ServerState>) => void;
  onTestConnection: (server: ServerState) => void | Promise<void>;
  isAuthMissing: (server: ServerState) => boolean;
  getConnectionState: (server: ServerState) => DeployConnectionState;
  onOpenCredentials: (alias: string) => void;
  onToggleDeployAlias: (alias: string) => void;
  onOpenDeployRolePicker: () => void;
  inventoryRoleIds: string[];
  deployRoleSummary: string;
  selectableAliases: string[];
  onSelectAllDeployAliases: () => void;
  onDeselectAllDeployAliases: () => void;
  liveJobId: string;
  onLiveJobIdChange: (value: string) => void;
  onRequestConnect: () => void;
  onStartDeployment: () => void;
  onRequestCancel: () => void;
  canDeploy: boolean;
  deploying: boolean;
  liveConnected: boolean;
  liveCanceling: boolean;
  connectRequestKey: number;
  cancelRequestKey: number;
  onJobIdSync: (jobId: string) => void;
  onConnectedChange: (connected: boolean) => void;
  onCancelingChange: (canceling: boolean) => void;
  onLiveErrorChange: (error: string | null) => void;
  onStatusChange: (status: { job_id?: string; status?: string } | null) => void;
};

function enabledSmallButton(disabled: boolean): string {
  return `${styles.smallButton} ${
    disabled ? styles.smallButtonDisabled : styles.smallButtonEnabled
  }`;
}

function computeRoleView(
  roles: string[],
  deployRoleFilter: Set<string>
): { hasRoles: boolean; text: string; title: string } {
  const filtered = roles.filter(
    (roleId) => deployRoleFilter.size === 0 || deployRoleFilter.has(roleId)
  );
  if (filtered.length === 0) {
    return { hasRoles: false, text: "-", title: "No apps selected" };
  }
  const sorted = [...filtered].sort((a, b) => a.localeCompare(b));
  return {
    hasRoles: true,
    text: `${filtered.length} apps`,
    title: sorted.join(", "),
  };
}

export default function DeployPanel({
  baseUrl,
  streamBaseUrl,
  deployViewTab,
  onDeployViewTabChange,
  deployError,
  liveError,
  infinitoNexusVersion,
  infinitoNexusVersionOptions,
  infinitoNexusVersionBusy,
  infinitoNexusVersionError,
  onInfinitoNexusVersionChange,
  deployTableStyle,
  deploySelection,
  servers,
  selectedRolesByAlias,
  deployRoleFilter,
  deployedAliases,
  onUpdateServer,
  onTestConnection,
  isAuthMissing,
  getConnectionState,
  onOpenCredentials,
  onToggleDeployAlias,
  onOpenDeployRolePicker,
  inventoryRoleIds,
  deployRoleSummary,
  selectableAliases,
  onSelectAllDeployAliases,
  onDeselectAllDeployAliases,
  liveJobId,
  onLiveJobIdChange,
  onRequestConnect,
  onStartDeployment,
  onRequestCancel,
  canDeploy,
  deploying,
  liveConnected,
  liveCanceling,
  connectRequestKey,
  cancelRequestKey,
  onJobIdSync,
  onConnectedChange,
  onCancelingChange,
  onLiveErrorChange,
  onStatusChange,
}: DeployPanelProps) {
  return (
    <div className={styles.deployLayout}>
      <div className={styles.deployTabs}>
        <button
          type="button"
          onClick={() => onDeployViewTabChange("live-log")}
          className={`${styles.deployTabButton} ${
            deployViewTab === "live-log" ? styles.deployTabButtonActive : ""
          }`}
        >
          Deploy devices
        </button>
        <button
          type="button"
          onClick={() => onDeployViewTabChange("terminal")}
          className={`${styles.deployTabButton} ${
            deployViewTab === "terminal" ? styles.deployTabButtonActive : ""
          }`}
        >
          Terminal
        </button>
      </div>

      {deployError ? <div className={styles.errorText}>{deployError}</div> : null}
      {liveError ? <div className={styles.errorText}>{liveError}</div> : null}
      {infinitoNexusVersionError ? (
        <div className={styles.errorText}>{infinitoNexusVersionError}</div>
      ) : null}

      <div className={styles.deployBody}>
        <div
          className={`${styles.deployTabPanel} ${
            deployViewTab === "live-log" ? styles.deployTabPanelActive : ""
          }`}
          aria-hidden={deployViewTab !== "live-log"}
        >
          <div className={styles.serverTableCard} style={deployTableStyle}>
            <div className={styles.serverTableTop}>
              <span className={styles.serverTableTitle}>Deploy devices</span>
              <div className={styles.serverTableMetaGroup}>
                <label className={styles.versionSelectLabel}>
                  <span>Infinito.Nexus</span>
                  <select
                    value={infinitoNexusVersion}
                    onChange={(event) =>
                      onInfinitoNexusVersionChange(event.target.value)
                    }
                    disabled={infinitoNexusVersionBusy}
                    className={`form-select form-select-sm ${styles.versionSelect}`}
                    aria-label="Infinito.Nexus version"
                  >
                    {infinitoNexusVersionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className={`text-body-secondary ${styles.serverTableMeta}`}>
                  {deploySelection.size} selected
                </span>
              </div>
            </div>
            <div className={styles.serverTableHeader}>
              <span>Status</span>
              <span>Device</span>
              <span>Host</span>
              <span>Port</span>
              <span>User</span>
              <span>Apps</span>
              <span>Edit</span>
              <span>Select</span>
            </div>
            <div className={styles.serverTableRows}>
              {servers.map((server) => {
                const alias = String(server.alias || "").trim();
                if (!alias) return null;

                const roleView = computeRoleView(
                  selectedRolesByAlias?.[alias] ?? [],
                  deployRoleFilter
                );
                const isDeployed = deployedAliases.has(alias);
                const isSelected = deploySelection.has(alias);
                const hostMissing = !String(server.host || "").trim();
                const userMissing = !String(server.user || "").trim();
                const portInvalid = isPortInvalid(server.port);
                const authMissing = isAuthMissing(server);
                const appsMissing = !roleView.hasRoles;
                const isConfigured =
                  !hostMissing && !userMissing && !portInvalid && !authMissing;
                const isSelectable = roleView.hasRoles && isConfigured && !isDeployed;
                const connectionState = getConnectionState(server);
                const statusToneClass = isDeployed
                  ? styles.statusDotGreen
                  : connectionState.toneClass;
                const statusTooltip = isDeployed
                  ? "Device was included in the last successful deployment."
                  : roleView.hasRoles
                  ? connectionState.tooltip
                  : "No apps selected for this device.";
                const tintAllowed =
                  !isDeployed &&
                  isConfigured &&
                  connectionState.rowClass !== styles.serverRowMissingCredentials;
                const rowStyle = tintAllowed
                  ? createDeviceStyle(server.color, {
                      backgroundAlpha: 0.16,
                      borderAlpha: 0.56,
                      outlineAlpha: 0.86,
                    })
                  : undefined;

                return (
                  <div
                    key={alias}
                    data-server-alias={alias}
                    className={`${styles.serverRow} ${connectionState.rowClass} ${
                      isSelected ? styles.serverRowSelected : ""
                    } ${tintAllowed ? styles.serverRowTinted : ""}`}
                    style={rowStyle}
                  >
                    <div
                      className={`${styles.statusCell} ${
                        isDeployed ? styles.statusCellDeployed : ""
                      }`}
                    >
                      <button
                        type="button"
                        className={styles.statusDotButton}
                        title={statusTooltip}
                        aria-label={`Status: ${
                          isDeployed ? "Deployed" : connectionState.label
                        }`}
                      >
                        <span
                          className={`${styles.statusDot} ${statusToneClass}`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    <span className={styles.aliasCell}>
                      <span className={styles.aliasWithEmoji}>
                        <span aria-hidden="true">{server.logoEmoji || "\u{1F4BB}"}</span>
                        <span>{alias}</span>
                      </span>
                    </span>
                    <div className={styles.tableInputWrap}>
                      <input
                        value={server.host}
                        onChange={(event) =>
                          onUpdateServer(alias, { host: event.target.value })
                        }
                        onBlur={(event) =>
                          void onTestConnection({
                            ...server,
                            host: event.currentTarget.value,
                          })
                        }
                        placeholder="example.com"
                        className={`${styles.tableInput} ${
                          hostMissing ? styles.tableInputMissing : ""
                        }`}
                      />
                      {hostMissing ? (
                        <span className={styles.cellAlert} title="Host is required.">
                          !
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.tableInputWrap}>
                      <input
                        type="number"
                        value={server.port}
                        onChange={(event) =>
                          onUpdateServer(alias, {
                            port: normalizePortValue(event.target.value),
                          })
                        }
                        onBlur={() => {
                          const normalized = normalizePortValue(server.port) || "22";
                          onUpdateServer(alias, { port: normalized });
                          void onTestConnection({ ...server, port: normalized });
                        }}
                        placeholder="22"
                        min={1}
                        max={65535}
                        step={1}
                        inputMode="numeric"
                        className={`${styles.tableInput} ${
                          portInvalid ? styles.tableInputMissing : ""
                        }`}
                      />
                      {portInvalid ? (
                        <span
                          className={styles.cellAlert}
                          title="Port must be between 1 and 65535."
                        >
                          !
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.tableInputWrap}>
                      <input
                        value={server.user}
                        onChange={(event) =>
                          onUpdateServer(alias, { user: event.target.value })
                        }
                        onBlur={(event) =>
                          void onTestConnection({
                            ...server,
                            user: event.currentTarget.value,
                          })
                        }
                        placeholder="root"
                        className={`${styles.tableInput} ${
                          userMissing ? styles.tableInputMissing : ""
                        }`}
                      />
                      {userMissing ? (
                        <span className={styles.cellAlert} title="User is required.">
                          !
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.appsCell} title={roleView.title}>
                      <span className={styles.roleCell}>{roleView.text}</span>
                      {appsMissing ? (
                        <span
                          className={styles.cellAlert}
                          title="Select at least one app for this device."
                        >
                          !
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.credentialsCell}>
                      <button
                        type="button"
                        onClick={() => onOpenCredentials(alias)}
                        className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                      >
                        <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    </div>
                    <div>
                      <input
                        type="checkbox"
                        aria-label={`Select ${alias}`}
                        checked={isSelected}
                        disabled={!isSelectable}
                        onChange={() => onToggleDeployAlias(alias)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.serverTableFooter}>
              <button
                type="button"
                onClick={onOpenDeployRolePicker}
                className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                disabled={inventoryRoleIds.length === 0}
                title="Choose apps passed to infinito deploy --id"
              >
                <i className="fa-solid fa-list-check" aria-hidden="true" />
                <span>Apps: {deployRoleSummary}</span>
              </button>
              <button
                onClick={onSelectAllDeployAliases}
                disabled={selectableAliases.length === 0}
                className={enabledSmallButton(selectableAliases.length === 0)}
              >
                Select all
              </button>
              <button
                onClick={onDeselectAllDeployAliases}
                disabled={selectableAliases.length === 0}
                className={enabledSmallButton(selectableAliases.length === 0)}
              >
                Deselect all
              </button>
            </div>
          </div>
        </div>

        <div
          className={`${styles.deployTabPanel} ${
            deployViewTab === "terminal" ? styles.deployTabPanelActive : ""
          }`}
          aria-hidden={deployViewTab !== "terminal"}
        >
          <div className={styles.liveWrap}>
            <LiveDeploymentView
              baseUrl={baseUrl}
              streamBaseUrl={streamBaseUrl}
              jobId={liveJobId}
              compact
              fill
              hideControls
              connectRequestKey={connectRequestKey}
              cancelRequestKey={cancelRequestKey}
              onJobIdSync={onJobIdSync}
              onConnectedChange={onConnectedChange}
              onCancelingChange={onCancelingChange}
              onErrorChange={onLiveErrorChange}
              onStatusChange={onStatusChange}
            />
          </div>
        </div>
      </div>

      <div className={styles.deployFooter}>
        <input
          value={liveJobId}
          onChange={(event) => onLiveJobIdChange(event.target.value)}
          placeholder="Job ID"
          className={`form-control ${styles.jobInput}`}
        />
        <button
          type="button"
          onClick={onRequestConnect}
          disabled={!liveJobId.trim() || liveConnected}
          className={`btn btn-info ${styles.footerButton}`}
        >
          {liveConnected ? "Connected" : "Connect"}
        </button>
        <button
          type="button"
          onClick={onStartDeployment}
          disabled={!canDeploy}
          className={`btn btn-success ${styles.footerButton}`}
        >
          {deploying ? "Deploying..." : "Deploy"}
        </button>
        <button
          type="button"
          onClick={onRequestCancel}
          disabled={!liveJobId.trim() || liveCanceling || !liveConnected}
          className={`btn btn-danger ${styles.footerButton}`}
        >
          {liveCanceling ? "Canceling..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}
