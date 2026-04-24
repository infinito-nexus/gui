import { useEffect, useRef } from "react";
import { createWorkspacePanelCoreActions } from "./actions-core";
import { createWorkspacePanelVaultActions } from "./actions-vault";
import { createWorkspacePanelFileActions } from "./actions-files";
import { useZipImportWorkflow } from "./useZipImportWorkflow";

export function useWorkspacePanelActions(ctx: any) {
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
    inventorySyncError,
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
    allowEmptyPlain,
    credentialsBusy,
    credentialsScope,
    credentialsRole,
    forceOverwrite,
    hasCredentialsVault,
    pendingCredentials,
    vaultPromptMode,
    masterChangeValues,
    masterChangeMode,
    keyPassphraseModal,
    keyPassphraseValues,
    vaultValueModal,
    vaultValueInputs,
    editorValue,
    setCredentialsBusy,
    setCredentialsError,
    setCredentialsStatus,
    setPendingCredentials,
    setVaultPromptMode,
    setVaultPromptConfirm,
    setVaultPromptOpen,
    setMasterChangeBusy,
    setMasterChangeError,
    setMasterChangeMode,
    setMasterChangeOpen,
    setMasterChangeValues,
    setKeyPassphraseBusy,
    setKeyPassphraseError,
    setKeyPassphraseModal,
    setKeyPassphraseValues,
    setEditorMenu,
    setVaultValueInputs,
    setVaultValueModal,
    uploadBusy,
    uploadInputRef,
    setZipBusy,
    setZipError,
    setUploadBusy,
    setUploadError,
    setUploadStatus,
    setFileOpError,
    isKdbx,
  } = ctx;

  const coreActions = createWorkspacePanelCoreActions({
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
    inventorySyncError,
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
  });

  const vaultActions = createWorkspacePanelVaultActions({
    baseUrl,
    workspaceId,
    activeAlias,
    activePath,
    allowEmptyPlain,
    credentialsBusy,
    credentialsScope,
    credentialsRole,
    forceOverwrite,
    hasCredentialsVault,
    pendingCredentials,
    vaultPromptMode,
    masterChangeValues,
    masterChangeMode,
    keyPassphraseModal,
    keyPassphraseValues,
    vaultValueModal,
    vaultValueInputs,
    editorValue,
    inventorySyncError,
    refreshFiles: coreActions.refreshFiles,
    resolveTargetRoles: coreActions.resolveTargetRoles,
    setCredentialsBusy,
    setCredentialsError,
    setCredentialsStatus,
    setPendingCredentials,
    setVaultPromptMode,
    setVaultPromptConfirm,
    setVaultPromptOpen,
    setMasterChangeBusy,
    setMasterChangeError,
    setMasterChangeOpen,
    setMasterChangeValues,
    setKeyPassphraseBusy,
    setKeyPassphraseError,
    setKeyPassphraseModal,
    setKeyPassphraseValues,
    setEditorMenu,
    setVaultValueInputs,
    setVaultValueModal,
    setEditorValue,
    setEditorDirty,
  });

  const fileActions = createWorkspacePanelFileActions({
    baseUrl,
    workspaceId,
    uploadBusy,
    activePath,
    uploadInputRef,
    setZipBusy,
    setZipError,
    setWorkspaceError,
    setUploadBusy,
    setUploadError,
    setUploadStatus,
    setFileOpError,
    setActivePath,
    setEditorValue,
    setEditorDirty,
    setContextMenu: ctx.setContextMenu,
    setEditorMenu,
    refreshFiles: coreActions.refreshFiles,
    loadFile: coreActions.loadFile,
  });

  const zipImport = useZipImportWorkflow({
    workspaceId,
    uploadBusy,
    previewZip: fileActions.previewZip,
    uploadZip: fileActions.uploadZip,
    setUploadError,
    setUploadStatus,
  });

  const initWorkspaceRef = useRef(coreActions.initWorkspace);

  useEffect(() => {
    initWorkspaceRef.current = coreActions.initWorkspace;
  }, [coreActions.initWorkspace]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!alive) return;
      await initWorkspaceRef.current();
    })();
    return () => {
      alive = false;
    };
  }, [baseUrl, onWorkspaceIdChange, userId]);

  useEffect(() => {
    if (isKdbx) return;
    setKdbxEntries([]);
    setKdbxError(null);
    setKdbxLoading(false);
    setKdbxRevealed({});
    kdbxPasswordRef.current = "";
  }, [
    isKdbx,
    kdbxPasswordRef,
    setKdbxEntries,
    setKdbxError,
    setKdbxLoading,
    setKdbxRevealed,
  ]);

  const openMasterPasswordDialog = () => {
    setMasterChangeMode(hasCredentialsVault ? "reset" : "set");
    setMasterChangeError(null);
    setMasterChangeValues({ current: "", next: "", confirm: "" });
    setMasterChangeOpen(true);
  };

  return {
    ...coreActions,
    ...vaultActions,
    ...fileActions,
    zipImport,
    openMasterPasswordDialog,
  };
}
