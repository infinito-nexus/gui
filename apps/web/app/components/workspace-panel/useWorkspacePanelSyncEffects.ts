import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { encodePath, rolesByAliasKey, sanitizeAliasFilename } from "./utils";
import type { CredentialsState, FileEntry } from "./types";

type UseWorkspacePanelSyncEffectsParams = {
  baseUrl: string;
  workspaceId: string | null;
  inventoryReady: boolean;
  activeAlias: string;
  activePath: string | null;
  editorDirty: boolean;
  generateBusy: boolean;
  workspaceLoading: boolean;
  selectedRolesByAlias: Record<string, string[]>;
  hostVarsAliases: string[];
  inventoryModifiedAt: string | null;
  hostVarsPath: string | null;
  hostVarsModifiedAt: string | null;
  credentials: CredentialsState;
  aliasRenames?: { from: string; to: string }[];
  aliasDeletes?: string[];
  aliasCleanups?: string[];
  onSelectedRolesByAliasChange?: (rolesByAlias: Record<string, string[]>) => void;
  onAliasRenamesHandled?: (count: number) => void;
  onAliasDeletesHandled?: (count: number) => void;
  onAliasCleanupsHandled?: (count: number) => void;
  selectionTouched?: boolean;
  files: FileEntry[];
  canGenerate: boolean;
  mergeRolesByAlias: (
    rolesByAlias: Record<string, string[]>
  ) => Record<string, string[]>;
  generateInventory: () => Promise<void>;
  syncInventoryWithSelection: (editorDirty: boolean) => Promise<void>;
  syncSelectionFromInventory: (editorDirty: boolean) => Promise<void>;
  renameAliasInInventory: (from: string, to: string) => Promise<void>;
  removeAliasFromInventory: (alias: string) => Promise<void>;
  renameWorkspaceFile: (fromPath: string, toPath: string) => Promise<void>;
  refreshFiles: (workspaceId: string) => Promise<void>;
  syncHostVarsFromCredentials: (editorDirty: boolean) => Promise<void>;
  syncCredentialsFromHostVars: (editorDirty: boolean) => Promise<void>;
  syncServerRequirementsFromCredentials: () => Promise<void>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setInventorySyncError: Dispatch<SetStateAction<string | null>>;
  inventorySeededRef: MutableRefObject<boolean>;
  initialRolesSyncDoneRef: MutableRefObject<boolean>;
  autoSyncRef: MutableRefObject<boolean>;
  deleteSyncRef: MutableRefObject<boolean>;
  hostVarsSyncTimerRef: MutableRefObject<number | null>;
};

export function useWorkspacePanelSyncEffects({
  baseUrl,
  workspaceId,
  inventoryReady,
  activeAlias,
  activePath,
  editorDirty,
  generateBusy,
  workspaceLoading,
  selectedRolesByAlias,
  hostVarsAliases,
  inventoryModifiedAt,
  hostVarsPath,
  hostVarsModifiedAt,
  credentials,
  aliasRenames,
  aliasDeletes,
  aliasCleanups,
  onSelectedRolesByAliasChange,
  onAliasRenamesHandled,
  onAliasDeletesHandled,
  onAliasCleanupsHandled,
  selectionTouched,
  files,
  canGenerate,
  mergeRolesByAlias,
  generateInventory,
  syncInventoryWithSelection,
  syncSelectionFromInventory,
  renameAliasInInventory,
  removeAliasFromInventory,
  renameWorkspaceFile,
  refreshFiles,
  syncHostVarsFromCredentials,
  syncCredentialsFromHostVars,
  syncServerRequirementsFromCredentials,
  setActivePath,
  setEditorValue,
  setEditorDirty,
  setInventorySyncError,
  inventorySeededRef,
  initialRolesSyncDoneRef,
  autoSyncRef,
  deleteSyncRef,
  hostVarsSyncTimerRef,
}: UseWorkspacePanelSyncEffectsParams) {
  useEffect(() => {
    inventorySeededRef.current = false;
    initialRolesSyncDoneRef.current = false;
  }, [workspaceId, inventorySeededRef, initialRolesSyncDoneRef]);

  useEffect(() => {
    if (!inventoryReady) {
      inventorySeededRef.current = false;
    }
  }, [inventoryReady, inventorySeededRef]);

  useEffect(() => {
    if (activeAlias) {
      inventorySeededRef.current = false;
    }
  }, [activeAlias, inventorySeededRef]);

  useEffect(() => {
    if (!workspaceId || !inventoryReady) return;
    if (!onSelectedRolesByAliasChange) {
      inventorySeededRef.current = true;
    }
  }, [workspaceId, inventoryReady, onSelectedRolesByAliasChange, inventorySeededRef]);

  useEffect(() => {
    if (selectionTouched) {
      inventorySeededRef.current = true;
    }
  }, [selectionTouched, inventorySeededRef]);

  const hasPendingAliasMutations =
    (aliasRenames?.length ?? 0) > 0 ||
    (aliasDeletes?.length ?? 0) > 0 ||
    (aliasCleanups?.length ?? 0) > 0;

  useEffect(() => {
    if (!workspaceId) return;
    if (!onSelectedRolesByAliasChange) return;
    if (hasPendingAliasMutations) return;
    const merged = mergeRolesByAlias(selectedRolesByAlias);
    const changed = rolesByAliasKey(merged) !== rolesByAliasKey(selectedRolesByAlias);
    if (changed || !initialRolesSyncDoneRef.current) {
      onSelectedRolesByAliasChange(merged);
      initialRolesSyncDoneRef.current = true;
    }
  }, [
    hasPendingAliasMutations,
    workspaceId,
    hostVarsAliases,
    onSelectedRolesByAliasChange,
    selectedRolesByAlias,
    mergeRolesByAlias,
    initialRolesSyncDoneRef,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    if (autoSyncRef.current) return;
    if (hasPendingAliasMutations) return;
    if (activePath === "inventory.yml" && editorDirty) return;

    const run = async () => {
      autoSyncRef.current = true;
      try {
        if (!inventoryReady) {
          if (canGenerate && !generateBusy && !workspaceLoading) {
            await generateInventory();
          }
          return;
        }
        if (!inventorySeededRef.current) {
          return;
        }
        await syncInventoryWithSelection(editorDirty);
      } finally {
        autoSyncRef.current = false;
      }
    };

    void run();
  }, [
    hasPendingAliasMutations,
    workspaceId,
    inventoryReady,
    canGenerate,
    generateBusy,
    workspaceLoading,
    selectedRolesByAlias,
    hostVarsAliases,
    activePath,
    editorDirty,
    generateInventory,
    syncInventoryWithSelection,
    autoSyncRef,
    inventorySeededRef,
  ]);

  useEffect(() => {
    if (!workspaceId || !inventoryReady) return;
    if (!onSelectedRolesByAliasChange) return;
    if (autoSyncRef.current) return;
    if (hasPendingAliasMutations) return;
    if (activePath === "inventory.yml" && editorDirty) return;

    const run = async () => {
      autoSyncRef.current = true;
      try {
        await syncSelectionFromInventory(editorDirty);
      } finally {
        autoSyncRef.current = false;
        inventorySeededRef.current = true;
      }
    };

    void run();
  }, [
    hasPendingAliasMutations,
    workspaceId,
    inventoryReady,
    inventoryModifiedAt,
    hostVarsAliases,
    onSelectedRolesByAliasChange,
    activeAlias,
    activePath,
    editorDirty,
    syncSelectionFromInventory,
    autoSyncRef,
    inventorySeededRef,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    if (!aliasRenames || aliasRenames.length === 0) return;
    if (autoSyncRef.current) return;

    const { from, to } = aliasRenames[0] || {};
    if (!from || !to || from === to) {
      onAliasRenamesHandled?.(1);
      return;
    }

    const run = async () => {
      autoSyncRef.current = true;
      try {
        if (inventoryReady) {
          await renameAliasInInventory(from, to);
        }
        try {
          await fetch(`${baseUrl}/api/workspaces/${workspaceId}/servers/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from_alias: from, to_alias: to }),
          });
        } catch {
          // ignore requirements rename errors
        }
        const fromSafe = sanitizeAliasFilename(from);
        const toSafe = sanitizeAliasFilename(to);

        const tryRename = async (fromPath: string, toPath: string) => {
          const fromExists = files.some((entry) => entry.path === fromPath);
          const toExists = files.some((entry) => entry.path === toPath);
          if (!fromExists || toExists) return;
          await renameWorkspaceFile(fromPath, toPath);
          if (activePath === fromPath) {
            setActivePath(toPath);
          }
        };

        await tryRename(`host_vars/${fromSafe}.yml`, `host_vars/${toSafe}.yml`);
        await tryRename(`secrets/ssh_keys/${fromSafe}`, `secrets/ssh_keys/${toSafe}`);
        await tryRename(
          `secrets/ssh_keys/${fromSafe}.pub`,
          `secrets/ssh_keys/${toSafe}.pub`
        );
        await refreshFiles(workspaceId);
      } catch (err: any) {
        setInventorySyncError(
          err?.message ? `Alias rename failed: ${err.message}` : "Alias rename failed."
        );
      } finally {
        autoSyncRef.current = false;
        onAliasRenamesHandled?.(1);
      }
    };

    void run();
  }, [
    baseUrl,
    workspaceId,
    inventoryReady,
    aliasRenames,
    files,
    activePath,
    onAliasRenamesHandled,
    renameAliasInInventory,
    renameWorkspaceFile,
    refreshFiles,
    setActivePath,
    setInventorySyncError,
    autoSyncRef,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    if (!aliasDeletes || aliasDeletes.length === 0) return;
    if (deleteSyncRef.current) return;

    const alias = aliasDeletes[0];
    if (!alias) {
      onAliasDeletesHandled?.(1);
      return;
    }

    const run = async () => {
      deleteSyncRef.current = true;
      try {
        if (inventoryReady) {
          await removeAliasFromInventory(alias);
        }
        try {
          await fetch(
            `${baseUrl}/api/workspaces/${workspaceId}/servers/${encodeURIComponent(
              alias
            )}/requirements`,
            { method: "DELETE" }
          );
        } catch {
          // ignore requirements delete errors
        }
        await refreshFiles(workspaceId);
      } catch (err: any) {
        setInventorySyncError(
          err?.message ? `Device delete failed: ${err.message}` : "Device delete failed."
        );
      } finally {
        deleteSyncRef.current = false;
        onAliasDeletesHandled?.(1);
      }
    };

    void run();
  }, [
    baseUrl,
    workspaceId,
    inventoryReady,
    aliasDeletes,
    onAliasDeletesHandled,
    removeAliasFromInventory,
    refreshFiles,
    setInventorySyncError,
    deleteSyncRef,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    if (!aliasCleanups || aliasCleanups.length === 0) return;
    if (deleteSyncRef.current) return;

    const alias = aliasCleanups[0];
    if (!alias) {
      onAliasCleanupsHandled?.(1);
      return;
    }

    const deleteFileIfExists = async (path: string) => {
      if (!files.some((entry) => entry.path === path)) return;
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      if (activePath === path) {
        setActivePath(null);
        setEditorValue("");
        setEditorDirty(false);
      }
    };

    const run = async () => {
      deleteSyncRef.current = true;
      try {
        if (inventoryReady) {
          await removeAliasFromInventory(alias);
        }
        try {
          await fetch(
            `${baseUrl}/api/workspaces/${workspaceId}/servers/${encodeURIComponent(
              alias
            )}/requirements`,
            { method: "DELETE" }
          );
        } catch {
          // ignore requirements cleanup errors
        }
        const safeAlias = sanitizeAliasFilename(alias);
        await deleteFileIfExists(`host_vars/${safeAlias}.yml`);
        await deleteFileIfExists(`secrets/ssh_keys/${safeAlias}`);
        await deleteFileIfExists(`secrets/ssh_keys/${safeAlias}.pub`);
        await refreshFiles(workspaceId);
      } catch (err: any) {
        setInventorySyncError(
          err?.message ? `Device cleanup failed: ${err.message}` : "Device cleanup failed."
        );
      } finally {
        deleteSyncRef.current = false;
        onAliasCleanupsHandled?.(1);
      }
    };

    void run();
  }, [
    workspaceId,
    inventoryReady,
    aliasCleanups,
    files,
    activePath,
    onAliasCleanupsHandled,
    baseUrl,
    removeAliasFromInventory,
    refreshFiles,
    setActivePath,
    setEditorDirty,
    setEditorValue,
    setInventorySyncError,
    deleteSyncRef,
  ]);

  useEffect(() => {
    if (hostVarsSyncTimerRef.current != null) {
      window.clearTimeout(hostVarsSyncTimerRef.current);
      hostVarsSyncTimerRef.current = null;
    }
    if (!workspaceId) return;

    hostVarsSyncTimerRef.current = window.setTimeout(() => {
      void syncHostVarsFromCredentials(editorDirty);
      void syncServerRequirementsFromCredentials();
    }, 1400);

    return () => {
      if (hostVarsSyncTimerRef.current == null) return;
      window.clearTimeout(hostVarsSyncTimerRef.current);
      hostVarsSyncTimerRef.current = null;
    };
  }, [
    workspaceId,
    credentials.description,
    credentials.primaryDomain,
    credentials.requirementServerType,
    credentials.requirementStorageGb,
    credentials.requirementLocation,
    credentials.host,
    credentials.port,
    credentials.user,
    credentials.color,
    credentials.logoEmoji,
    hostVarsPath,
    activePath,
    editorDirty,
    hostVarsSyncTimerRef,
    syncHostVarsFromCredentials,
    syncServerRequirementsFromCredentials,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    void syncCredentialsFromHostVars(editorDirty);
  }, [
    workspaceId,
    hostVarsPath,
    hostVarsModifiedAt,
    activePath,
    editorDirty,
    syncCredentialsFromHostVars,
  ]);
}
