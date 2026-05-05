"use client";
import { useCallback, useMemo } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  Dispatch,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import type {
  OverlayMenu,
  PrimaryDomainMenu,
  StatusIndicator,
  StatusPopover,
} from "./server-collection/View.types";
import {
  getAliasErrorFor,
  normalizePortValue,
} from "./server-collection/View.utils";
import type { ServerState } from "./types";
import { useServerCollectionValidation } from "./useServerCollectionValidation";
type CredentialField =
  | "host"
  | "port"
  | "user"
  | "password"
  | "passwordConfirm"
  | "privateKey"
  | "keyPassphrase"
  | "primaryDomain";
type UseServerCollectionActionsProps = {
  aliasCounts: Record<string, number>;
  aliasDrafts: Record<string, string>;
  setAliasDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  passwordConfirmDrafts: Record<string, string>;
  setPasswordConfirmDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  keyInputModeByAlias: Record<string, "import" | "generate">;
  setKeyInputModeByAlias: Dispatch<
    SetStateAction<Record<string, "import" | "generate">>
  >;
  selectedAliases: Set<string>;
  setSelectedAliases: Dispatch<SetStateAction<Set<string>>>;
  visibleAliases: string[];
  paginatedServers: ServerState[];
  detailAlias: string | null;
  setDetailAlias: Dispatch<SetStateAction<string | null>>;
  actionMenu: OverlayMenu | null;
  setActionMenu: Dispatch<SetStateAction<OverlayMenu | null>>;
  setBulkMenu: Dispatch<SetStateAction<{ top: number; left: number } | null>>;
  statusPopover: StatusPopover | null;
  setStatusPopover: Dispatch<SetStateAction<StatusPopover | null>>;
  primaryDomainMenu: PrimaryDomainMenu | null;
  setPrimaryDomainMenu: Dispatch<SetStateAction<PrimaryDomainMenu | null>>;
  primaryDomainByLower: Map<string, string>;
  normalizedPrimaryDomainOptions: string[];
  setDetailActionBusy: Dispatch<SetStateAction<"keygen" | null>>;
  setDetailActionError: Dispatch<SetStateAction<string | null>>;
  setDetailActionStatus: Dispatch<SetStateAction<string | null>>;
  onAliasChange: (alias: string, nextAlias: string) => void;
  onPatchServer: (alias: string, patch: Partial<ServerState>) => void;
  onOpenDetail: (alias: string) => void;
  onGenerateKey: (alias: string) => Promise<void> | void;
  onCredentialFieldBlur: (payload: {
    server: ServerState;
    field: CredentialField;
    passwordConfirm?: string;
  }) => Promise<void> | void;
  onRequestDelete: (aliases: string[]) => void;
  onRequestPurge: (aliases: string[]) => void;
  onRequestAddPrimaryDomain?: (request?: {
    alias?: string;
    value?: string;
    kind?: "local" | "fqdn" | "subdomain";
    parentFqdn?: string;
    subLabel?: string;
    reason?: "missing" | "unknown";
  }) => void;
};
export function useServerCollectionActions({
  aliasCounts,
  aliasDrafts,
  setAliasDrafts,
  passwordConfirmDrafts,
  setPasswordConfirmDrafts,
  keyInputModeByAlias,
  setKeyInputModeByAlias,
  selectedAliases,
  setSelectedAliases,
  visibleAliases,
  paginatedServers,
  detailAlias,
  setDetailAlias,
  actionMenu,
  setActionMenu,
  setBulkMenu,
  statusPopover,
  setStatusPopover,
  primaryDomainMenu,
  setPrimaryDomainMenu,
  primaryDomainByLower,
  normalizedPrimaryDomainOptions,
  setDetailActionBusy,
  setDetailActionError,
  setDetailActionStatus,
  onAliasChange,
  onPatchServer,
  onOpenDetail,
  onGenerateKey,
  onCredentialFieldBlur,
  onRequestDelete,
  onRequestPurge,
  onRequestAddPrimaryDomain,
}: UseServerCollectionActionsProps) {
  const { getValidationState, getVisualState, statusDotClass } =
    useServerCollectionValidation({
      aliasCounts,
      aliasDrafts,
      passwordConfirmDrafts,
      primaryDomainByLower,
    });
  const resolvePrimaryDomainSelection = useCallback(
    (value: string) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) return null;
      return primaryDomainByLower.get(normalized) || null;
    },
    [primaryDomainByLower]
  );
  const patchPort = useCallback(
    (alias: string, value: string) => {
      onPatchServer(alias, { port: normalizePortValue(value) });
    },
    [onPatchServer]
  );
  const ensurePortDefault = useCallback(
    (alias: string, value: string) => {
      const normalized = normalizePortValue(value);
      onPatchServer(alias, { port: normalized || "22" });
    },
    [onPatchServer]
  );
  const syncAliasDraftState = useCallback(
    (fromAlias: string, toAlias: string) => {
      setAliasDrafts((prev) => {
        const next = { ...prev };
        delete next[fromAlias];
        next[toAlias] = toAlias;
        return next;
      });
      setPasswordConfirmDrafts((prev) => {
        const next = { ...prev };
        const previousConfirm = next[fromAlias] ?? "";
        delete next[fromAlias];
        next[toAlias] = previousConfirm;
        return next;
      });
      setDetailAlias((prev) => (prev === fromAlias ? toAlias : prev));
      setSelectedAliases((prev) => {
        if (!prev.has(fromAlias)) return prev;
        const next = new Set(prev);
        next.delete(fromAlias);
        next.add(toAlias);
        return next;
      });
      setActionMenu((prev) => {
        if (!prev || prev.alias !== fromAlias) return prev;
        return { ...prev, alias: toAlias };
      });
      setStatusPopover((prev) => {
        if (!prev || prev.alias !== fromAlias) return prev;
        return { ...prev, alias: toAlias };
      });
    },
    [
      setAliasDrafts,
      setPasswordConfirmDrafts,
      setDetailAlias,
      setSelectedAliases,
      setActionMenu,
      setStatusPopover,
    ]
  );
  const tryRenameAlias = useCallback(
    (server: ServerState, rawValue: string) => {
      const trimmed = String(rawValue ?? "").trim();
      const error = getAliasErrorFor(trimmed, server.alias, aliasCounts);
      if (error || trimmed === server.alias) return false;
      onAliasChange(server.alias, trimmed);
      syncAliasDraftState(server.alias, trimmed);
      return true;
    },
    [aliasCounts, onAliasChange, syncAliasDraftState]
  );
  const commitAlias = useCallback(
    (server: ServerState) => {
      const draft = String(aliasDrafts[server.alias] ?? server.alias);
      if (tryRenameAlias(server, draft)) return;
      const trimmed = draft.trim();
      setAliasDrafts((prev) => ({
        ...prev,
        [server.alias]: trimmed || server.alias,
      }));
    },
    [aliasDrafts, setAliasDrafts, tryRenameAlias]
  );
  const onAliasTyping = useCallback(
    (server: ServerState, value: string) => {
      setAliasDrafts((prev) => ({ ...prev, [server.alias]: value }));
    },
    [setAliasDrafts]
  );
  const updateAuthMethod = useCallback(
    (server: ServerState, method: "password" | "private_key") => {
      setPasswordConfirmDrafts((prev) => ({
        ...prev,
        [server.alias]: "",
      }));
      if (method === "password") {
        onPatchServer(server.alias, {
          authMethod: method,
          privateKey: "",
          publicKey: "",
        });
        return;
      }
      onPatchServer(server.alias, {
        authMethod: method,
        password: "",
      });
    },
    [onPatchServer, setPasswordConfirmDrafts]
  );
  const toggleAliasSelection = useCallback(
    (alias: string, checked: boolean) => {
      setSelectedAliases((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(alias);
        } else {
          next.delete(alias);
        }
        return next;
      });
    },
    [setSelectedAliases]
  );
  const toggleSelectAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedAliases((prev) => {
        const next = new Set(prev);
        if (checked) {
          visibleAliases.forEach((alias) => next.add(alias));
        } else {
          visibleAliases.forEach((alias) => next.delete(alias));
        }
        return next;
      });
    },
    [setSelectedAliases, visibleAliases]
  );
  const openDetailModal = useCallback(
    (alias: string) => {
      onOpenDetail(alias);
      setDetailAlias(alias);
      setActionMenu(null);
      setBulkMenu(null);
    },
    [onOpenDetail, setDetailAlias, setActionMenu, setBulkMenu]
  );
  const openActionMenuFor = useCallback(
    (alias: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const width = 220;
      setActionMenu({
        alias,
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - width),
      });
      setBulkMenu(null);
    },
    [setActionMenu, setBulkMenu]
  );
  const openBulkMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const width = 230;
      setBulkMenu({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - width),
      });
      setActionMenu(null);
    },
    [setBulkMenu, setActionMenu]
  );
  const runBulkAction = useCallback(
    (mode: "delete" | "purge") => {
      const aliases = Array.from(selectedAliases);
      if (aliases.length === 0) return;
      if (mode === "purge") {
        onRequestPurge(aliases);
      } else {
        onRequestDelete(aliases);
      }
      setSelectedAliases(new Set());
      setBulkMenu(null);
    },
    [onRequestDelete, onRequestPurge, selectedAliases, setBulkMenu, setSelectedAliases]
  );
  const openStatusPopoverFor = useCallback(
    (
      alias: string,
      indicator: StatusIndicator,
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>
    ) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setStatusPopover({
        alias,
        top: rect.bottom + 10,
        left: rect.left + rect.width / 2,
        label: indicator.label,
        tooltip: indicator.tooltip,
      });
    },
    [setStatusPopover]
  );
  const closeStatusPopoverFor = useCallback(
    (alias: string) => {
      setStatusPopover((prev) => {
        if (!prev || prev.alias !== alias) return prev;
        return null;
      });
    },
    [setStatusPopover]
  );
  const runDetailKeygen = useCallback(
    async (server: ServerState) => {
      setDetailActionError(null);
      setDetailActionStatus(null);
      setDetailActionBusy("keygen");
      try {
        await onGenerateKey(server.alias);
        setDetailActionStatus("SSH keypair generated.");
      } catch (err: any) {
        setDetailActionError(err?.message ?? "SSH key generation failed.");
      } finally {
        setDetailActionBusy(null);
      }
    },
    [onGenerateKey, setDetailActionBusy, setDetailActionError, setDetailActionStatus]
  );
  const emitCredentialBlur = useCallback(
    (
      server: ServerState,
      field: CredentialField,
      passwordConfirm?: string
    ) => {
      setDetailActionError(null);
      void Promise.resolve(
        onCredentialFieldBlur({
          server,
          field,
          passwordConfirm,
        })
      ).catch((err: any) => {
        setDetailActionError(err?.message ?? "Automatic credential sync failed.");
      });
    },
    [onCredentialFieldBlur, setDetailActionError]
  );
  const commitPrimaryDomain = useCallback(
    (server: ServerState, value?: string) => {
      const typed = String(value ?? server.primaryDomain ?? "").trim().toLowerCase();
      const resolved = resolvePrimaryDomainSelection(typed);
      if (!resolved) {
        onRequestAddPrimaryDomain?.({
          alias: server.alias,
          value: typed,
          kind: typed && !typed.includes(".") ? "local" : "fqdn",
          reason: typed ? "unknown" : "missing",
        });
        return;
      }
      if (resolved !== String(server.primaryDomain || "")) {
        onPatchServer(server.alias, { primaryDomain: resolved });
      }
      emitCredentialBlur({ ...server, primaryDomain: resolved }, "primaryDomain");
    },
    [emitCredentialBlur, onPatchServer, onRequestAddPrimaryDomain, resolvePrimaryDomainSelection]
  );
  const openPrimaryDomainMenuFor = useCallback(
    (alias: string, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      setPrimaryDomainMenu({
        alias,
        top: rect.bottom + 6,
        left: rect.left,
        width: Math.max(220, rect.width),
      });
    },
    [setPrimaryDomainMenu]
  );
  const activePrimaryDomainServer = useMemo(
    () =>
      primaryDomainMenu
        ? paginatedServers.find((server) => server.alias === primaryDomainMenu.alias) ||
          null
        : null,
    [paginatedServers, primaryDomainMenu]
  );
  const activePrimaryDomainOptions = useMemo(() => {
    const query = String(activePrimaryDomainServer?.primaryDomain || "")
      .trim()
      .toLowerCase();
    if (!query) return normalizedPrimaryDomainOptions;
    return normalizedPrimaryDomainOptions.filter((domain) =>
      domain.toLowerCase().includes(query)
    );
  }, [activePrimaryDomainServer, normalizedPrimaryDomainOptions]);
  const selectPrimaryDomainFromMenu = useCallback(
    (server: ServerState, domain: string) => {
      onPatchServer(server.alias, { primaryDomain: domain });
      emitCredentialBlur({ ...server, primaryDomain: domain }, "primaryDomain");
      setPrimaryDomainMenu(null);
    },
    [emitCredentialBlur, onPatchServer, setPrimaryDomainMenu]
  );
  const onPortFieldBlur = useCallback(
    (server: ServerState) => {
      const normalizedPort = normalizePortValue(server.port) || "22";
      ensurePortDefault(server.alias, server.port);
      emitCredentialBlur({ ...server, port: normalizedPort }, "port");
    },
    [emitCredentialBlur, ensurePortDefault]
  );
  const setKeyInputMode = useCallback(
    (alias: string, mode: "import" | "generate") => {
      setKeyInputModeByAlias((prev) => ({ ...prev, [alias]: mode }));
    },
    [setKeyInputModeByAlias]
  );
  const handlePrivateKeyUpload = useCallback(
    (server: ServerState, event: ReactChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "").replace(/\r\n/g, "\n");
        onPatchServer(server.alias, { privateKey: text });
        emitCredentialBlur({ ...server, privateKey: text }, "privateKey");
        setKeyInputMode(server.alias, "import");
      };
      reader.onerror = () => {
        setDetailActionError("Failed to read private key file.");
      };
      reader.readAsText(file);
    },
    [emitCredentialBlur, onPatchServer, setDetailActionError, setKeyInputMode]
  );
  return {
    getValidationState,
    getVisualState,
    statusDotClass,
    onAliasTyping,
    commitAlias,
    updateAuthMethod,
    toggleAliasSelection,
    toggleSelectAllVisible,
    openDetailModal,
    openActionMenuFor,
    openBulkMenu,
    runBulkAction,
    openStatusPopoverFor,
    closeStatusPopoverFor,
    runDetailKeygen,
    emitCredentialBlur,
    commitPrimaryDomain,
    openPrimaryDomainMenuFor,
    activePrimaryDomainServer,
    activePrimaryDomainOptions,
    selectPrimaryDomainFromMenu,
    patchPort,
    onPortFieldBlur,
    setKeyInputMode,
    handlePrivateKeyUpload,
  };
}
