import { createPortal } from "react-dom";
import WorkspaceSwitcher from "./switcher/Switcher";
import WorkspacePanelLayout from "./panel/Layout";
import UsersOverviewPanel from "./UsersOverviewPanel";
import { USERS_GROUP_VARS_PATH } from "./users-utils";

export function renderWorkspacePanelLayout(ctx: any) {
  const {
    compact,
    Wrapper,
    wrapperClassName,
    userId,
    workspaceId,
    inventoryReady,
    workspaceList,
    workspaceError,
    inventorySyncError,
    workspaceLoading,
    deletingWorkspaceId,
    workspaceSwitcherTarget,
    createWorkspace,
    selectWorkspace,
    deleteWorkspace,
    setWorkspaceError,
    setDeletingWorkspaceId,
    activePath,
    activeExtension,
    isKdbx,
    editorDirty,
    editorLoading,
    loadFile,
    kdbxPasswordRef,
    lockKdbx,
    setKdbxPromptOpen,
    editorValue,
    setEditorValue,
    setEditorDirty,
    setEditorStatus,
    setEditorError,
    editorExtensions,
    editorViewRef,
    setContextMenu,
    setEditorMenu,
    markdownHtml,
    setMarkdownHtml,
    markdownSyncRef,
    turndown,
    quillModules,
    kdbxLoading,
    kdbxError,
    kdbxEntries,
    kdbxRevealed,
    setKdbxRevealed,
    editorError,
    editorStatus,
    openDirs,
    treeItems,
    toggleDir,
    fileOpError,
    openContextMenu,
    generateCredentials,
    resetVaultPassword,
    openMasterPasswordDialog,
    hasCredentialsVault,
    credentialsBusy,
    activeAlias,
    credentialServerAliases,
    serverRolesByAlias,
    credentialsScope,
    activeRoles,
    credentialsRole,
    setCredentialsRole,
    setCredentialsScope,
    forceOverwrite,
    setForceOverwrite,
    credentialsError,
    credentialsStatus,
    downloadZip,
    zipBusy,
    openUploadPicker,
    uploadInputRef,
    uploadError,
    zipError,
    uploadStatus,
    uploadBusy,
    createFile,
    createDirectory,
    renameFile,
    downloadFile,
    deleteFile,
    setMasterChangeOpen,
    setMasterChangeMode,
    setMasterChangeError,
    setKeyPassphraseModal,
    setKeyPassphraseError,
    openVaultValueModal,
    kdbxPromptOpen,
    handleKdbxSubmit,
    setEditorLoading,
    vaultPromptOpen,
    vaultPromptConfirm,
    handleVaultPromptSubmit,
    setVaultPromptOpen,
    setVaultPromptMode,
    setPendingCredentials,
    masterChangeOpen,
    masterChangeMode,
    masterChangeValues,
    setMasterChangeValues,
    masterChangeError,
    submitMasterChange,
    masterChangeBusy,
    keyPassphraseModal,
    keyPassphraseValues,
    setKeyPassphraseValues,
    keyPassphraseError,
    submitKeyPassphraseChange,
    keyPassphraseBusy,
    vaultValueModal,
    setVaultValueModal,
    vaultValueInputs,
    setVaultValueInputs,
    submitVaultValue,
    contextMenu,
    editorMenu,
    users,
    history,
    orphanCleanup,
    leaveGuard,
    zipImport,
  } = ctx;

  const canGenerateCredentials =
    inventoryReady &&
    !!workspaceId &&
    !credentialsBusy &&
    credentialServerAliases.some(
      (alias: string) => (serverRolesByAlias[alias] ?? []).length > 0
    );

  const requestWorkspaceDelete = (id: string) => {
    leaveGuard.queueLeaveAction(() => {
      void (async () => {
        const targetId = String(id || "").trim();
        if (!targetId) return;
        const confirmed = window.confirm(
          `Delete workspace '${targetId}'? This action cannot be undone.`
        );
        if (!confirmed) return;
        setWorkspaceError(null);
        setDeletingWorkspaceId(targetId);
        try {
          await deleteWorkspace(targetId);
        } catch (err: any) {
          setWorkspaceError(err?.message ?? "failed to delete workspace");
        } finally {
          setDeletingWorkspaceId(null);
        }
      })();
    });
  };

  const deletingActiveWorkspace = Boolean(
    workspaceId && deletingWorkspaceId === workspaceId
  );

  const workspaceSwitcher =
    userId && workspaceSwitcherTarget
      ? createPortal(
          <WorkspaceSwitcher
            currentId={workspaceId}
            workspaces={workspaceList}
            onSelect={(id) => {
              leaveGuard.queueLeaveAction(() => {
                void selectWorkspace(id);
              });
            }}
            onCreate={() => {
              leaveGuard.queueLeaveAction(() => {
                void createWorkspace();
              });
            }}
          />,
          workspaceSwitcherTarget
        )
      : null;

  const usersEditorOverrideContent = users.usersOverviewOpen ? (
    <UsersOverviewPanel
      open={users.usersOverviewOpen}
      usersGroupVarsPath={USERS_GROUP_VARS_PATH}
      usersLoading={users.usersLoading}
      usersSaving={users.usersSaving}
      usersDraft={users.usersDraft}
      usersSelection={users.usersSelection}
      selectedUsersCount={users.selectedUsersCount}
      usersError={users.usersError}
      usersStatus={users.usersStatus}
      usersImportInputRef={users.usersImportInputRef}
      onSetUsersSelectionAll={users.setUsersSelectionAll}
      onDeleteSelectedUsers={users.deleteSelectedUsers}
      onSaveWorkspaceUsers={() => {
        void users.saveWorkspaceUsers();
      }}
      onCloseUsersEditor={users.closeUsersEditor}
      onStartCreateUserEditor={users.startCreateUserEditor}
      onToggleUserSelection={users.toggleUserSelection}
      onStartEditUserEditor={users.startEditUserEditor}
      onRemoveUserDraft={users.removeUserDraft}
      onHandleUsersImportSelect={(event) => {
        void users.handleUsersImportSelect(event);
      }}
    />
  ) : null;

  return (
    <WorkspacePanelLayout
      workspaceSwitcher={workspaceSwitcher}
      Wrapper={Wrapper}
      wrapperClassName={wrapperClassName}
      headerProps={{
        compact,
        userId,
        workspaceId,
        inventoryReady,
        workspaceList,
        workspaceError,
        inventorySyncError,
        workspaceLoading,
        deletingWorkspaceId,
        onCreateWorkspace: () => {
          leaveGuard.queueLeaveAction(() => {
            void createWorkspace();
          });
        },
        onSelectWorkspace: (id: string) => {
          leaveGuard.queueLeaveAction(() => {
            void selectWorkspace(id);
          });
        },
        onDeleteWorkspace: requestWorkspaceDelete,
      }}
      fileEditorProps={{
        activePath,
        activeExtension,
        isKdbx,
        editorDirty,
        editorLoading,
        saveFile: () => {
          void leaveGuard.flushPendingEditorSave();
        },
        loadFile: (path: string) => {
          void loadFile(path);
        },
        kdbxPasswordRef,
        lockKdbx,
        setKdbxPromptOpen,
        editorValue,
        setEditorValue,
        setEditorDirty,
        setEditorStatus,
        setEditorError,
        editorExtensions,
        editorViewRef,
        setContextMenu,
        setEditorMenu,
        markdownHtml,
        setMarkdownHtml,
        markdownSyncRef,
        turndown,
        quillModules,
        kdbxLoading,
        kdbxError,
        kdbxEntries,
        kdbxRevealed,
        setKdbxRevealed,
        editorError,
        editorStatus,
        openDirs,
        treeItems,
        toggleDir,
        fileOpError,
        openContextMenu,
        editorOverrideContent: usersEditorOverrideContent,
      }}
      cardsProps={{
        generateCredentials,
        resetVaultPassword,
        openMasterPasswordDialog,
        hasCredentialsVault,
        canGenerateCredentials,
        credentialsBusy,
        workspaceId,
        activeAlias,
        serverAliases: credentialServerAliases,
        serverRolesByAlias,
        credentialsScope,
        activeRoles,
        credentialsRole,
        setCredentialsRole,
        setCredentialsScope,
        forceOverwrite,
        setForceOverwrite,
        credentialsError,
        credentialsStatus,
        downloadZip,
        zipBusy,
        openUploadPicker,
        uploadBusy: zipImport.importActionBusy,
        uploadInputRef,
        onUploadSelect: zipImport.onUploadSelect,
        uploadError,
        zipError,
        uploadStatus,
        openInventoryCleanup: orphanCleanup.openOrphanCleanupDialog,
        inventoryCleanupBusy:
          orphanCleanup.orphanCleanupLoading || orphanCleanup.orphanCleanupBusy,
        deletingWorkspace: deletingActiveWorkspace,
        onDeleteWorkspace: requestWorkspaceDelete,
        onOpenHistory: () => {
          history.openHistory(null, false, "history");
        },
        onUsersAction: (action: any) => {
          void users.openUsersEditor(action);
        },
      }}
      zipImportProps={{
        open: zipImport.zipImportModalOpen,
        fileName: zipImport.zipImportFile?.name || "",
        busy: uploadBusy,
        previewBusy: zipImport.zipImportPreviewBusy,
        items: zipImport.zipImportItems,
        modeByPath: zipImport.zipImportModeByPath,
        applyToAll: zipImport.zipImportApplyAll,
        allMode: zipImport.zipImportAllMode,
        error: zipImport.zipImportError,
        onClose: zipImport.closeZipImportModal,
        onConfirm: () => {
          void zipImport.confirmZipImport();
        },
        onToggleApplyToAll: zipImport.setZipImportApplyToAll,
        onSetAllMode: zipImport.setZipImportAllModeWithApply,
        onSetModeForPath: zipImport.setZipImportModeForPath,
      }}
      orphanCleanupProps={{
        open: orphanCleanup.orphanCleanupOpen,
        loading: orphanCleanup.orphanCleanupLoading,
        busy: orphanCleanup.orphanCleanupBusy,
        items: orphanCleanup.orphanCleanupItems,
        selected: orphanCleanup.orphanCleanupSelected,
        error: orphanCleanup.orphanCleanupError,
        status: orphanCleanup.orphanCleanupStatus,
        onClose: () => orphanCleanup.setOrphanCleanupOpen(false),
        onRescan: () => {
          void orphanCleanup.openOrphanCleanupDialog();
        },
        onDeleteSelected: () => {
          void orphanCleanup.deleteOrphanCleanupSelection();
        },
        onSetSelectionAll: orphanCleanup.setOrphanSelectionAll,
        onToggleSelection: orphanCleanup.toggleOrphanSelection,
      }}
      userEntryProps={{
        open: users.userEntryModalOpen,
        usersSaving: users.usersSaving,
        usersEditorMode: users.usersEditorMode,
        editingUsername: users.editingUsername,
        userForm: users.userForm,
        setUserForm: users.setUserForm,
        onClose: users.closeUserEntryModal,
        onApply: users.applyUserEditor,
      }}
      historyProps={{
        open: history.historyOpen,
        restoreBusy: history.historyRestoreBusy,
        historyLoading: history.historyLoading,
        historyDiffLoading: history.historyDiffLoading,
        historyError: history.historyError,
        historyStatus: history.historyStatus,
        historyScopePath: history.historyScopePath,
        historyScopeIsDir: history.historyScopeIsDir,
        historyOpenIntent: history.historyOpenIntent,
        historyAgainstCurrent: history.historyAgainstCurrent,
        historyCommits: history.historyCommits,
        historySelectedSha: history.historySelectedSha,
        historySelectedCommit: history.historySelectedCommit,
        historyDisplayedFiles: history.historyDisplayedFiles,
        historyDiff: history.historyDiff,
        onClose: () => history.setHistoryOpen(false),
        onSetAgainstCurrent: history.setHistoryAgainstCurrent,
        onRefresh: () => {
          void history.fetchHistoryCommits(history.historyScopePath, true);
        },
        onRestorePath: () => {
          void history.restoreHistoryPath();
        },
        onRestoreWorkspace: () => {
          void history.restoreHistoryWorkspace();
        },
        onSelectCommit: history.setHistorySelectedSha,
      }}
      leaveGuardProps={{
        open: leaveGuard.leaveGuardOpen,
        saveInProgress: leaveGuard.saveInProgress,
        leaveGuardMessage: leaveGuard.leaveGuardMessage,
        lastSaveAckAt: leaveGuard.lastSaveAckAt,
        onSaveAndLeave: () => {
          void leaveGuard.saveAndExecutePendingLeaveAction();
        },
        onCancel: leaveGuard.cancelPendingLeaveAction,
      }}
      overlayProps={{
        contextMenu,
        setContextMenu,
        createFile,
        createDirectory,
        renameFile,
        downloadFile,
        deleteFile,
        openHistoryForPath: (path: string, isDir: boolean) => {
          history.openHistory(path, isDir, "history");
        },
        openDiffCurrentForPath: (path: string, isDir: boolean) => {
          history.openHistory(path, isDir, "diff-current");
        },
        openRestoreForPath: (path: string, isDir: boolean) => {
          history.openHistory(path, isDir, "restore");
        },
        setMasterChangeOpen,
        setMasterChangeMode,
        setMasterChangeError,
        setKeyPassphraseModal,
        setKeyPassphraseError,
        editorMenu,
        setEditorMenu,
        openVaultValueModal,
        kdbxPromptOpen,
        handleKdbxSubmit,
        setKdbxPromptOpen,
        setEditorLoading,
        vaultPromptOpen,
        vaultPromptConfirm,
        handleVaultPromptSubmit,
        setVaultPromptOpen,
        setVaultPromptMode,
        setPendingCredentials,
        masterChangeOpen,
        masterChangeMode,
        masterChangeValues,
        setMasterChangeValues,
        masterChangeError,
        submitMasterChange,
        masterChangeBusy,
        keyPassphraseModal,
        keyPassphraseValues,
        setKeyPassphraseValues,
        keyPassphraseError,
        submitKeyPassphraseChange,
        keyPassphraseBusy,
        vaultValueModal,
        setVaultValueModal,
        vaultValueInputs,
        setVaultValueInputs,
        submitVaultValue,
      }}
    />
  );
}
