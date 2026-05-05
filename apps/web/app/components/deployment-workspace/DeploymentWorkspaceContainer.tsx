"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import DeploymentWorkspaceServerSwitcher from "../deployment/workspace/ServerSwitcher";
import type {
  ConnectionResult,
  ServerState,
} from "../deployment-credentials/types";
import DeploymentWorkspaceTemplate from "./DeploymentWorkspaceTemplate";
import {
  type AliasRename,
  type DeploymentWorkspaceProps,
  type DomainFilterKind,
  type DomainKind,
  type DomainEntry,
  type PanelKey,
  type Role,
} from "./types";
import {
  DEFAULT_PRIMARY_DOMAIN,
  createDefaultDomainEntries,
} from "./domain-utils";
import { type AccountTabKey } from "./panels/AccountPanel";
import { useWorkspaceDomainLogic } from "./useWorkspaceDomainLogic";

import { useWorkspaceServerSelectionActions } from "./useWorkspaceServerSelectionActions";
import { useDetachServerDomain } from "./useDetachServerDomain"; import { useAuthContext } from "./useAuthContext";
import { useWorkspaceDeploymentRuntime } from "./useWorkspaceDeploymentRuntime";
import { useWorkspaceRoleAppConfig } from "./useWorkspaceRoleAppConfig";
import { useWorkspaceSelectionDerived } from "./useWorkspaceSelectionDerived";
import { readSelectedByAlias, readSelectedPlansByAlias, useWorkspaceSelectionStorage } from "./useWorkspaceSelectionStorage";
import { buildDeploymentWorkspacePanels } from "./deploymentWorkspacePanels";
import { useWorkspaceServerMetadata } from "./useWorkspaceServerMetadata";
import { useDeploymentWorkspaceEffects } from "./useDeploymentWorkspaceEffects";
import { useInfinitoNexusVersion } from "./useInfinitoNexusVersion";
export default function DeploymentWorkspace({
  baseUrl,
  streamBaseUrl,
  onJobCreated,
  initialRoles = [],
  initialPanel = "store",
  initialWorkspaceId,
}: DeploymentWorkspaceProps) {
  const [roles, setRoles] = useState<Role[]>(() => initialRoles);
  const [rolesLoading, setRolesLoading] = useState(initialRoles.length === 0);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerState[]>([]);
  const [activeAlias, setActiveAlias] = useState("");
  const [selectedByAlias, setSelectedByAlias] = useState<
    Record<string, Set<string>>
  >(() => readSelectedByAlias(initialWorkspaceId ?? null));
  const [selectedPlansByAlias, setSelectedPlansByAlias] = useState<
    Record<string, Record<string, string | null>>
  >(() => readSelectedPlansByAlias(initialWorkspaceId ?? null));
  const [aliasRenames, setAliasRenames] = useState<AliasRename[]>([]);
  const [aliasDeletes, setAliasDeletes] = useState<string[]>([]);
  const [aliasCleanups, setAliasCleanups] = useState<string[]>([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [deploySelection, setDeploySelection] = useState<Set<string>>(
    new Set<string>()
  );
  const [deployRoleFilter, setDeployRoleFilter] = useState<Set<string>>(
    new Set<string>()
  );
  const [deployRolePickerOpen, setDeployRolePickerOpen] = useState(false);
  const [deployRoleQuery, setDeployRoleQuery] = useState("");
  const [deployedAliases, setDeployedAliases] = useState<Set<string>>(
    new Set<string>()
  );
  const [connectionResults, setConnectionResults] = useState<
    Record<string, ConnectionResult>
  >({});
  const [deployViewTab, setDeployViewTab] = useState<"live-log" | "terminal">(
    "live-log"
  );
  const lastDeploymentSelectionRef = useRef<string[] | null>(null);
  const uiQueryReadyRef = useRef(false);
  const pendingAliasFromQueryRef = useRef("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initialWorkspaceId ?? null
  );
  const [workspacePrimaryDomain, setWorkspacePrimaryDomain] = useState("");
  const [inventoryReady, setInventoryReady] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [liveJobId, setLiveJobId] = useState("");
  const [connectRequestKey, setConnectRequestKey] = useState(0);
  const [cancelRequestKey, setCancelRequestKey] = useState(0);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveCanceling, setLiveCanceling] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [openCredentialsAlias, setOpenCredentialsAlias] = useState<string | null>(
    null
  );
  const [deviceMode, setDeviceMode] = useState<"customer" | "expert">("customer");
  const [expertConfirmOpen, setExpertConfirmOpen] = useState(false);
  const [detailSearchOpen, setDetailSearchOpen] = useState(false);
  const [detailSearchTargetAlias, setDetailSearchTargetAlias] = useState<
    string | null
  >(null);
  const [primaryDomainDraft, setPrimaryDomainDraft] = useState("");
  const [primaryDomainModalError, setPrimaryDomainModalError] = useState<
    string | null
  >(null);
  const [primaryDomainModalSaving, setPrimaryDomainModalSaving] = useState(false);
  const [domainEntries, setDomainEntries] = useState<DomainEntry[]>(
    createDefaultDomainEntries
  );
  const [domainFilterQuery, setDomainFilterQuery] = useState("");
  const [domainFilterKind, setDomainFilterKind] = useState<DomainFilterKind>("all");
  const [domainPopupOpen, setDomainPopupOpen] = useState(false);
  const [domainPopupType, setDomainPopupType] = useState<DomainKind>("fqdn");
  const [domainPopupFqdnValue, setDomainPopupFqdnValue] = useState("");
  const [domainPopupFqdnCheckBusy, setDomainPopupFqdnCheckBusy] = useState(false);
  const [domainPopupFqdnCheckResult, setDomainPopupFqdnCheckResult] = useState<{
    available: boolean;
    note: string;
  } | null>(null);
  const [domainPopupLocalValue, setDomainPopupLocalValue] = useState(
    DEFAULT_PRIMARY_DOMAIN
  );
  const [domainPopupSubLabel, setDomainPopupSubLabel] = useState("");
  const [domainPopupParentFqdn, setDomainPopupParentFqdn] = useState("");
  const [domainPopupError, setDomainPopupError] = useState<string | null>(null);
  const [domainPopupPrompt, setDomainPopupPrompt] = useState<string | null>(null);
  const [domainPopupTargetAlias, setDomainPopupTargetAlias] = useState<
    string | null
  >(null);
  const [activePanel, setActivePanel] = useState<PanelKey>(initialPanel);
  const [accountTab, setAccountTab] = useState<AccountTabKey>("general");
  // Track authentication state from the AccountPanel's localStorage
  // session so the header's Login/Logout switch button mirrors it
  // without re-implementing the read.

  const handleModeChange = useCallback(
    (mode: "customer" | "expert") => {
      if (mode === deviceMode) return;
      if (mode === "expert") {
        setExpertConfirmOpen(true);
        return;
      }
      setExpertConfirmOpen(false);
      setDeviceMode("customer");
    },
    [deviceMode]
  );
  const cancelExpertMode = useCallback(() => {
    setExpertConfirmOpen(false);
  }, []);
  const confirmExpertMode = useCallback(() => {
    setExpertConfirmOpen(false);
    setDeviceMode("expert");
  }, []);
  const {
    primaryDomainOptions,
    fqdnDomainOptions,
    devicesByDomain,
    filteredDomainEntries,
    persistWorkspaceDomainSettings,
    openDomainPopup,
    closeDomainPopup,
    checkDomainPopupFqdn,
    addDomainFromPopup,
    removeDomainEntry,
    applyDomainStatus,
    addReservedDomain,
  } = useWorkspaceDomainLogic({
    baseUrl,
    workspaceId,
    servers,
    setServers,
    workspacePrimaryDomain,
    setWorkspacePrimaryDomain,
    primaryDomainDraft,
    setPrimaryDomainDraft,
    setPrimaryDomainModalError,
    setPrimaryDomainModalSaving,
    domainEntries,
    setDomainEntries,
    domainFilterQuery,
    domainFilterKind,
    domainPopupType,
    setDomainPopupType,
    domainPopupFqdnValue,
    setDomainPopupFqdnValue,
    setDomainPopupOpen,
    setDomainPopupError,
    setDomainPopupFqdnCheckBusy,
    setDomainPopupFqdnCheckResult,
    domainPopupLocalValue,
    setDomainPopupLocalValue,
    domainPopupSubLabel,
    setDomainPopupSubLabel,
    domainPopupParentFqdn,
    setDomainPopupParentFqdn,
    setDomainPopupPrompt,
    domainPopupTargetAlias,
    setDomainPopupTargetAlias,
  });
  const { createServer, persistDeviceVisualMetaForAlias, activeServer } =
    useWorkspaceServerMetadata({
      baseUrl,
      workspaceId,
      servers,
      setServers,
      activeAlias,
    });
  const {
    selectedRolesByAlias,
    selectedRoles,
    defaultPlanForRole,
    selectableAliases,
    inventoryRoleIds,
    deployRoleOptions,
    deployRoleSummary,
  } = useWorkspaceSelectionDerived({
    roles,
    selectedByAlias,
    setSelectedPlansByAlias,
    activeAlias,
    servers,
    deployedAliases,
    deployRoleFilter,
    deployRoleQuery,
    setDeploySelection,
    setDeployedAliases,
    setConnectionResults,
    setDeployRoleFilter,
  });
  useWorkspaceSelectionStorage(workspaceId, selectedByAlias, selectedPlansByAlias);
  const detachServerDomain = useDetachServerDomain(baseUrl, workspaceId, setServers);
  const isAdmin = useAuthContext(baseUrl).is_administrator;
  const {
    applySelectedRolesByAlias,
    updateServer,
    addServer,
    removeServer,
    cleanupServer,
    toggleSelectedForAlias,
    toggleSelected,
    toggleDeployAlias,
    selectAllDeployAliases,
    deselectAllDeployAliases,
    toggleDeployRole,
    selectAllDeployRoles,
    deselectAllDeployRoles,
    handleConnectionResult,
    handleProviderOrderedServer,
  } = useWorkspaceServerSelectionActions({
    servers,
    setServers,
    activeAlias,
    setActiveAlias,
    selectedByAlias,
    setSelectedByAlias,
    setSelectedPlansByAlias,
    defaultPlanForRole,
    persistDeviceVisualMetaForAlias,
    workspaceId,
    inventoryReady,
    setAliasDeletes,
    setAliasCleanups,
    setSelectionTouched,
    setConnectionResults,
    setOpenCredentialsAlias,
    setDeploySelection,
    setDeployRoleFilter,
    setDeployedAliases,
    setAliasRenames,
    selectableAliases,
    inventoryRoleIds,
  });
  const {
    loadRoleAppConfig,
    saveRoleAppConfig,
    selectRolePlanForAlias,
    importRoleAppDefaults,
  } = useWorkspaceRoleAppConfig({
    baseUrl,
    workspaceId,
    activeAlias,
    defaultPlanForRole,
    setSelectedByAlias,
    setSelectedPlansByAlias,
    setSelectionTouched,
  });
  const {
    infinitoNexusVersion,
    infinitoNexusVersionOptions,
    infinitoNexusVersionBusy,
    infinitoNexusVersionError,
    handleInfinitoNexusVersionChange,
  } = useInfinitoNexusVersion({ baseUrl, workspaceId });
  const {
    deploymentPlan,
    deploymentErrors,
    canDeploy,
    startDeployment,
    credentials,
    handleDeploymentStatus,
    deployTableStyle,
    isAuthMissing,
    canTestConnection,
    testConnectionForServer,
    getConnectionState,
    requestConnect,
    requestCancel,
    openCredentialsFor,
  } = useWorkspaceDeploymentRuntime({
    baseUrl,
    onJobCreated,
    activeServer,
    selectedRolesByAlias,
    deploySelection,
    selectableAliases,
    deployRoleFilter,
    workspaceId,
    inventoryReady,
    infinitoNexusVersion,
    deploying,
    setDeploying,
    setDeployError,
    setLiveJobId,
    setLiveError,
    setDeployViewTab,
    setConnectRequestKey,
    setCancelRequestKey,
    liveJobId,
    setDeployedAliases,
    lastDeploymentSelectionRef,
    connectionResults,
    handleConnectionResult,
    setActiveAlias,
    setOpenCredentialsAlias,
    setActivePanel,
  });
  const addServerWithDefaults = useCallback(
    (aliasHint?: string) => addServer(createServer, aliasHint),
    [addServer, createServer]
  );
  const serverSwitcher = (
    <DeploymentWorkspaceServerSwitcher
      currentAlias={activeAlias}
      servers={servers}
      onSelect={setActiveAlias}
      onCreate={addServerWithDefaults}
      onOpenServerTab={() => setActivePanel("server")}
    />
  );
  const serverMetaByAlias = useMemo(
    () =>
      Object.fromEntries(
        servers.map((server) => [
          server.alias,
          { logoEmoji: server.logoEmoji || "💻", color: server.color || "" },
        ])
      ) as Record<string, { logoEmoji?: string | null; color?: string | null }>,
    [servers]
  );
  const panels = buildDeploymentWorkspacePanels({
    baseUrl, streamBaseUrl, roles, rolesLoading, rolesError, selectedRoles,
    onToggleSelected: toggleSelected, onLoadRoleAppConfig: loadRoleAppConfig, onSaveRoleAppConfig: saveRoleAppConfig, onImportRoleAppDefaults: importRoleAppDefaults,
    activeAlias, servers, serverMetaByAlias, selectedRolesByAlias, onToggleSelectedForAlias: toggleSelectedForAlias, selectedPlansByAlias, onSelectRolePlanForAlias: selectRolePlanForAlias,
    serverSwitcher, onCreateServerForTarget: addServerWithDefaults, deviceMode, onModeChange: handleModeChange, domainFilterQuery, onDomainFilterQueryChange: setDomainFilterQuery,
    domainFilterKind, onDomainFilterKindChange: setDomainFilterKind, onOpenAddDomain: (kind = "fqdn") => openDomainPopup(kind), primaryDomainError: primaryDomainModalError,
    filteredDomainEntries, allDomainEntries: domainEntries, devicesByDomain, primaryDomainDraft,
    onSelectPrimaryDomain: (domain) => {
      setPrimaryDomainDraft(domain);
      setPrimaryDomainModalError(null);
      void persistWorkspaceDomainSettings({ entries: domainEntries, primaryDomain: domain });
    },
    onOpenAddSubdomain: (parentFqdn) => openDomainPopup("subdomain", { kind: "subdomain", parentFqdn }), onRemoveDomain: removeDomainEntry, onDomainStatusChanged: applyDomainStatus, onAddReservedDomain: addReservedDomain, onDetachServerDomain: detachServerDomain, isAdministrator: isAdmin,
    workspaceId, connectionResults, onActiveAliasChange: setActiveAlias, onUpdateServer: updateServer, onConnectionResult: handleConnectionResult,
    onRemoveServer: removeServer, onCleanupServer: cleanupServer, onAddServer: addServerWithDefaults, openCredentialsAlias, onOpenCredentialsAliasHandled: () => setOpenCredentialsAlias(null),
    primaryDomainOptions, onRequestAddPrimaryDomain: (request) => openDomainPopup("fqdn", request),
    onOpenDetailSearch: (alias) => {
      const targetAlias = String(alias || "").trim();
      setDetailSearchTargetAlias(targetAlias || null);
      setDetailSearchOpen(true);
    },
    credentials,
    onCredentialsPatch: (patch) => {
      if (!activeServer) return;
      updateServer(activeServer.alias, patch);
    },
    onInventoryReadyChange: setInventoryReady, onSelectedRolesByAliasChange: applySelectedRolesByAlias, onWorkspaceIdChange: setWorkspaceId,
    aliasRenames, onAliasRenamesHandled: (count) => setAliasRenames((prev) => prev.slice(count)),
    aliasDeletes, onAliasDeletesHandled: (count) => setAliasDeletes((prev) => prev.slice(count)),
    aliasCleanups, onAliasCleanupsHandled: (count) => setAliasCleanups((prev) => prev.slice(count)),
    selectionTouched, deployViewTab, onDeployViewTabChange: setDeployViewTab, deployError, liveError,
    infinitoNexusVersion, infinitoNexusVersionOptions, infinitoNexusVersionBusy, infinitoNexusVersionError,
    onInfinitoNexusVersionChange: (value) => {
      void handleInfinitoNexusVersionChange(value);
    },
    deployTableStyle, deploySelection, deployRoleFilter, deployedAliases,
    onTestConnection: testConnectionForServer, isAuthMissing, getConnectionState, onOpenCredentials: openCredentialsFor, onToggleDeployAlias: toggleDeployAlias,
    onOpenDeployRolePicker: () => setDeployRolePickerOpen(true), inventoryRoleIds, deployRoleSummary, selectableAliases, onSelectAllDeployAliases: selectAllDeployAliases,
    onDeselectAllDeployAliases: deselectAllDeployAliases, liveJobId,
    onLiveJobIdChange: (value) => {
      setLiveError(null);
      setLiveJobId(value);
    },
    onRequestConnect: requestConnect, onStartDeployment: startDeployment, onRequestCancel: requestCancel, canDeploy, deploying, liveConnected, liveCanceling,
    connectRequestKey, cancelRequestKey, onJobIdSync: setLiveJobId, onConnectedChange: setLiveConnected, onCancelingChange: setLiveCanceling, onLiveErrorChange: setLiveError,
    onStatusChange: handleDeploymentStatus, accountTab, onAccountTabChange: setAccountTab,
  });
  const enabledPanels = useMemo(
    () => panels.filter((panel) => !panel.disabled),
    [panels]
  );
  useDeploymentWorkspaceEffects({
    baseUrl, initialRolesLoaded: initialRoles.length > 0, setRoles, setRolesLoading, setRolesError, setAccountTab, setActivePanel, setDeviceMode, pendingAliasFromQueryRef, uiQueryReadyRef, activeAlias, servers,
    setActiveAlias, setSelectedByAlias, workspaceId, setDeployedAliases, setConnectionResults, setDeploySelection, setDeployRoleFilter, setSelectedPlansByAlias,
    setAliasRenames, setAliasDeletes, setAliasCleanups, setLiveJobId, setLiveConnected, setLiveCanceling, setLiveError, setOpenCredentialsAlias, setExpertConfirmOpen,
    setDetailSearchOpen, setDetailSearchTargetAlias, setPrimaryDomainDraft, setPrimaryDomainModalError, setPrimaryDomainModalSaving, setDomainFilterQuery, setDomainFilterKind,
    setDomainPopupOpen, setDomainPopupError, setDomainPopupType, setDomainPopupFqdnValue, setDomainPopupFqdnCheckBusy, setDomainPopupFqdnCheckResult, setDomainPopupLocalValue,
    setDomainPopupSubLabel, setDomainPopupParentFqdn, setDomainPopupPrompt, setDomainPopupTargetAlias, setConnectRequestKey, setCancelRequestKey, deviceMode, activePanel,
    deployRolePickerOpen, setDeployRolePickerOpen, detailSearchOpen, expertConfirmOpen, domainPopupOpen, closeDomainPopup, enabledPanels,
  });
  const closeDetailSearch = useCallback(() => {
    setDetailSearchOpen(false);
    setDetailSearchTargetAlias(null);
  }, []);
  const handleDomainPopupTypeSelect = useCallback((kind: DomainKind) => {
    setDomainPopupType(kind);
    setDomainPopupError(null);
    setDomainPopupFqdnCheckResult(null);
  }, []);
  const handleDomainPopupFqdnValueChange = useCallback(
    (value: string) => {
      setDomainPopupFqdnValue(value);
      if (domainPopupError) setDomainPopupError(null);
      if (domainPopupFqdnCheckResult) {
        setDomainPopupFqdnCheckResult(null);
      }
    },
    [domainPopupError, domainPopupFqdnCheckResult]
  );
  return (
    <DeploymentWorkspaceTemplate
      panels={panels}
      activePanel={activePanel}
      onSelectPanel={setActivePanel}
      deployRolePicker={{
        open: deployRolePickerOpen,
        query: deployRoleQuery,
        summary: deployRoleSummary,
        options: deployRoleOptions,
        selected: deployRoleFilter,
        inventoryRoleIds,
        onClose: () => setDeployRolePickerOpen(false),
        onQueryChange: setDeployRoleQuery,
        onSelectAll: selectAllDeployRoles,
        onClearAll: deselectAllDeployRoles,
        onToggleRole: toggleDeployRole,
      }}
      detailSearch={{
        open: detailSearchOpen,
        targetAlias: detailSearchTargetAlias,
        baseUrl,
        workspaceId,
        workspacePrimaryDomain,
        onClose: closeDetailSearch,
        onOrderedServer: handleProviderOrderedServer,
      }}
      expertModeConfirm={{
        open: expertConfirmOpen,
        onCancel: cancelExpertMode,
        onConfirm: confirmExpertMode,
      }}
      modeSwitch={{
        mode: deviceMode,
        onModeChange: handleModeChange,
      }}
      domainPopup={{
        open: domainPopupOpen,
        saving: primaryDomainModalSaving,
        prompt: domainPopupPrompt,
        type: domainPopupType,
        error: domainPopupError,
        fqdnValue: domainPopupFqdnValue,
        fqdnCheckBusy: domainPopupFqdnCheckBusy,
        fqdnCheckResult: domainPopupFqdnCheckResult,
        localValue: domainPopupLocalValue,
        subLabel: domainPopupSubLabel,
        parentFqdn: domainPopupParentFqdn,
        fqdnOptions: fqdnDomainOptions,
        onClose: closeDomainPopup,
        onSelectType: handleDomainPopupTypeSelect,
        onFqdnValueChange: handleDomainPopupFqdnValueChange,
        onCheckFqdn: () => {
          void checkDomainPopupFqdn();
        },
        onLocalValueChange: setDomainPopupLocalValue,
        onSubLabelChange: setDomainPopupSubLabel,
        onParentFqdnChange: setDomainPopupParentFqdn,
        onAddDomain: addDomainFromPopup,
      }}
    />
  );
}
