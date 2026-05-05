"use client";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { SERVER_VIEW_CONFIG } from "../types";
import styles from "../styles.module.css";
import { normalizeDeviceColor } from "../device-visuals";
import type {
  OverlayMenu,
  PrimaryDomainMenu,
  ServerCollectionViewProps,
  StatusPopover,
} from "./View.types";
import {
  MOTION_LOOP_SEGMENTS,
  buildMotionLanes,
  getStatusIndicator,
  getTintStyle,
} from "./View.utils";
import { renderServerMotionMode } from "./MotionMode";
import { renderServerListMode } from "./ListMode";
import { renderServerCardMode } from "./CardMode";
import { useServerCollectionActions } from "../useServerCollectionActions";
import { renderServerCollectionDetailModal } from "./DetailModal";
import { renderServerCollectionOverlays } from "./Overlays";
import { buildServerCollectionCells } from "./Cells";
export default function ServerCollectionView({
  viewMode,
  deviceMode = "customer",
  onOpenDetailSearch,
  paginatedServers,
  computedColumns,
  laneCount = 1,
  laneSize = 220,
  aliasCounts,
  testResults,
  workspaceId,
  onAliasChange,
  onPatchServer,
  onOpenDetail,
  onGenerateKey,
  onCredentialFieldBlur,
  onRequestDelete,
  onRequestPurge,
  requestedDetailAlias = null,
  onRequestedDetailAliasHandled,
  primaryDomainOptions = [],
  onRequestAddPrimaryDomain,
}: ServerCollectionViewProps) {
  const viewConfig = SERVER_VIEW_CONFIG[viewMode];
  const isCustomerMode = deviceMode === "customer";
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [passwordConfirmDrafts, setPasswordConfirmDrafts] = useState<
    Record<string, string>
  >({});
  const [openEmojiAlias, setOpenEmojiAlias] = useState<string | null>(null);
  const [detailAlias, setDetailAlias] = useState<string | null>(null);
  const [selectedAliases, setSelectedAliases] = useState<Set<string>>(new Set());
  const [actionMenu, setActionMenu] = useState<OverlayMenu | null>(null);
  const [bulkMenu, setBulkMenu] = useState<{ top: number; left: number } | null>(
    null
  );
  const [statusPopover, setStatusPopover] = useState<StatusPopover | null>(null);
  const [primaryDomainMenu, setPrimaryDomainMenu] = useState<PrimaryDomainMenu | null>(
    null
  );
  const [detailActionBusy, setDetailActionBusy] = useState<"keygen" | null>(null);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [detailActionStatus, setDetailActionStatus] = useState<string | null>(null);
  const [keyInputModeByAlias, setKeyInputModeByAlias] = useState<
    Record<string, "import" | "generate">
  >({});
  const normalizedPrimaryDomainOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    (Array.isArray(primaryDomainOptions) ? primaryDomainOptions : []).forEach((entry) => {
      const value = String(entry || "").trim().toLowerCase();
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push(value);
    });
    if (!seen.has("localhost")) {
      out.unshift("localhost");
    }
    return out;
  }, [primaryDomainOptions]);
  const primaryDomainByLower = useMemo(
    () =>
      new Map(
        normalizedPrimaryDomainOptions.map((value) => [value.toLowerCase(), value])
      ),
    [normalizedPrimaryDomainOptions]
  );
  useEffect(() => {
    setAliasDrafts((prev) => {
      const next: Record<string, string> = {};
      paginatedServers.forEach((server) => {
        next[server.alias] = prev[server.alias] ?? server.alias;
      });
      return next;
    });
    setPasswordConfirmDrafts((prev) => {
      const next: Record<string, string> = {};
      paginatedServers.forEach((server) => {
        next[server.alias] = prev[server.alias] ?? "";
      });
      return next;
    });
    setKeyInputModeByAlias((prev) => {
      const next: Record<string, "import" | "generate"> = {};
      paginatedServers.forEach((server) => {
        next[server.alias] = prev[server.alias] ?? "import";
      });
      return next;
    });
    const aliases = new Set(paginatedServers.map((server) => server.alias));
    setSelectedAliases((prev) => {
      const next = new Set<string>();
      prev.forEach((alias) => {
        if (aliases.has(alias)) next.add(alias);
      });
      return next;
    });
    if (openEmojiAlias && !aliases.has(openEmojiAlias)) {
      setOpenEmojiAlias(null);
    }
    if (detailAlias && !aliases.has(detailAlias)) {
      setDetailAlias(null);
    }
    if (actionMenu && !aliases.has(actionMenu.alias)) {
      setActionMenu(null);
    }
    if (statusPopover && !aliases.has(statusPopover.alias)) {
      setStatusPopover(null);
    }
    if (primaryDomainMenu && !aliases.has(primaryDomainMenu.alias)) {
      setPrimaryDomainMenu(null);
    }
  }, [
    paginatedServers,
    openEmojiAlias,
    detailAlias,
    actionMenu,
    statusPopover,
    primaryDomainMenu,
  ]);
  useEffect(() => {
    setDetailActionError(null);
    setDetailActionStatus(null);
    setDetailActionBusy(null);
  }, [detailAlias]);
  useEffect(() => {
    if (!requestedDetailAlias) return;
    if (isCustomerMode) {
      setDetailAlias(null);
      onRequestedDetailAliasHandled?.();
      return;
    }
    const exists = paginatedServers.some(
      (server) => server.alias === requestedDetailAlias
    );
    if (exists) {
      setDetailAlias(requestedDetailAlias);
    }
    onRequestedDetailAliasHandled?.();
  }, [
    requestedDetailAlias,
    paginatedServers,
    onRequestedDetailAliasHandled,
    isCustomerMode,
  ]);
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const inPickerShell = Boolean(
        (target as HTMLElement).closest(`.${styles.emojiPickerShell}`)
      );
      if (!inPickerShell) {
        setOpenEmojiAlias(null);
      }
      const inActionPortal = Boolean(
        (target as HTMLElement).closest(`.${styles.actionOverlayMenu}`)
      );
      const inActionTrigger = Boolean(
        (target as HTMLElement).closest(`.${styles.actionMenuTrigger}`)
      );
      if (!inActionPortal && !inActionTrigger) {
        setActionMenu(null);
      }
      const inBulkPortal = Boolean(
        (target as HTMLElement).closest(`.${styles.bulkOverlayMenu}`)
      );
      const inBulkTrigger = Boolean(
        (target as HTMLElement).closest(`.${styles.bulkActionTrigger}`)
      );
      if (!inBulkPortal && !inBulkTrigger) {
        setBulkMenu(null);
      }
      const inPrimaryDomainMenu = Boolean(
        (target as HTMLElement).closest(`.${styles.primaryDomainDropdown}`)
      );
      const inPrimaryDomainTrigger = Boolean(
        (target as HTMLElement).closest(`.${styles.primaryDomainDropdownTrigger}`)
      );
      if (!inPrimaryDomainMenu && !inPrimaryDomainTrigger) {
        setPrimaryDomainMenu(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenEmojiAlias(null);
      setActionMenu(null);
      setBulkMenu(null);
      setStatusPopover(null);
      setPrimaryDomainMenu(null);
      setDetailAlias(null);
    };
    const closeFloatingOverlays = () => {
      setActionMenu(null);
      setBulkMenu(null);
      setStatusPopover(null);
      setPrimaryDomainMenu(null);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeFloatingOverlays);
    window.addEventListener("scroll", closeFloatingOverlays, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeFloatingOverlays);
      window.removeEventListener("scroll", closeFloatingOverlays, true);
    };
  }, []);
  const visibleAliases = useMemo(
    () =>
      paginatedServers
        .map((server) => String(server.alias || "").trim())
        .filter(Boolean),
    [paginatedServers]
  );
  const selectedCount = selectedAliases.size;
  const selectedVisibleCount = visibleAliases.filter((alias) =>
    selectedAliases.has(alias)
  ).length;
  const allVisibleSelected =
    visibleAliases.length > 0 && selectedVisibleCount === visibleAliases.length;
  const detailServer = useMemo(
    () =>
      detailAlias
        ? paginatedServers.find((server) => server.alias === detailAlias) ?? null
        : null,
    [detailAlias, paginatedServers]
  );
  const {
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
  } = useServerCollectionActions({
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
  });
  const { renderStatusCell, renderActionCell } = buildServerCollectionCells({
    actionMenu,
    setActionMenu,
    openDetailModal,
    openActionMenuFor,
    openStatusPopoverFor,
    closeStatusPopoverFor,
    statusDotClass,
  });
  const gridStyle = {
    "--server-grid-columns": computedColumns,
  } as CSSProperties;
  const {
    actionMenuOverlay,
    bulkMenuOverlay,
    statusPopoverOverlay,
    primaryDomainMenuOverlay,
  } = renderServerCollectionOverlays({
    actionMenu,
    setActionMenu,
    bulkMenu,
    selectedCount,
    runBulkAction,
    statusPopover,
    primaryDomainMenu,
    setPrimaryDomainMenu,
    activePrimaryDomainServer,
    activePrimaryDomainOptions,
    selectPrimaryDomainFromMenu,
    onRequestDelete,
    onRequestPurge,
    onRequestAddPrimaryDomain,
  });
  const detailValidation = detailServer
    ? getValidationState(detailServer, { enforcePasswordConfirm: true })
    : null;
  const detailIndicator =
    detailServer && detailValidation
      ? getStatusIndicator(detailValidation, testResults[detailServer.alias])
      : null;
  const detailConnectionResult = detailServer
    ? testResults[detailServer.alias]
    : undefined;
  const detailModal = renderServerCollectionDetailModal({
    isCustomerMode,
    detailServer,
    detailValidation,
    detailIndicator,
    detailConnectionResult,
    detailActionBusy,
    detailActionError,
    detailActionStatus,
    aliasDrafts,
    passwordConfirmDrafts,
    setPasswordConfirmDrafts,
    keyInputModeByAlias,
    workspaceId,
    openEmojiAlias,
    setOpenEmojiAlias,
    setDetailAlias,
    onPatchServer,
    onAliasTyping,
    commitAlias,
    openPrimaryDomainMenuFor,
    commitPrimaryDomain,
    emitCredentialBlur,
    patchPort,
    onPortFieldBlur,
    updateAuthMethod,
    setKeyInputMode,
    handlePrivateKeyUpload,
    runDetailKeygen,
    onRequestDelete,
    onRequestPurge,
    openStatusPopoverFor,
    closeStatusPopoverFor,
    statusDotClass,
    Picker,
    data,
  });
  if (viewMode === "row" || viewMode === "column") {
    return renderServerMotionMode({
      styles,
      viewMode,
      paginatedServers,
      laneCount,
      laneSize,
      buildMotionLanes,
      MOTION_LOOP_SEGMENTS,
      getValidationState,
      getStatusIndicator,
      testResults,
      getVisualState,
      getTintStyle,
      statusDotClass,
      isCustomerMode,
      openDetailModal,
      onOpenDetailSearch,
      detailModal,
    });
  }
  if (viewMode === "list" || viewMode === "matrix") {
    return renderServerListMode({
      styles,
      isCustomerMode,
      paginatedServers,
      getValidationState,
      aliasDrafts,
      normalizeDeviceColor,
      openEmojiAlias,
      setOpenEmojiAlias,
      Picker,
      data,
      onPatchServer,
      onAliasTyping,
      commitAlias,
      onOpenDetailSearch,
      bulkMenu,
      setBulkMenu,
      openBulkMenu,
      selectedCount,
      allVisibleSelected,
      toggleSelectAllVisible,
      getStatusIndicator,
      testResults,
      getVisualState,
      getTintStyle,
      selectedAliases,
      toggleAliasSelection,
      emitCredentialBlur,
      patchPort,
      onPortFieldBlur,
      openPrimaryDomainMenuFor,
      commitPrimaryDomain,
      renderStatusCell,
      renderActionCell,
      actionMenuOverlay,
      bulkMenuOverlay,
      statusPopoverOverlay,
      primaryDomainMenuOverlay,
      detailModal,
    });
  }
  return renderServerCardMode({
    styles,
    isCustomerMode,
    gridStyle,
    paginatedServers,
    viewConfig,
    aliasDrafts,
    getValidationState,
    getStatusIndicator,
    getVisualState,
    getTintStyle,
    normalizeDeviceColor,
    onPatchServer,
    openEmojiAlias,
    setOpenEmojiAlias,
    Picker,
    data,
    onAliasTyping,
    commitAlias,
    emitCredentialBlur,
    patchPort,
    onPortFieldBlur,
    openPrimaryDomainMenuFor,
    commitPrimaryDomain,
    renderActionCell,
    onOpenDetailSearch,
    actionMenuOverlay,
    bulkMenuOverlay,
    statusPopoverOverlay,
    primaryDomainMenuOverlay,
    detailModal,
    testResults,
    statusDotClass,
  });
}
