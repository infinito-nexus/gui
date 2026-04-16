"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import YAML from "yaml";
import DeploymentWorkspaceServerSwitcher from "../DeploymentWorkspaceServerSwitcher";
import { sanitizeAliasFilename } from "../workspace-panel/utils";
import {
  createServerPlaceholder,
  normalizePersistedDeviceMeta,
  parseHostVarsServerPatchData,
} from "../../lib/device_meta";
import {
  normalizeDeviceColor,
  normalizeDeviceEmoji,
  pickUniqueDeviceColor,
  pickUniqueDeviceEmoji,
} from "../deployment-credentials/device-visuals";
import type {
  ConnectionResult,
  ServerState,
} from "../deployment-credentials/types";
import DeploymentWorkspaceTemplate from "./DeploymentWorkspaceTemplate";
import {
  PANEL_KEY_TO_QUERY,
  PANEL_QUERY_TO_KEY,
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
  normalizeDomainName,
} from "./domain-utils";
import {
  encodeWorkspacePath,
  parseApiError,
} from "./helpers";
import { type AccountTabKey } from "./panels/AccountPanel";
import { useWorkspaceDomainLogic } from "./useWorkspaceDomainLogic";
import { useWorkspaceServerSelectionActions } from "./useWorkspaceServerSelectionActions";
import { useWorkspaceDeploymentRuntime } from "./useWorkspaceDeploymentRuntime";
import { useWorkspaceRoleAppConfig } from "./useWorkspaceRoleAppConfig";
import { useWorkspaceSelectionDerived } from "./useWorkspaceSelectionDerived";
import { buildDeploymentWorkspacePanels } from "./deploymentWorkspacePanels";
import { useWorkspaceServerMetadata } from "./useWorkspaceServerMetadata";
import { useDeploymentWorkspaceEffects } from "./useDeploymentWorkspaceEffects";
const DEFAULT_DEVICE_ALIAS = "device";
export default function DeploymentWorkspace({
  baseUrl,
  onJobCreated,
}: DeploymentWorkspaceProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerState[]>([]);
  const [activeAlias, setActiveAlias] = useState("");
  const [selectedByAlias, setSelectedByAlias] = useState<
    Record<string, Set<string>>
  >(() => ({}));
  const [selectedPlansByAlias, setSelectedPlansByAlias] = useState<
    Record<string, Record<string, string | null>>
  >(() => ({}));
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
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspacePrimaryDomain, setWorkspacePrimaryDomain] = useState(
    DEFAULT_PRIMARY_DOMAIN
  );
  const [inventoryReady, setInventoryReady] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [infinitoNexusVersion, setInfinitoNexusVersion] = useState("latest");
  const [infinitoNexusVersionOptions, setInfinitoNexusVersionOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: "latest", label: "latest" }]);
  const [infinitoNexusVersionLoading, setInfinitoNexusVersionLoading] =
    useState(false);
  const [infinitoNexusVersionSaving, setInfinitoNexusVersionSaving] =
    useState(false);
  const [infinitoNexusVersionError, setInfinitoNexusVersionError] = useState<
    string | null
  >(null);
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
  const [primaryDomainDraft, setPrimaryDomainDraft] = useState(
    DEFAULT_PRIMARY_DOMAIN
  );
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
  const [activePanel, setActivePanel] = useState<PanelKey>("intro");
  const [accountTab, setAccountTab] = useState<AccountTabKey>("profile");
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
    domainUsageByName,
    filteredDomainEntries,
    persistWorkspaceDomainSettings,
    openDomainPopup,
    closeDomainPopup,
    checkDomainPopupFqdn,
    addDomainFromPopup,
    removeDomainEntry,
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
  useEffect(() => {
    let cancelled = false;
    const loadVersions = async () => {
      setInfinitoNexusVersionLoading(true);
      setInfinitoNexusVersionError(null);
      try {
        const res = await fetch(`${baseUrl}/api/infinito-nexus/versions`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
        const data = await res.json();
        const nextOptions: Array<{ value: string; label: string }> = Array.isArray(
          data?.versions
        )
          ? data.versions
              .map((entry: any) => ({
                value: String(entry?.value || "").trim(),
                label: String(entry?.label || entry?.value || "").trim(),
              }))
              .filter(
                (entry: { value: string; label: string }) =>
                  entry.value.length > 0 && entry.label.length > 0
              )
          : [];
        const normalized =
          nextOptions.length > 0
            ? nextOptions
            : [{ value: "latest", label: "latest" }];
        if (cancelled) return;
        setInfinitoNexusVersionOptions(normalized);
        setInfinitoNexusVersion((prev) =>
          normalized.some((entry: { value: string }) => entry.value === prev)
            ? prev
            : String(data?.default_version || "latest").trim() || "latest"
        );
      } catch (err: any) {
        if (cancelled) return;
        setInfinitoNexusVersionOptions([{ value: "latest", label: "latest" }]);
        setInfinitoNexusVersion((prev) => prev || "latest");
        setInfinitoNexusVersionError(
          err?.message ?? "Failed to load Infinito.Nexus versions."
        );
      } finally {
        if (!cancelled) {
          setInfinitoNexusVersionLoading(false);
        }
      }
    };
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);
  useEffect(() => {
    if (!workspaceId) {
      setInfinitoNexusVersion("latest");
      setInfinitoNexusVersionError(null);
      return;
    }
    let cancelled = false;
    const loadWorkspaceVersion = async () => {
      setInfinitoNexusVersionSaving(true);
      setInfinitoNexusVersionError(null);
      try {
        const res = await fetch(
          `${baseUrl}/api/workspaces/${workspaceId}/runtime-settings`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
        const data = await res.json();
        const nextValue =
          String(data?.infinito_nexus_version || "").trim() || "latest";
        if (!cancelled) {
          setInfinitoNexusVersion(nextValue);
        }
      } catch (err: any) {
        if (!cancelled) {
          setInfinitoNexusVersion("latest");
          setInfinitoNexusVersionError(
            err?.message ?? "Failed to load Infinito.Nexus version."
          );
        }
      } finally {
        if (!cancelled) {
          setInfinitoNexusVersionSaving(false);
        }
      }
    };
    void loadWorkspaceVersion();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, workspaceId]);
  const handleInfinitoNexusVersionChange = useCallback(
    async (value: string) => {
      const normalized = String(value || "").trim() || "latest";
      const previous = infinitoNexusVersion;
      setInfinitoNexusVersion(normalized);
      setInfinitoNexusVersionError(null);
      if (!workspaceId) return;
      setInfinitoNexusVersionSaving(true);
      try {
        const res = await fetch(
          `${baseUrl}/api/workspaces/${workspaceId}/runtime-settings`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ infinito_nexus_version: normalized }),
          }
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
        const data = await res.json();
        setInfinitoNexusVersion(
          String(data?.infinito_nexus_version || "").trim() || normalized
        );
      } catch (err: any) {
        setInfinitoNexusVersion(previous);
        setInfinitoNexusVersionError(
          err?.message ?? "Failed to save Infinito.Nexus version."
        );
      } finally {
        setInfinitoNexusVersionSaving(false);
      }
    },
    [baseUrl, infinitoNexusVersion, workspaceId]
  );
  const infinitoNexusVersionBusy =
    infinitoNexusVersionLoading || infinitoNexusVersionSaving;
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
    baseUrl, roles, rolesLoading, rolesError, selectedRoles,
    onToggleSelected: toggleSelected, onLoadRoleAppConfig: loadRoleAppConfig, onSaveRoleAppConfig: saveRoleAppConfig, onImportRoleAppDefaults: importRoleAppDefaults,
    activeAlias, servers, serverMetaByAlias, selectedRolesByAlias, onToggleSelectedForAlias: toggleSelectedForAlias, selectedPlansByAlias, onSelectRolePlanForAlias: selectRolePlanForAlias,
    serverSwitcher, onCreateServerForTarget: addServerWithDefaults, deviceMode, onModeChange: handleModeChange, domainFilterQuery, onDomainFilterQueryChange: setDomainFilterQuery,
    domainFilterKind, onDomainFilterKindChange: setDomainFilterKind, onOpenAddDomain: (kind = "fqdn") => openDomainPopup(kind), primaryDomainError: primaryDomainModalError,
    filteredDomainEntries, allDomainEntries: domainEntries, domainUsageByName, primaryDomainDraft,
    onSelectPrimaryDomain: (domain) => {
      setPrimaryDomainDraft(domain);
      setPrimaryDomainModalError(null);
      void persistWorkspaceDomainSettings({ entries: domainEntries, primaryDomain: domain });
    },
    onOpenAddSubdomain: (parentFqdn) => openDomainPopup("subdomain", { kind: "subdomain", parentFqdn }), onRemoveDomain: removeDomainEntry,
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
    baseUrl, setRoles, setRolesLoading, setRolesError, setAccountTab, setActivePanel, setDeviceMode, pendingAliasFromQueryRef, uiQueryReadyRef, activeAlias, servers,
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
