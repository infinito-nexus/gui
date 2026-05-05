"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { useWorkspaceUsers } from "../workspace-panel/useWorkspaceUsers";
import { useWorkspaceHistory } from "../workspace-panel/useWorkspaceHistory";
import { useOrphanCleanup } from "../workspace-panel/useOrphanCleanup";
import { useUnsavedChangesGuard } from "../workspace-panel/useUnsavedChangesGuard";
import { useWorkspacePanelSyncEffects } from "../workspace-panel/useWorkspacePanelSyncEffects";
import { useWorkspacePanelSessionState } from "../workspace-panel/useWorkspacePanelSessionState";
import { useWorkspacePanelEditorUiEffects } from "../workspace-panel/useWorkspacePanelEditorUiEffects";
import { renderWorkspacePanelLayout } from "../workspace-panel/renderWorkspacePanelLayout";
import { useWorkspacePanelActions } from "../workspace-panel/useWorkspacePanelActions";
import { useWorkspacePanelDerivedState } from "../workspace-panel/useWorkspacePanelDerivedState";
import styles from "./Panel.module.css";
import {
  WORKSPACE_STORAGE_KEY,
  USER_STORAGE_KEY,
  USER_WORKSPACE_CURRENT_PREFIX,
  readQueryParam,
  loadWorkspaceList,
  saveWorkspaceList,
} from "../workspace-panel/utils";
import type {
  FileEntry,
  KdbxEntryView,
  VaultBlock,
  WorkspacePanelProps,
} from "../workspace-panel/types";

export default function WorkspacePanel({
  baseUrl,
  selectedRolesByAlias,
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
  compact = false,
}: WorkspacePanelProps) {
  const Wrapper = compact ? "div" : "section";
  const wrapperClassName = compact
    ? `${styles.root} ${styles.compactRoot}`
    : `${styles.root} ${styles.wrapper}`;
  const {
    userId,
    setUserId,
    workspaceList,
    setWorkspaceList,
    workspaceSwitcherTarget,
  } = useWorkspacePanelSessionState({
    readQueryParam,
    userStorageKey: USER_STORAGE_KEY,
  });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(
    null
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [inventoryReady, setInventoryReady] = useState(false);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState<string | null>(null);
  const [markdownHtml, setMarkdownHtml] = useState("");
  const [kdbxEntries, setKdbxEntries] = useState<KdbxEntryView[]>([]);
  const [kdbxError, setKdbxError] = useState<string | null>(null);
  const [kdbxLoading, setKdbxLoading] = useState(false);
  const [kdbxPromptOpen, setKdbxPromptOpen] = useState(false);
  const [kdbxRevealed, setKdbxRevealed] = useState<Record<string, boolean>>(
    {}
  );
  const kdbxPasswordRef = useRef<string>("");
  const kdbxArgonReadyRef = useRef(false);

  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());

  const [vaultPromptOpen, setVaultPromptOpen] = useState(false);
  const [vaultPromptMode, setVaultPromptMode] = useState<
    "generate" | "vault-reset" | null
  >(null);
  const [vaultPromptConfirm, setVaultPromptConfirm] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState<{
    roles: string[];
    force: boolean;
    setValues: string[];
    alias?: string;
    targets?: { alias: string; targetRoles: string[] }[];
  } | null>(null);
  const allowEmptyPlain = false;
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [credentialsScope, setCredentialsScope] = useState<"all" | "single">(
    "all"
  );
  const [credentialsRole, setCredentialsRole] = useState<string>("");
  const [credentialsBusy, setCredentialsBusy] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialsStatus, setCredentialsStatus] = useState<string | null>(null);

  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const autoSyncRef = useRef(false);
  const hostVarsSyncRef = useRef(false);
  const lastPortRef = useRef<string>("");
  const inventorySeededRef = useRef(false);
  const initialRolesSyncDoneRef = useRef(false);
  const markdownSyncRef = useRef(false);
  const deleteSyncRef = useRef(false);

  const [generateBusy, setGenerateBusy] = useState(false);
  const [inventorySyncError, setInventorySyncError] = useState<string | null>(
    null
  );

  const [fileOpError, setFileOpError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path?: string;
    isDir: boolean;
  } | null>(null);
  const [editorMenu, setEditorMenu] = useState<{
    x: number;
    y: number;
    block: VaultBlock;
  } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const hostVarsSyncTimerRef = useRef<number | null>(null);

  const [masterChangeOpen, setMasterChangeOpen] = useState(false);
  const [masterChangeError, setMasterChangeError] = useState<string | null>(null);
  const [masterChangeBusy, setMasterChangeBusy] = useState(false);
  const [masterChangeMode, setMasterChangeMode] = useState<"set" | "reset">(
    "reset"
  );
  const [masterChangeValues, setMasterChangeValues] = useState({
    current: "",
    next: "",
    confirm: "",
  });

  const [keyPassphraseModal, setKeyPassphraseModal] = useState<{
    alias: string;
  } | null>(null);
  const [keyPassphraseError, setKeyPassphraseError] = useState<string | null>(
    null
  );
  const [keyPassphraseBusy, setKeyPassphraseBusy] = useState(false);
  const [keyPassphraseValues, setKeyPassphraseValues] = useState({
    master: "",
    next: "",
    confirm: "",
  });

  const [vaultValueModal, setVaultValueModal] = useState<{
    mode: "show" | "change";
    block: VaultBlock;
    plaintext?: string;
    loading: boolean;
    error?: string | null;
  } | null>(null);
  const [vaultValueInputs, setVaultValueInputs] = useState({
    master: "",
    next: "",
    confirm: "",
  });

  const {
    activeAlias,
    inventoryModifiedAt,
    hostVarsPath,
    hostVarsModifiedAt,
    hostVarsAliases,
    hasCredentialsVault,
    activeRoles,
    serverRolesByAlias,
    credentialServerAliases,
    treeItems,
    activeExtension,
    isKdbx,
    editorExtensions,
    turndown,
    quillModules,
  } = useWorkspacePanelDerivedState({
    files,
    selectedRolesByAlias,
    credentials,
    activePath,
    openDirs,
  });

  useWorkspacePanelEditorUiEffects({
    activeExtension,
    editorValue,
    markdownSyncRef,
    setMarkdownHtml,
    contextMenu,
    setContextMenu,
    editorMenu,
    setEditorMenu,
    credentialsScope,
    activeRoles,
    setCredentialsRole,
  });


  const canGenerate = Boolean(
    workspaceId &&
      !inventoryReady &&
      activeAlias &&
      activeRoles.length > 0 &&
      credentials.host &&
      credentials.user
  );

  const {
    mergeRolesByAlias,
    refreshFiles,
    selectWorkspace,
    renameWorkspaceFile,
    createWorkspace,
    deleteWorkspace,
    toggleDir,
    lockKdbx,
    handleKdbxSubmit,
    loadFile,
    saveFile,
    generateInventory,
    renameAliasInInventory,
    removeAliasFromInventory,
    syncInventoryWithSelection,
    syncSelectionFromInventory,
    syncHostVarsFromCredentials,
    syncCredentialsFromHostVars,
    syncServerRequirementsFromCredentials,
    generateCredentials,
    resetVaultPassword,
    handleVaultPromptSubmit,
    submitMasterChange,
    submitKeyPassphraseChange,
    openVaultValueModal,
    submitVaultValue,
    downloadZip,
    downloadFile,
    openUploadPicker,
    createFile,
    createDirectory,
    renameFile,
    deleteFile,
    openContextMenu,
    zipImport,
    openMasterPasswordDialog,
  } = useWorkspacePanelActions({
    baseUrl, userId, openDirs, workspaceId, activePath, selectedRolesByAlias, activeAlias,
    activeRoles, credentials, hostVarsAliases, hostVarsPath, inventoryReady, canGenerate,
    inventorySyncError, onInventoryReadyChange, onWorkspaceIdChange,
    onSelectedRolesByAliasChange, onCredentialsPatch, setUserId, setWorkspaceList,
    setWorkspaceId, setFiles, setOpenDirs, setActivePath, setEditorValue, setEditorDirty,
    setEditorLoading, setEditorError, setEditorStatus, setMarkdownHtml, setKdbxEntries,
    setKdbxError, setKdbxLoading, setKdbxPromptOpen, setKdbxRevealed, setInventoryReady,
    setWorkspaceLoading, setWorkspaceError, setGenerateBusy, setInventorySyncError,
    kdbxPasswordRef, kdbxArgonReadyRef, inventorySeededRef, markdownSyncRef,
    hostVarsSyncRef, lastPortRef, readQueryParam, loadWorkspaceList, saveWorkspaceList,
    WORKSPACE_STORAGE_KEY, USER_WORKSPACE_CURRENT_PREFIX, allowEmptyPlain, credentialsBusy,
    credentialsScope, credentialsRole, forceOverwrite, pendingCredentials, vaultPromptMode,
    masterChangeValues, masterChangeMode, keyPassphraseModal, keyPassphraseValues,
    vaultValueModal, vaultValueInputs, editorValue, setCredentialsBusy, setCredentialsError,
    setCredentialsStatus, setPendingCredentials, setVaultPromptMode, setVaultPromptConfirm,
    setVaultPromptOpen, setMasterChangeBusy, setMasterChangeError, setMasterChangeMode,
    setMasterChangeOpen, setMasterChangeValues, setKeyPassphraseBusy, setKeyPassphraseError,
    setKeyPassphraseModal, setKeyPassphraseValues, setEditorMenu, setVaultValueInputs,
    setVaultValueModal, uploadBusy, uploadInputRef, setZipBusy, setZipError, setUploadBusy,
    setUploadError, setUploadStatus, setFileOpError, setContextMenu, isKdbx,
    hasCredentialsVault,
  });

  useWorkspacePanelSyncEffects({
    baseUrl, workspaceId, inventoryReady, activeAlias, activePath, editorDirty, generateBusy,
    workspaceLoading, selectedRolesByAlias, hostVarsAliases, inventoryModifiedAt,
    hostVarsPath, hostVarsModifiedAt, credentials, aliasRenames, aliasDeletes, aliasCleanups,
    onSelectedRolesByAliasChange, onAliasRenamesHandled, onAliasDeletesHandled,
    onAliasCleanupsHandled, selectionTouched, files, canGenerate, mergeRolesByAlias,
    generateInventory, syncInventoryWithSelection, syncSelectionFromInventory,
    renameAliasInInventory, removeAliasFromInventory, renameWorkspaceFile, refreshFiles,
    syncHostVarsFromCredentials, syncCredentialsFromHostVars, syncServerRequirementsFromCredentials, setActivePath,
    setEditorValue, setEditorDirty, setInventorySyncError, inventorySeededRef,
    initialRolesSyncDoneRef, autoSyncRef, deleteSyncRef, hostVarsSyncTimerRef,
  });

  const orphanCleanup = useOrphanCleanup({
    baseUrl,
    workspaceId,
    files,
    activePath,
    setActivePath,
    setEditorValue,
    setEditorDirty,
    refreshFiles,
  });

  const readApiDetail = useCallback(async (res: Response): Promise<string> => {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) message = String(data.detail);
    } catch {
      // ignore response parse errors
    }
    return message;
  }, []);

  const leaveGuard = useUnsavedChangesGuard({
    workspaceId,
    activePath,
    isKdbx,
    editorDirty,
    editorValue,
    saveFile,
  });

  const history = useWorkspaceHistory({
    baseUrl,
    workspaceId,
    readApiDetail,
    refreshFiles,
    activePath,
    loadFile,
    setEditorDirty,
  });

  useEffect(() => {
    return () => {
      if (hostVarsSyncTimerRef.current == null) return;
      window.clearTimeout(hostVarsSyncTimerRef.current);
      hostVarsSyncTimerRef.current = null;
    };
  }, []);

  const users = useWorkspaceUsers({
    baseUrl,
    workspaceId,
    readApiDetail,
    refreshFiles,
  });

  return renderWorkspacePanelLayout({
    compact, Wrapper, wrapperClassName, userId, workspaceId, inventoryReady, workspaceList,
    workspaceError, inventorySyncError, workspaceLoading, deletingWorkspaceId,
    workspaceSwitcherTarget, createWorkspace, selectWorkspace, deleteWorkspace,
    setWorkspaceError, setDeletingWorkspaceId, activePath, activeExtension, isKdbx,
    editorDirty, editorLoading, loadFile, kdbxPasswordRef, lockKdbx, setKdbxPromptOpen,
    editorValue, setEditorValue, setEditorDirty, setEditorStatus, setEditorError,
    editorExtensions, editorViewRef, setContextMenu, setEditorMenu, markdownHtml,
    setMarkdownHtml, markdownSyncRef, turndown, quillModules, kdbxLoading, kdbxError,
    kdbxEntries, kdbxRevealed, setKdbxRevealed, editorError, editorStatus, openDirs,
    treeItems, toggleDir, fileOpError, openContextMenu, generateCredentials,
    resetVaultPassword, openMasterPasswordDialog, hasCredentialsVault, credentialsBusy,
    activeAlias, credentialServerAliases, serverRolesByAlias, credentialsScope, activeRoles,
    credentialsRole, setCredentialsRole, setCredentialsScope, forceOverwrite,
    setForceOverwrite, credentialsError, credentialsStatus, downloadZip, zipBusy,
    openUploadPicker, uploadInputRef, uploadError, zipError, uploadStatus, uploadBusy,
    createFile, createDirectory, renameFile, downloadFile, deleteFile, setMasterChangeOpen,
    setMasterChangeMode, setMasterChangeError, setKeyPassphraseModal, setKeyPassphraseError,
    openVaultValueModal, kdbxPromptOpen, handleKdbxSubmit, setEditorLoading,
    vaultPromptOpen, vaultPromptConfirm, handleVaultPromptSubmit, setVaultPromptOpen,
    setVaultPromptMode, setPendingCredentials, masterChangeOpen, masterChangeMode,
    masterChangeValues, setMasterChangeValues, masterChangeError, submitMasterChange,
    masterChangeBusy, keyPassphraseModal, keyPassphraseValues, setKeyPassphraseValues,
    keyPassphraseError, submitKeyPassphraseChange, keyPassphraseBusy, vaultValueModal,
    setVaultValueModal, vaultValueInputs, setVaultValueInputs, submitVaultValue,
    contextMenu, editorMenu, users, history, orphanCleanup, leaveGuard, zipImport,
  });
}
