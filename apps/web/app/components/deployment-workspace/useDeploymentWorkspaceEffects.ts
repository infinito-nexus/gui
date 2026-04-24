"use client";

import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { DEFAULT_PRIMARY_DOMAIN } from "./domain-utils";
import { PANEL_KEY_TO_QUERY, PANEL_QUERY_TO_KEY, type PanelKey, type Role, type WorkspaceTabPanel } from "./types";
import type { ConnectionResult, ServerState } from "../deployment-credentials/types";

type UseDeploymentWorkspaceEffectsProps = {
  baseUrl: string;
  initialRolesLoaded: boolean;
  setRoles: Dispatch<SetStateAction<Role[]>>;
  setRolesLoading: Dispatch<SetStateAction<boolean>>;
  setRolesError: Dispatch<SetStateAction<string | null>>;
  setAccountTab: Dispatch<SetStateAction<"profile" | "billing">>;
  setActivePanel: Dispatch<SetStateAction<PanelKey>>;
  setDeviceMode: Dispatch<SetStateAction<"customer" | "expert">>;
  pendingAliasFromQueryRef: MutableRefObject<string>;
  uiQueryReadyRef: MutableRefObject<boolean>;
  activeAlias: string;
  servers: ServerState[];
  setActiveAlias: Dispatch<SetStateAction<string>>;
  setSelectedByAlias: Dispatch<SetStateAction<Record<string, Set<string>>>>;
  workspaceId: string | null;
  setDeployedAliases: Dispatch<SetStateAction<Set<string>>>;
  setConnectionResults: Dispatch<SetStateAction<Record<string, ConnectionResult>>>;
  setDeploySelection: Dispatch<SetStateAction<Set<string>>>;
  setDeployRoleFilter: Dispatch<SetStateAction<Set<string>>>;
  setSelectedPlansByAlias: Dispatch<
    SetStateAction<Record<string, Record<string, string | null>>>
  >;
  setAliasRenames: Dispatch<SetStateAction<Array<{ from: string; to: string }>>>;
  setAliasDeletes: Dispatch<SetStateAction<string[]>>;
  setAliasCleanups: Dispatch<SetStateAction<string[]>>;
  setLiveJobId: Dispatch<SetStateAction<string>>;
  setLiveConnected: Dispatch<SetStateAction<boolean>>;
  setLiveCanceling: Dispatch<SetStateAction<boolean>>;
  setLiveError: Dispatch<SetStateAction<string | null>>;
  setOpenCredentialsAlias: Dispatch<SetStateAction<string | null>>;
  setExpertConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setDetailSearchOpen: Dispatch<SetStateAction<boolean>>;
  setDetailSearchTargetAlias: Dispatch<SetStateAction<string | null>>;
  setPrimaryDomainDraft: Dispatch<SetStateAction<string>>;
  setPrimaryDomainModalError: Dispatch<SetStateAction<string | null>>;
  setPrimaryDomainModalSaving: Dispatch<SetStateAction<boolean>>;
  setDomainFilterQuery: Dispatch<SetStateAction<string>>;
  setDomainFilterKind: Dispatch<SetStateAction<"all" | "fqdn" | "local" | "subdomain">>;
  setDomainPopupOpen: Dispatch<SetStateAction<boolean>>;
  setDomainPopupError: Dispatch<SetStateAction<string | null>>;
  setDomainPopupType: Dispatch<SetStateAction<"fqdn" | "local" | "subdomain">>;
  setDomainPopupFqdnValue: Dispatch<SetStateAction<string>>;
  setDomainPopupFqdnCheckBusy: Dispatch<SetStateAction<boolean>>;
  setDomainPopupFqdnCheckResult: Dispatch<
    SetStateAction<{ available: boolean; note: string } | null>
  >;
  setDomainPopupLocalValue: Dispatch<SetStateAction<string>>;
  setDomainPopupSubLabel: Dispatch<SetStateAction<string>>;
  setDomainPopupParentFqdn: Dispatch<SetStateAction<string>>;
  setDomainPopupPrompt: Dispatch<SetStateAction<string | null>>;
  setDomainPopupTargetAlias: Dispatch<SetStateAction<string | null>>;
  setConnectRequestKey: Dispatch<SetStateAction<number>>;
  setCancelRequestKey: Dispatch<SetStateAction<number>>;
  deviceMode: "customer" | "expert";
  activePanel: PanelKey;
  deployRolePickerOpen: boolean;
  setDeployRolePickerOpen: Dispatch<SetStateAction<boolean>>;
  detailSearchOpen: boolean;
  expertConfirmOpen: boolean;
  domainPopupOpen: boolean;
  closeDomainPopup: () => void;
  enabledPanels: WorkspaceTabPanel[];
};

export function useDeploymentWorkspaceEffects({
  baseUrl,
  initialRolesLoaded,
  setRoles,
  setRolesLoading,
  setRolesError,
  setAccountTab,
  setActivePanel,
  setDeviceMode,
  pendingAliasFromQueryRef,
  uiQueryReadyRef,
  activeAlias,
  servers,
  setActiveAlias,
  setSelectedByAlias,
  workspaceId,
  setDeployedAliases,
  setConnectionResults,
  setDeploySelection,
  setDeployRoleFilter,
  setSelectedPlansByAlias,
  setAliasRenames,
  setAliasDeletes,
  setAliasCleanups,
  setLiveJobId,
  setLiveConnected,
  setLiveCanceling,
  setLiveError,
  setOpenCredentialsAlias,
  setExpertConfirmOpen,
  setDetailSearchOpen,
  setDetailSearchTargetAlias,
  setPrimaryDomainDraft,
  setPrimaryDomainModalError,
  setPrimaryDomainModalSaving,
  setDomainFilterQuery,
  setDomainFilterKind,
  setDomainPopupOpen,
  setDomainPopupError,
  setDomainPopupType,
  setDomainPopupFqdnValue,
  setDomainPopupFqdnCheckBusy,
  setDomainPopupFqdnCheckResult,
  setDomainPopupLocalValue,
  setDomainPopupSubLabel,
  setDomainPopupParentFqdn,
  setDomainPopupPrompt,
  setDomainPopupTargetAlias,
  setConnectRequestKey,
  setCancelRequestKey,
  deviceMode,
  activePanel,
  deployRolePickerOpen,
  setDeployRolePickerOpen,
  detailSearchOpen,
  expertConfirmOpen,
  domainPopupOpen,
  closeDomainPopup,
  enabledPanels,
}: UseDeploymentWorkspaceEffectsProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const panelParam = String(params.get("ui_panel") || "").trim().toLowerCase();
    const modeParam = String(params.get("ui_mode") || "").trim().toLowerCase();
    const aliasParam = String(params.get("ui_device") || "").trim();
    if (panelParam === "billing") {
      setAccountTab("billing");
    }
    if (panelParam && PANEL_QUERY_TO_KEY[panelParam]) {
      setActivePanel(PANEL_QUERY_TO_KEY[panelParam]);
    }
    if (modeParam === "customer" || modeParam === "expert") {
      setDeviceMode(modeParam);
    }
    if (aliasParam) {
      pendingAliasFromQueryRef.current = aliasParam;
    }
    uiQueryReadyRef.current = true;
  }, [pendingAliasFromQueryRef, setAccountTab, setActivePanel, setDeviceMode, uiQueryReadyRef]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (!initialRolesLoaded) {
        setRolesLoading(true);
      }
      setRolesError(null);
      try {
        const res = await fetch(`${baseUrl}/api/roles`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (alive) {
          setRoles(Array.isArray(data) ? data : []);
        }
      } catch (err: any) {
        if (alive) {
          if (!initialRolesLoaded) {
            setRolesError(err?.message ?? "failed to load roles");
          }
        }
      } finally {
        if (alive && !initialRolesLoaded) setRolesLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [baseUrl, initialRolesLoaded, setRoles, setRolesError, setRolesLoading]);

  useEffect(() => {
    if (!activeAlias && servers.length > 0) {
      setActiveAlias(servers[0].alias);
      return;
    }
    if (activeAlias && !servers.some((server) => server.alias === activeAlias)) {
      if (pendingAliasFromQueryRef.current) {
        return;
      }
      setActiveAlias(servers[0]?.alias ?? "");
    }
  }, [activeAlias, servers, pendingAliasFromQueryRef, setActiveAlias]);

  useEffect(() => {
    const wantedAlias = pendingAliasFromQueryRef.current.trim();
    if (!wantedAlias) return;
    if (!servers.some((server) => server.alias === wantedAlias)) return;
    pendingAliasFromQueryRef.current = "";
    if (activeAlias !== wantedAlias) {
      setActiveAlias(wantedAlias);
    }
  }, [servers, activeAlias, pendingAliasFromQueryRef, setActiveAlias]);

  useEffect(() => {
    if (!activeAlias) return;
    setSelectedByAlias((prev) => {
      if (prev[activeAlias]) return prev;
      return { ...prev, [activeAlias]: new Set<string>() };
    });
  }, [activeAlias, setSelectedByAlias]);

  useEffect(() => {
    setDeployedAliases(new Set());
    setConnectionResults({});
    setDeploySelection(new Set());
    setDeployRoleFilter(new Set());
    setSelectedPlansByAlias({});
    setAliasRenames([]);
    setAliasDeletes([]);
    setAliasCleanups([]);
    setLiveJobId("");
    setLiveConnected(false);
    setLiveCanceling(false);
    setLiveError(null);
    setOpenCredentialsAlias(null);
    setExpertConfirmOpen(false);
    setDetailSearchOpen(false);
    setDetailSearchTargetAlias(null);
    setPrimaryDomainDraft(DEFAULT_PRIMARY_DOMAIN);
    setPrimaryDomainModalError(null);
    setPrimaryDomainModalSaving(false);
    setDomainFilterQuery("");
    setDomainFilterKind("all");
    setDomainPopupOpen(false);
    setDomainPopupError(null);
    setDomainPopupType("fqdn");
    setDomainPopupFqdnValue("");
    setDomainPopupFqdnCheckBusy(false);
    setDomainPopupFqdnCheckResult(null);
    setDomainPopupLocalValue(DEFAULT_PRIMARY_DOMAIN);
    setDomainPopupSubLabel("");
    setDomainPopupParentFqdn("");
    setDomainPopupPrompt(null);
    setDomainPopupTargetAlias(null);
    setConnectRequestKey(0);
    setCancelRequestKey(0);
  }, [
    workspaceId,
    setAliasCleanups,
    setAliasDeletes,
    setAliasRenames,
    setCancelRequestKey,
    setConnectRequestKey,
    setConnectionResults,
    setDeployRoleFilter,
    setDeploySelection,
    setDeployRolePickerOpen,
    setDeployedAliases,
    setDetailSearchOpen,
    setDetailSearchTargetAlias,
    setDomainFilterKind,
    setDomainFilterQuery,
    setDomainPopupError,
    setDomainPopupFqdnCheckBusy,
    setDomainPopupFqdnCheckResult,
    setDomainPopupFqdnValue,
    setDomainPopupLocalValue,
    setDomainPopupOpen,
    setDomainPopupParentFqdn,
    setDomainPopupPrompt,
    setDomainPopupSubLabel,
    setDomainPopupTargetAlias,
    setDomainPopupType,
    setExpertConfirmOpen,
    setLiveCanceling,
    setLiveConnected,
    setLiveError,
    setLiveJobId,
    setOpenCredentialsAlias,
    setPrimaryDomainDraft,
    setPrimaryDomainModalError,
    setPrimaryDomainModalSaving,
    setSelectedPlansByAlias,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!workspaceId) return;
    const params = new URLSearchParams(window.location.search);
    const modeFromQuery = String(params.get("ui_mode") || "").trim().toLowerCase();
    if (modeFromQuery === "customer" || modeFromQuery === "expert") {
      setDeviceMode(modeFromQuery);
      return;
    }
    const stored = window.localStorage.getItem(`infinito.devices.mode.${workspaceId}`);
    if (stored === "customer" || stored === "expert") {
      setDeviceMode(stored);
      return;
    }
    setDeviceMode("customer");
  }, [workspaceId, setDeviceMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!workspaceId) return;
    window.localStorage.setItem(`infinito.devices.mode.${workspaceId}`, deviceMode);
  }, [workspaceId, deviceMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!uiQueryReadyRef.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set("ui_panel", PANEL_KEY_TO_QUERY[activePanel]);
    url.searchParams.set("ui_mode", deviceMode);
    if (activeAlias) {
      url.searchParams.set("ui_device", activeAlias);
    } else {
      url.searchParams.delete("ui_device");
    }
    window.history.replaceState({}, "", url.toString());
  }, [activePanel, deviceMode, activeAlias, uiQueryReadyRef]);

  useEffect(() => {
    if (!deployRolePickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeployRolePickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deployRolePickerOpen, setDeployRolePickerOpen]);

  useEffect(() => {
    if (!detailSearchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailSearchOpen(false);
        setDetailSearchTargetAlias(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailSearchOpen, setDetailSearchOpen, setDetailSearchTargetAlias]);

  useEffect(() => {
    if (!expertConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpertConfirmOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expertConfirmOpen, setExpertConfirmOpen]);

  useEffect(() => {
    if (!domainPopupOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDomainPopup();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [domainPopupOpen, closeDomainPopup]);

  useEffect(() => {
    if (enabledPanels.length === 0) return;
    if (!enabledPanels.some((panel) => panel.key === activePanel)) {
      setActivePanel(enabledPanels[0].key);
    }
  }, [activePanel, enabledPanels, setActivePanel]);
}
