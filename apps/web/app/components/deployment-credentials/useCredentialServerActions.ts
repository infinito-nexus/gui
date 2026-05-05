import { useRef, useState } from "react";
import type {
  ConnectionResult,
  ServerState,
} from "./types";
import type {
  CredentialBlurPayload,
  PendingServerAction,
} from "./form/types";
import {
  getWorkspaceMasterPassword,
  promptWorkspaceMasterPassword,
} from "../../lib/workspaceVaultSession";
import { encodePath } from "../workspace-panel/utils";

type UseCredentialServerActionsArgs = {
  baseUrl: string;
  workspaceId: string | null;
  servers: ServerState[];
  onConnectionResult: (alias: string, result: ConnectionResult) => void;
  onUpdateServer: (alias: string, patch: Partial<ServerState>) => void;
  onRemoveServer: (alias: string) => void | Promise<void>;
  onCleanupServer: (alias: string) => void | Promise<void>;
};

export default function useCredentialServerActions({
  baseUrl,
  workspaceId,
  servers,
  onConnectionResult,
  onUpdateServer,
  onRemoveServer,
  onCleanupServer,
}: UseCredentialServerActionsArgs) {
  const [pendingAction, setPendingAction] = useState<PendingServerAction>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const serversRef = useRef(servers);
  const connectionPersistVersionRef = useRef<Record<string, number>>({});
  serversRef.current = servers;

  const parseErrorMessage = async (res: Response) => {
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail.trim()) {
        return data.detail.trim();
      }
      if (typeof data?.message === "string" && data.message.trim()) {
        return data.message.trim();
      }
    } catch {
      const text = await res.text();
      if (text.trim()) return text.trim();
    }
    return `HTTP ${res.status}`;
  };

  const promptMasterPassword = () => {
    const cached = getWorkspaceMasterPassword(workspaceId);
    if (cached) return cached;
    return promptWorkspaceMasterPassword(workspaceId);
  };

  const persistServerConnection = async (server: ServerState) => {
    if (!workspaceId) return;
    const host = String(server.host || "").trim();
    const user = String(server.user || "").trim();
    const portRaw = String(server.port || "").trim();
    const portValue = Number(portRaw);
    const portValid =
      Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535;

    if (!host || !user || !portValid) {
      return;
    }

    const res = await fetch(
      `${baseUrl}/api/workspaces/${workspaceId}/servers/${encodeURIComponent(
        server.alias
      )}/connection`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          user,
          port: portValue,
        }),
      }
    );
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
  };

  const saveKeyPassphraseToVault = async (alias: string, keyPassphrase: string) => {
    if (!workspaceId || !keyPassphrase.trim()) return;
    const masterPassword = promptMasterPassword();
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/vault/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        master_password: masterPassword,
        master_password_confirm: masterPassword,
        create_if_missing: true,
        alias,
        key_passphrase: keyPassphrase,
      }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
  };

  const canTestConnection = (server: ServerState) => {
    const host = String(server.host || "").trim();
    const user = String(server.user || "").trim();
    const portRaw = String(server.port || "").trim();
    const portValue = Number(portRaw);
    const portValid = Boolean(
      portRaw && Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535
    );
    if (!host || !user || !portValid) return false;
    if (server.authMethod === "private_key") {
      return Boolean(String(server.privateKey || "").trim());
    }
    return Boolean(String(server.password || "").trim());
  };

  const testConnection = async (server: ServerState) => {
    if (!workspaceId) return;
    try {
      const portRaw = String(server.port ?? "").trim();
      const portValue = portRaw ? Number(portRaw) : null;
      const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/test-connection`, {
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
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      onConnectionResult(server.alias, data);
      return data as ConnectionResult;
    } catch (err: any) {
      const failedResult: ConnectionResult = {
        ping_ok: false,
        ping_error: err?.message ?? "ping failed",
        ssh_ok: false,
        ssh_error: err?.message ?? "ssh failed",
      };
      onConnectionResult(server.alias, failedResult);
      return failedResult;
    }
  };

  const generateServerKey = async (alias: string) => {
    if (!workspaceId) {
      throw new Error("Workspace is not ready.");
    }
    const server = servers.find((entry) => entry.alias === alias);
    if (!server) {
      throw new Error("Device not found.");
    }
    const masterPassword = promptMasterPassword();
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/ssh-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alias: server.alias,
        algorithm: server.keyAlgorithm || "ed25519",
        with_passphrase: true,
        master_password: masterPassword,
        master_password_confirm: masterPassword,
        return_passphrase: true,
      }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    const data = await res.json();
    onUpdateServer(server.alias, {
      privateKey: data.private_key || "",
      publicKey: data.public_key || "",
      authMethod: "private_key",
      keyPassphrase: data.passphrase || "",
    });
  };

  const handleCredentialFieldBlur = async (payload: CredentialBlurPayload) => {
    const { server, field, passwordConfirm: confirmValue } = payload;
    const refServer = serversRef.current.find((entry) => entry.alias === server.alias);
    const baseServer = refServer ?? servers.find((entry) => entry.alias === server.alias) ?? server;
    const fieldToKey: Record<string, keyof ServerState | undefined> = {
      host: "host",
      port: "port",
      user: "user",
      password: "password",
      keyPassphrase: "keyPassphrase",
      privateKey: "privateKey",
      primaryDomain: "primaryDomain",
    };
    const overrideKey = fieldToKey[field];
    const resolvedServer: ServerState = overrideKey
      ? ({ ...baseServer, [overrideKey]: (server as any)[overrideKey] } as ServerState)
      : ({ ...baseServer } as ServerState);

    if (field === "host" || field === "port" || field === "user") {
      const alias = resolvedServer.alias;
      const nextVersion =
        (connectionPersistVersionRef.current[alias] || 0) + 1;
      connectionPersistVersionRef.current[alias] = nextVersion;
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 75);
      });
      if (connectionPersistVersionRef.current[alias] !== nextVersion) {
        return;
      }
      await persistServerConnection(resolvedServer);
    }

    if (
      resolvedServer.authMethod === "password" &&
      (field === "password" || field === "passwordConfirm")
    ) {
      const password = String(resolvedServer.password || "");
      const confirm = String(confirmValue || "");
      if (password && confirm && password !== confirm) {
        throw new Error("Password confirmation mismatch.");
      }
    }

    if (resolvedServer.authMethod === "private_key" && field === "keyPassphrase") {
      const keyPassphrase = String(resolvedServer.keyPassphrase || "");
      if (keyPassphrase.trim()) {
        await saveKeyPassphraseToVault(resolvedServer.alias, keyPassphrase);
      }
    }

    if (field === "primaryDomain" && workspaceId) {
      const res = await fetch(`${baseUrl}/api/providers/primary-domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          alias: resolvedServer.alias,
          primary_domain: String(resolvedServer.primaryDomain || "").trim() || null,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res));
      }
    }

    if (canTestConnection(resolvedServer)) {
      await testConnection(resolvedServer);
    }
  };

  const normalizeAliases = (aliases: string[]) =>
    Array.from(
      new Set(
        (Array.isArray(aliases) ? aliases : [])
          .map((alias) => String(alias || "").trim())
          .filter(Boolean)
      )
    );

  const requestDeleteServers = (aliases: string[]) => {
    const nextAliases = normalizeAliases(aliases);
    if (nextAliases.length === 0) return;
    setActionError(null);
    setPendingAction({ mode: "delete", aliases: nextAliases });
  };

  const requestPurgeServers = (aliases: string[]) => {
    const nextAliases = normalizeAliases(aliases);
    if (nextAliases.length === 0) return;
    setActionError(null);
    setPendingAction({ mode: "purge", aliases: nextAliases });
  };

  const confirmServerAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    setActionError(null);
    try {
      for (const alias of pendingAction.aliases) {
        if (pendingAction.mode === "purge") {
          await onCleanupServer(alias);
        } else {
          await onRemoveServer(alias);
        }
      }
      setPendingAction(null);
    } catch (err: any) {
      setActionError(
        err?.message ??
          (pendingAction.mode === "purge"
            ? "failed to purge device"
            : "failed to delete device")
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancelAction = () => {
    if (actionBusy) return;
    setPendingAction(null);
    setActionError(null);
  };

  return {
    pendingAction,
    actionBusy,
    actionError,
    generateServerKey,
    handleCredentialFieldBlur,
    requestDeleteServers,
    requestPurgeServers,
    confirmServerAction,
    handleCancelAction,
  };
}
