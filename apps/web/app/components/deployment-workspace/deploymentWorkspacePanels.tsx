"use client";

import type { ReactNode } from "react";
import RoleDashboard from "../RoleDashboard";
import DeploymentCredentialsForm from "../DeploymentCredentialsForm";
import WorkspacePanel from "../WorkspacePanel";
import styles from "../DeploymentWorkspace.module.css";
import IntroPanel from "./panels/IntroPanel";
import DomainPanel from "./panels/DomainPanel";
import DeployPanel from "./panels/DeployPanel";
import AccountPanel, { type AccountTabKey } from "./panels/AccountPanel";
import type {
  ConnectionResult,
  ServerState,
} from "../deployment-credentials/types";
import type {
  DomainEntry,
  DomainFilterKind,
  PanelKey,
  Role,
  RoleAppConfigResponse,
  WorkspaceTabPanel,
} from "./types";

type BuildDeploymentWorkspacePanelsProps = {
  baseUrl: string;
  streamBaseUrl?: string;
  roles: Role[];
  rolesLoading: boolean;
  rolesError: string | null;
  selectedRoles: string[];
  onToggleSelected: (id: string) => void;
  onLoadRoleAppConfig: (
    roleId: string,
    aliasOverride?: string
  ) => Promise<RoleAppConfigResponse>;
  onSaveRoleAppConfig: (
    roleId: string,
    content: string,
    aliasOverride?: string
  ) => Promise<RoleAppConfigResponse>;
  onImportRoleAppDefaults: (
    roleId: string,
    aliasOverride?: string
  ) => Promise<RoleAppConfigResponse>;
  activeAlias: string;
  servers: ServerState[];
  serverMetaByAlias: Record<string, { logoEmoji?: string | null; color?: string | null }>;
  selectedRolesByAlias: Record<string, string[]>;
  onToggleSelectedForAlias: (alias: string, id: string) => void;
  selectedPlansByAlias: Record<string, Record<string, string | null>>;
  onSelectRolePlanForAlias: (alias: string, roleId: string, planId: string | null) => void;
  serverSwitcher: ReactNode;
  onCreateServerForTarget: (target: string) => string | null;
  deviceMode: "customer" | "expert";
  onModeChange: (mode: "customer" | "expert") => void;
  domainFilterQuery: string;
  onDomainFilterQueryChange: (value: string) => void;
  domainFilterKind: DomainFilterKind;
  onDomainFilterKindChange: (value: DomainFilterKind) => void;
  onOpenAddDomain: (kind?: "fqdn" | "local" | "subdomain") => void;
  primaryDomainError: string | null;
  filteredDomainEntries: DomainEntry[];
  allDomainEntries: DomainEntry[];
  domainUsageByName: Map<string, number>;
  primaryDomainDraft: string;
  onSelectPrimaryDomain: (domain: string) => void;
  onOpenAddSubdomain: (parentFqdn: string) => void;
  onRemoveDomain: (domain: string) => void;
  workspaceId: string | null;
  connectionResults: Record<string, ConnectionResult>;
  onActiveAliasChange: (alias: string) => void;
  onUpdateServer: (alias: string, patch: Partial<ServerState>) => void;
  onConnectionResult: (alias: string, result: ConnectionResult) => void;
  onRemoveServer: (alias: string) => Promise<void>;
  onCleanupServer: (alias: string) => Promise<void>;
  onAddServer: (aliasHint?: string) => void;
  openCredentialsAlias: string | null;
  onOpenCredentialsAliasHandled: () => void;
  primaryDomainOptions: string[];
  onRequestAddPrimaryDomain: (request?: {
    alias?: string;
    value?: string;
    kind?: "local" | "fqdn" | "subdomain";
    parentFqdn?: string;
    subLabel?: string;
    reason?: "missing" | "unknown";
  }) => void;
  onOpenDetailSearch: (alias?: string) => void;
  credentials: {
    alias: string;
    description: string;
    primaryDomain: string;
    requirementServerType: string;
    requirementStorageGb: string;
    requirementLocation: string;
    host: string;
    port: string;
    user: string;
    color: string;
    logoEmoji: string;
    authMethod: string;
  };
  onCredentialsPatch: (patch: Partial<ServerState>) => void;
  onInventoryReadyChange: (ready: boolean) => void;
  onSelectedRolesByAliasChange: (rolesByAlias: Record<string, string[]>) => void;
  onWorkspaceIdChange: (workspaceId: string | null) => void;
  aliasRenames: Array<{ from: string; to: string }>;
  onAliasRenamesHandled: (count: number) => void;
  aliasDeletes: string[];
  onAliasDeletesHandled: (count: number) => void;
  aliasCleanups: string[];
  onAliasCleanupsHandled: (count: number) => void;
  selectionTouched: boolean;
  deployViewTab: "live-log" | "terminal";
  onDeployViewTabChange: (tab: "live-log" | "terminal") => void;
  deployError: string | null;
  liveError: string | null;
  infinitoNexusVersion: string;
  infinitoNexusVersionOptions: Array<{ value: string; label: string }>;
  infinitoNexusVersionBusy: boolean;
  infinitoNexusVersionError: string | null;
  onInfinitoNexusVersionChange: (value: string) => void;
  deployTableStyle: React.CSSProperties;
  deploySelection: Set<string>;
  deployRoleFilter: Set<string>;
  deployedAliases: Set<string>;
  onTestConnection: (server: ServerState) => Promise<void>;
  isAuthMissing: (server: ServerState) => boolean;
  getConnectionState: (server: ServerState) => {
    rowClass: string;
    label: string;
    toneClass: string;
    tooltip: string;
  };
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
  onStartDeployment: () => Promise<void>;
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
  accountTab: AccountTabKey;
  onAccountTabChange: (tab: AccountTabKey) => void;
};

export function buildDeploymentWorkspacePanels({
  baseUrl,
  streamBaseUrl,
  roles,
  rolesLoading,
  rolesError,
  selectedRoles,
  onToggleSelected,
  onLoadRoleAppConfig,
  onSaveRoleAppConfig,
  onImportRoleAppDefaults,
  activeAlias,
  servers,
  serverMetaByAlias,
  selectedRolesByAlias,
  onToggleSelectedForAlias,
  selectedPlansByAlias,
  onSelectRolePlanForAlias,
  serverSwitcher,
  onCreateServerForTarget,
  deviceMode,
  onModeChange,
  domainFilterQuery,
  onDomainFilterQueryChange,
  domainFilterKind,
  onDomainFilterKindChange,
  onOpenAddDomain,
  primaryDomainError,
  filteredDomainEntries,
  allDomainEntries,
  domainUsageByName,
  primaryDomainDraft,
  onSelectPrimaryDomain,
  onOpenAddSubdomain,
  onRemoveDomain,
  workspaceId,
  connectionResults,
  onActiveAliasChange,
  onUpdateServer,
  onConnectionResult,
  onRemoveServer,
  onCleanupServer,
  onAddServer,
  openCredentialsAlias,
  onOpenCredentialsAliasHandled,
  primaryDomainOptions,
  onRequestAddPrimaryDomain,
  onOpenDetailSearch,
  credentials,
  onCredentialsPatch,
  onInventoryReadyChange,
  onSelectedRolesByAliasChange,
  onWorkspaceIdChange,
  aliasRenames,
  onAliasRenamesHandled,
  aliasDeletes,
  onAliasDeletesHandled,
  aliasCleanups,
  onAliasCleanupsHandled,
  selectionTouched,
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
  deployRoleFilter,
  deployedAliases,
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
  accountTab,
  onAccountTabChange,
}: BuildDeploymentWorkspacePanelsProps): WorkspaceTabPanel[] {
  return [
    {
      key: "intro",
      title: "Intro",
      content: <IntroPanel />,
    },
    {
      key: "store",
      title: "Software",
      content: (
        <RoleDashboard
          baseUrl={baseUrl}
          roles={roles}
          loading={rolesLoading}
          error={rolesError}
          selected={new Set<string>(selectedRoles)}
          onToggleSelected={onToggleSelected}
          onLoadRoleAppConfig={onLoadRoleAppConfig}
          onSaveRoleAppConfig={onSaveRoleAppConfig}
          onImportRoleAppDefaults={onImportRoleAppDefaults}
          activeAlias={activeAlias}
          serverAliases={servers.map((server) => server.alias)}
          serverMetaByAlias={serverMetaByAlias}
          selectedByAlias={selectedRolesByAlias}
          onToggleSelectedForAlias={onToggleSelectedForAlias}
          selectedPlanByAlias={selectedPlansByAlias}
          onSelectPlanForAlias={onSelectRolePlanForAlias}
          serverSwitcher={serverSwitcher}
          onCreateServerForTarget={onCreateServerForTarget}
          mode={deviceMode}
          onModeChange={onModeChange}
          compact
        />
      ),
    },
    {
      key: "domain",
      title: "Domain",
      content: (
        <DomainPanel
          filterQuery={domainFilterQuery}
          onFilterQueryChange={onDomainFilterQueryChange}
          filterKind={domainFilterKind}
          onFilterKindChange={onDomainFilterKindChange}
          onOpenAddDomain={onOpenAddDomain}
          primaryDomainError={primaryDomainError}
          filteredEntries={filteredDomainEntries}
          allEntries={allDomainEntries}
          domainUsageByName={domainUsageByName}
          primaryDomainDraft={primaryDomainDraft}
          onSelectPrimaryDomain={onSelectPrimaryDomain}
          onOpenAddSubdomain={onOpenAddSubdomain}
          onRemoveDomain={onRemoveDomain}
        />
      ),
    },
    {
      key: "server",
      title: "Hardware",
      content: (
        <div className={styles.serverPanelStack}>
          <DeploymentCredentialsForm
            baseUrl={baseUrl}
            workspaceId={workspaceId}
            servers={servers}
            connectionResults={connectionResults}
            activeAlias={activeAlias}
            onActiveAliasChange={onActiveAliasChange}
            onUpdateServer={onUpdateServer}
            onConnectionResult={onConnectionResult}
            onRemoveServer={onRemoveServer}
            onCleanupServer={onCleanupServer}
            onAddServer={onAddServer}
            openCredentialsAlias={openCredentialsAlias}
            onOpenCredentialsAliasHandled={onOpenCredentialsAliasHandled}
            deviceMode={deviceMode}
            onDeviceModeChange={onModeChange}
            primaryDomainOptions={primaryDomainOptions}
            onRequestAddPrimaryDomain={onRequestAddPrimaryDomain}
            onOpenDetailSearch={onOpenDetailSearch}
            compact
          />
        </div>
      ),
    },
    {
      key: "inventory",
      title: "Inventory",
      content: (
        <div className={styles.inventoryPanelContent}>
          <WorkspacePanel
            baseUrl={baseUrl}
            selectedRolesByAlias={selectedRolesByAlias}
            credentials={credentials}
            onCredentialsPatch={onCredentialsPatch}
            onInventoryReadyChange={onInventoryReadyChange}
            onSelectedRolesByAliasChange={onSelectedRolesByAliasChange}
            onWorkspaceIdChange={onWorkspaceIdChange}
            aliasRenames={aliasRenames}
            onAliasRenamesHandled={onAliasRenamesHandled}
            aliasDeletes={aliasDeletes}
            onAliasDeletesHandled={onAliasDeletesHandled}
            aliasCleanups={aliasCleanups}
            onAliasCleanupsHandled={onAliasCleanupsHandled}
            selectionTouched={selectionTouched}
            compact
          />
        </div>
      ),
    },
    {
      key: "deploy",
      title: "Setup",
      content: (
        <DeployPanel
          baseUrl={baseUrl}
          streamBaseUrl={streamBaseUrl}
          deployViewTab={deployViewTab}
          onDeployViewTabChange={onDeployViewTabChange}
          deployError={deployError}
          liveError={liveError}
          infinitoNexusVersion={infinitoNexusVersion}
          infinitoNexusVersionOptions={infinitoNexusVersionOptions}
          infinitoNexusVersionBusy={infinitoNexusVersionBusy}
          infinitoNexusVersionError={infinitoNexusVersionError}
          onInfinitoNexusVersionChange={onInfinitoNexusVersionChange}
          deployTableStyle={deployTableStyle}
          deploySelection={deploySelection}
          servers={servers}
          selectedRolesByAlias={selectedRolesByAlias}
          deployRoleFilter={deployRoleFilter}
          deployedAliases={deployedAliases}
          onUpdateServer={onUpdateServer}
          onTestConnection={onTestConnection}
          isAuthMissing={isAuthMissing}
          getConnectionState={getConnectionState}
          onOpenCredentials={onOpenCredentials}
          onToggleDeployAlias={onToggleDeployAlias}
          onOpenDeployRolePicker={onOpenDeployRolePicker}
          inventoryRoleIds={inventoryRoleIds}
          deployRoleSummary={deployRoleSummary}
          selectableAliases={selectableAliases}
          onSelectAllDeployAliases={onSelectAllDeployAliases}
          onDeselectAllDeployAliases={onDeselectAllDeployAliases}
          liveJobId={liveJobId}
          onLiveJobIdChange={onLiveJobIdChange}
          onRequestConnect={onRequestConnect}
          onStartDeployment={onStartDeployment}
          onRequestCancel={onRequestCancel}
          canDeploy={canDeploy}
          deploying={deploying}
          liveConnected={liveConnected}
          liveCanceling={liveCanceling}
          connectRequestKey={connectRequestKey}
          cancelRequestKey={cancelRequestKey}
          onJobIdSync={onJobIdSync}
          onConnectedChange={onConnectedChange}
          onCancelingChange={onCancelingChange}
          onLiveErrorChange={onLiveErrorChange}
          onStatusChange={onStatusChange}
        />
      ),
    },
    {
      key: "account",
      title: "Settings",
      content: (
        <AccountPanel
          baseUrl={baseUrl}
          workspaceId={workspaceId ?? ""}
          roles={roles}
          selectedRolesByAlias={selectedRolesByAlias}
          selectedPlansByAlias={selectedPlansByAlias}
          activeTab={accountTab}
          onTabChange={onAccountTabChange}
        />
      ),
    },
  ];
}
