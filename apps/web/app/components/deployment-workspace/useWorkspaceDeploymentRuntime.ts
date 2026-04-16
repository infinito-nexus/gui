"use client";

import { useCallback, useMemo } from "react";
import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from "react";
import styles from "../DeploymentWorkspace.module.css";
import { buildDeploymentPayload } from "../../lib/deployment_payload";
import {
  clearWorkspaceMasterPassword,
  getWorkspaceMasterPassword,
  promptWorkspaceMasterPassword,
} from "../../lib/workspaceVaultSession";
import type {
  ConnectionResult,
  ServerState,
} from "../deployment-credentials/types";
import { parseApiError } from "./helpers";
import type { PanelKey } from "./types";

type UseWorkspaceDeploymentRuntimeProps = {
  baseUrl: string;
  onJobCreated?: (jobId: string) => void;
  activeServer: ServerState | null;
  selectedRolesByAlias: Record<string, string[]>;
  deploySelection: Set<string>;
  selectableAliases: string[];
  deployRoleFilter: Set<string>;
  workspaceId: string | null;
  inventoryReady: boolean;
  infinitoNexusVersion: string;
  deploying: boolean;
  setDeploying: Dispatch<SetStateAction<boolean>>;
  setDeployError: Dispatch<SetStateAction<string | null>>;
  setLiveJobId: Dispatch<SetStateAction<string>>;
  setLiveError: Dispatch<SetStateAction<string | null>>;
  setDeployViewTab: Dispatch<SetStateAction<"live-log" | "terminal">>;
  setConnectRequestKey: Dispatch<SetStateAction<number>>;
  setCancelRequestKey: Dispatch<SetStateAction<number>>;
  liveJobId: string;
  setDeployedAliases: Dispatch<SetStateAction<Set<string>>>;
  lastDeploymentSelectionRef: MutableRefObject<string[] | null>;
  connectionResults: Record<string, ConnectionResult>;
  handleConnectionResult: (alias: string, result: ConnectionResult) => void;
  setActiveAlias: Dispatch<SetStateAction<string>>;
  setOpenCredentialsAlias: Dispatch<SetStateAction<string | null>>;
  setActivePanel: Dispatch<SetStateAction<PanelKey>>;
};

export function useWorkspaceDeploymentRuntime({
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
}: UseWorkspaceDeploymentRuntimeProps) {
  const deploymentPlan = useMemo(
    () =>
      buildDeploymentPayload({
        activeServer,
        selectedRolesByAlias,
        selectedAliases: Array.from(deploySelection),
        selectableAliases,
        roleFilter: Array.from(deployRoleFilter),
        workspaceId,
        inventoryReady,
        infinitoNexusVersion,
      }),
    [
      activeServer,
      selectedRolesByAlias,
      deploySelection,
      selectableAliases,
      deployRoleFilter,
      workspaceId,
      inventoryReady,
      infinitoNexusVersion,
    ]
  );

  const deploymentErrors = deploymentPlan.errors;
  const canDeploy = Object.keys(deploymentErrors).length === 0 && !deploying;

  const startDeployment = useCallback(async () => {
    setDeployError(null);

    if (!deploymentPlan.payload) {
      setDeployError("Resolve the highlighted items before deploying.");
      return;
    }

    lastDeploymentSelectionRef.current = Array.from(deploySelection);
    setDeploying(true);
    try {
      const postDeployment = async (payload: Record<string, unknown>) =>
        fetch(`${baseUrl}/api/deployments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

      let payload: Record<string, unknown> = { ...deploymentPlan.payload };
      const cachedMasterPassword = getWorkspaceMasterPassword(workspaceId);
      if (cachedMasterPassword) {
        payload = {
          ...payload,
          master_password: cachedMasterPassword,
        };
      }

      let res = await postDeployment(payload);
      if (!res.ok) {
        let message = await parseApiError(res);
        const needsVaultPassword =
          /master_password is required for workspaces with vault-encrypted values/i.test(
            message
          ) || /invalid master password/i.test(message);

        if (workspaceId && needsVaultPassword) {
          clearWorkspaceMasterPassword(workspaceId);
          const masterPassword = promptWorkspaceMasterPassword(workspaceId);
          payload = {
            ...deploymentPlan.payload,
            master_password: masterPassword,
          };
          res = await postDeployment(payload);
          if (!res.ok) {
            message = await parseApiError(res);
          }
        }

        if (!res.ok) {
          throw new Error(message);
        }
      }
      const data = await res.json();
      const created = String(data?.job_id ?? "");
      if (created) {
        setLiveJobId(created);
        setLiveError(null);
        setDeployViewTab("terminal");
        setConnectRequestKey((prev) => prev + 1);
        onJobCreated?.(created);
      }
    } catch (err: any) {
      setDeployError(err?.message ?? "Deployment failed");
    } finally {
      setDeploying(false);
    }
  }, [
    baseUrl,
    deploySelection,
    deploymentPlan.payload,
    lastDeploymentSelectionRef,
    onJobCreated,
    workspaceId,
    setConnectRequestKey,
    setDeployError,
    setDeployViewTab,
    setDeploying,
    setLiveError,
    setLiveJobId,
  ]);

  const credentials = useMemo(() => {
    return {
      alias: activeServer?.alias ?? "",
      description: activeServer?.description ?? "",
      primaryDomain: activeServer?.primaryDomain ?? "",
      requirementServerType: activeServer?.requirementServerType ?? "vps",
      requirementStorageGb: activeServer?.requirementStorageGb ?? "200",
      requirementLocation: activeServer?.requirementLocation ?? "Germany",
      host: activeServer?.host ?? "",
      port: activeServer?.port ?? "",
      user: activeServer?.user ?? "",
      color: activeServer?.color ?? "",
      logoEmoji: activeServer?.logoEmoji ?? "",
      authMethod: activeServer?.authMethod ?? "password",
    };
  }, [activeServer]);

  const handleDeploymentStatus = useCallback(
    (status: { job_id?: string; status?: string } | null) => {
      if (!status?.status) return;
      if (status.job_id && liveJobId && status.job_id !== liveJobId) return;
      const terminal = ["succeeded", "failed", "canceled"].includes(status.status);
      if (status.status === "succeeded" && lastDeploymentSelectionRef.current) {
        setDeployedAliases((prev) => {
          const next = new Set(prev);
          lastDeploymentSelectionRef.current?.forEach((alias) => next.add(alias));
          return next;
        });
      }
      if (terminal) {
        lastDeploymentSelectionRef.current = null;
      }
    },
    [liveJobId, setDeployedAliases, lastDeploymentSelectionRef]
  );

  const deployTableColumns =
    "minmax(0, 1.3fr) minmax(0, 0.7fr) minmax(0, 1.25fr) minmax(62px, 0.45fr) minmax(0, 0.85fr) minmax(66px, 0.55fr) minmax(94px, 0.85fr) 52px";
  const deployTableStyle = {
    "--deploy-table-columns": deployTableColumns,
  } as CSSProperties;

  const isAuthMissing = useCallback(
    (server: ServerState) =>
      server.authMethod === "private_key"
        ? !String(server.privateKey || "").trim()
        : !String(server.password || "").trim(),
    []
  );

  const hasCredentials = useCallback(
    (server: ServerState) => {
      const host = String(server.host || "").trim();
      const user = String(server.user || "").trim();
      const authReady = !isAuthMissing(server);
      return Boolean(host && user && authReady);
    },
    [isAuthMissing]
  );

  const canTestConnection = useCallback(
    (server: ServerState) => {
      const host = String(server.host || "").trim();
      const user = String(server.user || "").trim();
      const portRaw = String(server.port || "").trim();
      const portValue = Number(portRaw);
      const portValid =
        Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535;
      return Boolean(host && user && portValid && !isAuthMissing(server));
    },
    [isAuthMissing]
  );

  const testConnectionForServer = useCallback(
    async (server: ServerState) => {
      if (!workspaceId || !canTestConnection(server)) return;
      try {
        const portRaw = String(server.port ?? "").trim();
        const portValue = portRaw ? Number(portRaw) : null;
        const res = await fetch(
          `${baseUrl}/api/workspaces/${workspaceId}/test-connection`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              host: server.host,
              port: Number.isInteger(portValue) ? portValue : undefined,
              user: server.user,
              auth_method: server.authMethod,
              password: server.password || undefined,
              private_key: server.privateKey || undefined,
              key_passphrase: server.keyPassphrase || undefined,
            }),
          }
        );
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (typeof data?.detail === "string" && data.detail.trim()) {
              message = data.detail.trim();
            }
          } catch {
            const text = await res.text();
            if (text.trim()) message = text.trim();
          }
          throw new Error(message);
        }
        const data = (await res.json()) as ConnectionResult;
        handleConnectionResult(server.alias, data);
      } catch (err: any) {
        handleConnectionResult(server.alias, {
          ping_ok: false,
          ping_error: err?.message ?? "ping failed",
          ssh_ok: false,
          ssh_error: err?.message ?? "ssh failed",
        });
      }
    },
    [baseUrl, canTestConnection, handleConnectionResult, workspaceId]
  );

  const getConnectionState = useCallback(
    (server: ServerState) => {
      const credentialsReady = hasCredentials(server);
      const status = connectionResults[server.alias];
      const fullyConnected = status?.ping_ok === true && status?.ssh_ok === true;

      if (credentialsReady && fullyConnected) {
        return {
          rowClass: styles.serverRowHealthy,
          label: "Connected",
          toneClass: styles.statusDotGreen,
          tooltip: "Ping and SSH checks succeeded.",
        };
      }
      if (!credentialsReady) {
        return {
          rowClass: styles.serverRowMissingCredentials,
          label: "Missing credentials",
          toneClass: styles.statusDotOrange,
          tooltip: "No credentials configured. Set password or SSH key before testing.",
        };
      }
      if (!status) {
        return {
          rowClass: styles.serverRowWarning,
          label: "Not tested",
          toneClass: styles.statusDotYellow,
          tooltip: "No connection test result yet.",
        };
      }
      if (status.ping_ok && status.ssh_ok) {
        return {
          rowClass: styles.serverRowHealthy,
          label: "Connected",
          toneClass: styles.statusDotGreen,
          tooltip: "Ping and SSH checks succeeded.",
        };
      }
      const detail: string[] = [];
      if (!status.ping_ok) {
        detail.push(status.ping_error?.trim() || "Ping check failed.");
      }
      if (!status.ssh_ok) {
        detail.push(status.ssh_error?.trim() || "SSH check failed.");
      }
      return {
        rowClass: styles.serverRowWarning,
        label: !status.ping_ok ? "Ping failed" : "Connection failed",
        toneClass: styles.statusDotOrange,
        tooltip: detail.join(" ") || "Connection test failed.",
      };
    },
    [connectionResults, hasCredentials]
  );

  const requestConnect = useCallback(() => {
    if (!liveJobId.trim()) return;
    setLiveError(null);
    setConnectRequestKey((prev) => prev + 1);
    setDeployViewTab("terminal");
  }, [liveJobId, setConnectRequestKey, setDeployViewTab, setLiveError]);

  const requestCancel = useCallback(() => {
    if (!liveJobId.trim()) return;
    setLiveError(null);
    setCancelRequestKey((prev) => prev + 1);
  }, [liveJobId, setCancelRequestKey, setLiveError]);

  const openCredentialsFor = useCallback(
    (alias: string) => {
      const target = String(alias || "").trim();
      if (!target) return;
      setActiveAlias(target);
      setOpenCredentialsAlias(target);
      setActivePanel("server");
    },
    [setActiveAlias, setActivePanel, setOpenCredentialsAlias]
  );

  return {
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
  };
}
