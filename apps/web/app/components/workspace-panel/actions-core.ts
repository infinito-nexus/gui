import {
  collectKdbxEntries,
  encodePath,
  extractRolesByAlias,
  normalizeRoles,
  rolesByAliasKey,
} from "./utils";
import { createWorkspacePanelEditorActions } from "./actions-core-editor";
import { createWorkspacePanelSyncActions } from "./actions-core-sync";
import { createWorkspacePanelWorkspaceActions } from "./actions-core-workspaces";

export function createWorkspacePanelCoreActions(ctx: any) {
  const {
    baseUrl,
    userId,
    openDirs,
    workspaceId,
    activePath,
    selectedRolesByAlias,
    activeAlias,
    activeRoles,
    credentials,
    hostVarsAliases,
    hostVarsPath,
    inventoryReady,
    canGenerate,
    onInventoryReadyChange,
    onWorkspaceIdChange,
    onSelectedRolesByAliasChange,
    onCredentialsPatch,
    setUserId,
    setWorkspaceList,
    setWorkspaceId,
    setFiles,
    setOpenDirs,
    setActivePath,
    setEditorValue,
    setEditorDirty,
    setEditorLoading,
    setEditorError,
    setEditorStatus,
    setMarkdownHtml,
    setKdbxEntries,
    setKdbxError,
    setKdbxLoading,
    setKdbxPromptOpen,
    setKdbxRevealed,
    setInventoryReady,
    setWorkspaceLoading,
    setWorkspaceError,
    setGenerateBusy,
    setInventorySyncError,
    kdbxPasswordRef,
    kdbxArgonReadyRef,
    inventorySeededRef,
    markdownSyncRef,
    hostVarsSyncRef,
    lastPortRef,
    readQueryParam,
    loadWorkspaceList,
    saveWorkspaceList,
    WORKSPACE_STORAGE_KEY,
    USER_WORKSPACE_CURRENT_PREFIX,
  } = ctx;

  const syncInventoryReady = (nextFiles: any[]) => {
    const ready = nextFiles.some((f) => f.path === "inventory.yml");
    setInventoryReady(ready);
    onInventoryReadyChange?.(ready);
  };

  const mergeRolesByAlias = (incoming: Record<string, string[]>): Record<string, string[]> => {
    const merged: Record<string, string[]> = {};
    Object.entries(incoming || {}).forEach(([alias, roles]) => {
      const key = (alias || "").trim();
      if (!key) return;
      merged[key] = normalizeRoles(roles || []);
    });
    hostVarsAliases.forEach((alias: string) => {
      if (!merged[alias]) {
        merged[alias] = [];
      }
    });
    return merged;
  };

  const updateWorkspaceUrl = (id: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("workspace", id);
    } else {
      url.searchParams.delete("workspace");
    }
    window.history.replaceState({}, "", url.toString());
  };

  const resetWorkspaceState = () => {
    setFiles([]);
    setOpenDirs(new Set());
    setActivePath(null);
    setEditorValue("");
    setEditorDirty(false);
    setEditorLoading(false);
    setEditorError(null);
    setEditorStatus(null);
    setMarkdownHtml("");
    setKdbxEntries([]);
    setKdbxError(null);
    setKdbxLoading(false);
    setKdbxPromptOpen(false);
    setKdbxRevealed({});
    setInventoryReady(false);
    onInventoryReadyChange?.(false);
  };

  const rememberWorkspace = (id: string, createdAt?: string | null) => {
    if (!userId) return;
    const now = new Date().toISOString();
    setWorkspaceList((prev: any[]) => {
      const next = prev.some((entry) => entry.id === id)
        ? prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  last_used: now,
                  created_at: entry.created_at ?? createdAt ?? now,
                }
              : entry
          )
        : [...prev, { id, created_at: createdAt ?? now, last_used: now }];
      saveWorkspaceList(userId, next);
      return next;
    });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${USER_WORKSPACE_CURRENT_PREFIX}${userId}`, id);
    }
  };

  const workspaceActions = createWorkspacePanelWorkspaceActions({
    baseUrl,
    userId,
    openDirs,
    workspaceId,
    setUserId,
    setWorkspaceList,
    setWorkspaceId,
    setWorkspaceLoading,
    setWorkspaceError,
    setFiles,
    setOpenDirs,
    onWorkspaceIdChange,
    syncInventoryReady,
    resetWorkspaceState,
    rememberWorkspace,
    updateWorkspaceUrl,
    readQueryParam,
    saveWorkspaceList,
    loadWorkspaceList,
    WORKSPACE_STORAGE_KEY,
    USER_WORKSPACE_CURRENT_PREFIX,
  });

  const {
    refreshFiles,
    selectWorkspace,
    createWorkspace,
    initWorkspace,
    deleteWorkspace,
  } = workspaceActions;

  const readWorkspaceFile = async (path: string) => {
    if (!workspaceId) {
      throw new Error("workspace not ready");
    }
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return String(data?.content ?? "");
  };

  const writeWorkspaceFile = async (path: string, content: string) => {
    if (!workspaceId) {
      throw new Error("workspace not ready");
    }
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  };

  const renameWorkspaceFile = async (path: string, newPath: string) => {
    if (!workspaceId) {
      throw new Error("workspace not ready");
    }
    const res = await fetch(
      `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}/rename`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_path: newPath }),
      }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  };

  const {
    lockKdbx,
    loadKdbx,
    handleKdbxSubmit,
    loadFile,
    validateEditor,
    saveFile,
  } = createWorkspacePanelEditorActions({
    baseUrl,
    workspaceId,
    activePath,
    selectedRolesByAlias,
    onSelectedRolesByAliasChange,
    kdbxPasswordRef,
    kdbxArgonReadyRef,
    inventorySeededRef,
    mergeRolesByAlias,
    normalizeRoles,
    readWorkspaceFile,
    refreshFiles,
    setActivePath,
    setEditorValue,
    setEditorDirty,
    setEditorLoading,
    setEditorError,
    setEditorStatus,
    setKdbxEntries,
    setKdbxError,
    setKdbxLoading,
    setKdbxPromptOpen,
    setKdbxRevealed,
    collectKdbxEntries,
  });

  const {
    generateInventory,
    resolveTargetRoles,
    renameAliasInInventory,
    removeAliasFromInventory,
    syncInventoryWithSelection,
    syncSelectionFromInventory,
    syncHostVarsFromCredentials,
    syncCredentialsFromHostVars,
    syncServerRequirementsFromCredentials,
  } = createWorkspacePanelSyncActions({
    baseUrl,
    workspaceId,
    inventoryReady,
    canGenerate,
    activeAlias,
    activeRoles,
    selectedRolesByAlias,
    activePath,
    credentials,
    hostVarsPath,
    hostVarsSyncRef,
    lastPortRef,
    onSelectedRolesByAliasChange,
    onCredentialsPatch,
    mergeRolesByAlias,
    normalizeRoles,
    rolesByAliasKey,
    extractRolesByAlias,
    readWorkspaceFile,
    writeWorkspaceFile,
    refreshFiles,
    setEditorValue,
    setEditorDirty,
    setGenerateBusy,
    setInventorySyncError,
    inventorySyncError: ctx.inventorySyncError,
  });

  const toggleDir = (path: string) => {
    setOpenDirs((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return {
    syncInventoryReady,
    mergeRolesByAlias,
    updateWorkspaceUrl,
    resetWorkspaceState,
    rememberWorkspace,
    refreshFiles,
    selectWorkspace,
    readWorkspaceFile,
    writeWorkspaceFile,
    renameWorkspaceFile,
    createWorkspace,
    initWorkspace,
    deleteWorkspace,
    toggleDir,
    lockKdbx,
    loadKdbx,
    handleKdbxSubmit,
    loadFile,
    validateEditor,
    saveFile,
    generateInventory,
    resolveTargetRoles,
    renameAliasInInventory,
    removeAliasFromInventory,
    syncInventoryWithSelection,
    syncSelectionFromInventory,
    syncHostVarsFromCredentials,
    syncCredentialsFromHostVars,
    syncServerRequirementsFromCredentials,
  };
}
