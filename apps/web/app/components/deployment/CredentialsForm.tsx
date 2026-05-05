"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./CredentialsForm.module.css";
import DeploymentCredentialsFormTemplate from "../deployment-credentials/form/Template";
import {
  HW_QUERY_KEYS,
  LANE_SERVER_VIEW_MODES,
  LIST_LIKE_SERVER_VIEW_MODES,
  ROW_FILTER_OPTIONS,
  SERVER_VIEW_MODE_SET,
  SINGLE_COLUMN_SERVER_VIEW_MODES,
} from "../deployment-credentials/form/constants";
import type { DeploymentCredentialsFormProps } from "../deployment-credentials/form/types";
import { SERVER_VIEW_CONFIG } from "../deployment-credentials/types";
import type {
  ServerState,
  ServerViewMode,
} from "../deployment-credentials/types";
import useCredentialServerActions from "../deployment-credentials/useCredentialServerActions";
import useCredentialViewMenus from "../deployment-credentials/useCredentialViewMenus";

export default function DeploymentCredentialsForm({
  baseUrl,
  workspaceId,
  servers,
  connectionResults,
  activeAlias,
  onActiveAliasChange,
  onUpdateServer,
  onConnectionResult,
  onRemoveServer,
  onCleanupServer,
  onAddServer,
  openCredentialsAlias = null,
  onOpenCredentialsAliasHandled,
  deviceMode,
  onDeviceModeChange,
  onOpenDetailSearch,
  primaryDomainOptions = [],
  onRequestAddPrimaryDomain,
  compact = false,
}: DeploymentCredentialsFormProps) {
  const Wrapper = compact ? "div" : "section";
  const wrapperClassName = compact
    ? styles.root
    : `${styles.root} ${styles.wrapper}`;

  const [requestedDetailAlias, setRequestedDetailAlias] = useState<string | null>(
    null
  );
  const [query, setQuery] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [viewMode, setViewMode] = useState<ServerViewMode>("list");
  const [rowsOverride, setRowsOverride] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const filtersButtonRef = useRef<HTMLButtonElement | null>(null);
  const filtersPopoverRef = useRef<HTMLDivElement | null>(null);
  const viewButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewPopoverRef = useRef<HTMLDivElement | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [listAutoMetrics, setListAutoMetrics] = useState({
    wrapHeight: 0,
    headHeight: 0,
    rowHeight: 0,
  });
  const [cardAutoRowHeight, setCardAutoRowHeight] = useState(0);
  const uiQueryReadyRef = useRef(false);

  useEffect(() => {
    if (!openCredentialsAlias) return;
    if (!servers.some((server) => server.alias === openCredentialsAlias)) {
      onOpenCredentialsAliasHandled?.();
      return;
    }
    setQuery("");
    setQueryDraft("");
    setPage(1);
    setRequestedDetailAlias(openCredentialsAlias);
    if (activeAlias !== openCredentialsAlias) {
      onActiveAliasChange(openCredentialsAlias);
    }
    onOpenCredentialsAliasHandled?.();
  }, [
    activeAlias,
    onActiveAliasChange,
    onOpenCredentialsAliasHandled,
    openCredentialsAlias,
    servers,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const rawView = String(params.get(HW_QUERY_KEYS.view) || "")
      .trim()
      .toLowerCase();
    const normalizedView = rawView === "selection" ? "detail" : rawView;
    if (SERVER_VIEW_MODE_SET.has(normalizedView as ServerViewMode)) {
      setViewMode(normalizedView as ServerViewMode);
    }

    const rowsParam = String(params.get(HW_QUERY_KEYS.rows) || "")
      .trim()
      .toLowerCase();
    if (rowsParam) {
      if (rowsParam === "auto") {
        setRowsOverride(null);
      } else {
        const parsed = Number(rowsParam);
        if (Number.isFinite(parsed) && parsed > 0) {
          setRowsOverride(Math.floor(parsed));
        }
      }
    }
    uiQueryReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!uiQueryReadyRef.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set(HW_QUERY_KEYS.view, viewMode);
    url.searchParams.set(HW_QUERY_KEYS.rows, rowsOverride ? String(rowsOverride) : "auto");
    window.history.replaceState({}, "", url.toString());
  }, [viewMode, rowsOverride]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => {
      const controlsHeight = controlsRef.current?.clientHeight ?? 0;
      setGridSize({
        width: node.clientWidth || 0,
        height: Math.max(0, (node.clientHeight || 0) - controlsHeight),
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    if (controlsRef.current) observer.observe(controlsRef.current);
    return () => observer.disconnect();
  }, []);

  const aliasCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    servers.forEach((server) => {
      const key = (server.alias || "").trim();
      if (!key) return;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [servers]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredServers = useMemo(() => {
    if (!normalizedQuery) return servers;
    return servers.filter((server) => {
      const haystack = [
        server.alias,
        server.description,
        server.host,
        server.user,
        server.port,
        server.color,
        server.logoEmoji,
        server.authMethod,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(normalizedQuery);
    });
  }, [servers, normalizedQuery]);

  const viewConfig = SERVER_VIEW_CONFIG[viewMode];
  const gridGap = 16;
  const isSingleColumnView = SINGLE_COLUMN_SERVER_VIEW_MODES.has(viewMode);
  const isListLikeView = LIST_LIKE_SERVER_VIEW_MODES.has(viewMode);
  const isLaneView = LANE_SERVER_VIEW_MODES.has(viewMode);
  const computedColumns =
    isSingleColumnView
      ? 1
      : Math.max(
          1,
          Math.floor((gridSize.width + gridGap) / (viewConfig.minWidth + gridGap))
        );
  const laneGap = 14;
  const contentHeightBuffer = viewMode === "mini" ? 24 : 8;
  const computedRows = useMemo(() => {
    if (isListLikeView) {
      const wrapHeight = listAutoMetrics.wrapHeight || Math.max(0, gridSize.height);
      const headHeight = listAutoMetrics.headHeight || 44;
      const rowHeight = listAutoMetrics.rowHeight || viewConfig.minHeight;
      const safetyPx = 2;
      const bodyHeight = Math.max(0, wrapHeight - headHeight);
      return Math.max(
        1,
        Math.floor(Math.max(0, bodyHeight - safetyPx) / Math.max(1, rowHeight))
      );
    }
    if (isLaneView) {
      const laneMinSize = viewMode === "row" ? 188 : 220;
      const rowAxisSize = viewMode === "column" ? gridSize.width : gridSize.height;
      return Math.max(
        1,
        Math.floor(
          (Math.max(0, rowAxisSize) + laneGap) / (laneMinSize + laneGap)
        )
      );
    }
    const measuredCardHeight = cardAutoRowHeight || viewConfig.minHeight;
    const safetyPx = 2;
    return Math.max(
      1,
      Math.floor(
        (Math.max(0, gridSize.height - contentHeightBuffer - safetyPx) + gridGap) /
          (measuredCardHeight + gridGap)
      )
    );
  }, [
    isListLikeView,
    isLaneView,
    listAutoMetrics.wrapHeight,
    listAutoMetrics.headHeight,
    listAutoMetrics.rowHeight,
    cardAutoRowHeight,
    viewMode,
    gridSize.width,
    gridSize.height,
    laneGap,
    viewConfig.minHeight,
    contentHeightBuffer,
  ]);
  const rows = Math.max(1, rowsOverride ?? computedRows);
  const laneCount = Math.max(1, rows);
  const laneGapTotal = Math.max(0, laneGap * (laneCount - 1));
  const rowLaneSize = Math.max(
    188,
    Math.floor(Math.max(0, gridSize.height - laneGapTotal) / laneCount)
  );
  const columnLaneSize = Math.max(
    220,
    Math.floor(Math.max(0, gridSize.width - laneGapTotal) / laneCount)
  );
  const laneSize = viewMode === "row" ? rowLaneSize : columnLaneSize;
  const pageSize = Math.max(1, computedColumns * rows);
  const rowOptions = useMemo(() => {
    const maxRows = Math.max(
      1,
      Math.ceil(filteredServers.length / Math.max(1, computedColumns))
    );
    const next = ROW_FILTER_OPTIONS.filter((value) => value <= maxRows);
    if (rowsOverride && !next.includes(rowsOverride)) {
      next.push(rowsOverride);
    }
    return next.sort((a, b) => a - b);
  }, [filteredServers.length, computedColumns, rowsOverride]);

  const {
    applySearch,
    handleQueryDraftChange,
    filtersOpen,
    toggleFilters,
    viewMenuOpen,
    toggleViewMenu,
    selectViewMode,
    filtersOverlay,
  } = useCredentialViewMenus({
    query,
    setQuery,
    queryDraft,
    setQueryDraft,
    computedRows,
    rowOptions,
    rowsOverride,
    setRowsOverride,
    viewMode,
    setViewMode,
    setPage,
    filtersButtonRef,
    filtersPopoverRef,
    viewButtonRef,
    viewPopoverRef,
  });

  const pageCount = Math.max(1, Math.ceil(filteredServers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedServers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredServers.slice(start, start + pageSize);
  }, [filteredServers, currentPage, pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isListLikeView) return;
    const container = contentRef.current;
    if (!container) return;

    const measure = () => {
      const wrap = container.querySelector<HTMLElement>("[data-server-list-wrap]");
      if (!wrap) return;
      const head = wrap.querySelector<HTMLElement>("thead");
      const rows = Array.from(wrap.querySelectorAll<HTMLElement>("tbody tr"));
      const rowHeight = rows.reduce(
        (max, row) => Math.max(max, row.getBoundingClientRect().height),
        0
      );
      const next = {
        wrapHeight: wrap.clientHeight || 0,
        headHeight: head ? head.getBoundingClientRect().height : 0,
        rowHeight,
      };
      setListAutoMetrics((prev) => {
        if (
          Math.abs(prev.wrapHeight - next.wrapHeight) < 1 &&
          Math.abs(prev.headHeight - next.headHeight) < 1 &&
          Math.abs(prev.rowHeight - next.rowHeight) < 1
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();
    const raf = window.requestAnimationFrame(measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure());
      observer.observe(container);
      const wrap = container.querySelector<HTMLElement>("[data-server-list-wrap]");
      if (wrap) {
        observer.observe(wrap);
        const table = wrap.querySelector<HTMLElement>("table");
        const head = wrap.querySelector<HTMLElement>("thead");
        if (table) observer.observe(table);
        if (head) observer.observe(head);
      }
    } else {
      window.addEventListener("resize", measure);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      if (!observer) {
        window.removeEventListener("resize", measure);
      }
    };
  }, [isListLikeView, filteredServers.length, currentPage, deviceMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isListLikeView || isLaneView) return;
    const container = contentRef.current;
    if (!container) return;

    const measure = () => {
      const cards = Array.from(
        container.querySelectorAll<HTMLElement>("[data-server-card]")
      );
      const next = cards.reduce(
        (max, card) => Math.max(max, card.getBoundingClientRect().height),
        0
      );
      setCardAutoRowHeight((prev) => {
        if (Math.abs(prev - next) < 1) return prev;
        return next;
      });
    };

    measure();
    const raf = window.requestAnimationFrame(measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure());
      observer.observe(container);
    } else {
      window.addEventListener("resize", measure);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      if (!observer) {
        window.removeEventListener("resize", measure);
      }
    };
  }, [isListLikeView, isLaneView, filteredServers.length, currentPage, deviceMode]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const updateServer = (alias: string, patch: Partial<ServerState>) => {
    onUpdateServer(alias, patch);
  };

  const addServerFromSearch = () => {
    onAddServer();
  };

  const handleAliasChange = (alias: string, nextAlias: string) => {
    updateServer(alias, { alias: nextAlias });
  };

  const openDetailViewForAlias = (alias: string) => {
    if (alias && activeAlias !== alias) {
      onActiveAliasChange(alias);
    }
    setRequestedDetailAlias(alias || null);
  };

  const {
    pendingAction,
    actionBusy,
    actionError,
    generateServerKey,
    handleCredentialFieldBlur,
    requestDeleteServers,
    requestPurgeServers,
    confirmServerAction,
    handleCancelAction,
  } = useCredentialServerActions({
    baseUrl,
    workspaceId,
    servers,
    onConnectionResult,
    onUpdateServer,
    onRemoveServer,
    onCleanupServer,
  });

  return (
    <DeploymentCredentialsFormTemplate
      compact={compact}
      baseUrl={baseUrl}
      wrapperTag={Wrapper}
      wrapperClassName={wrapperClassName}
      scrollRef={scrollRef}
      controlsRef={controlsRef}
      contentRef={contentRef}
      filtersButtonRef={filtersButtonRef}
      viewButtonRef={viewButtonRef}
      viewPopoverRef={viewPopoverRef}
      queryDraft={queryDraft}
      onQueryDraftChange={handleQueryDraftChange}
      onApplySearch={applySearch}
      filtersOpen={filtersOpen}
      onToggleFilters={toggleFilters}
      onAddServer={addServerFromSearch}
      deviceMode={deviceMode}
      onDeviceModeChange={onDeviceModeChange}
      viewMode={viewMode}
      viewMenuOpen={viewMenuOpen}
      onToggleViewMenu={toggleViewMenu}
      onSelectViewMode={selectViewMode}
      paginatedServers={paginatedServers}
      computedColumns={computedColumns}
      laneCount={laneCount}
      laneSize={laneSize}
      aliasCounts={aliasCounts}
      connectionResults={connectionResults}
      workspaceId={workspaceId}
      onAliasChange={handleAliasChange}
      onPatchServer={updateServer}
      onOpenDetail={openDetailViewForAlias}
      onGenerateKey={generateServerKey}
      onCredentialFieldBlur={handleCredentialFieldBlur}
      onRequestDelete={requestDeleteServers}
      onRequestPurge={requestPurgeServers}
      requestedDetailAlias={requestedDetailAlias}
      onRequestedDetailAliasHandled={() => setRequestedDetailAlias(null)}
      onOpenDetailSearch={onOpenDetailSearch}
      primaryDomainOptions={primaryDomainOptions}
      onRequestAddPrimaryDomain={onRequestAddPrimaryDomain}
      currentPage={currentPage}
      pageCount={pageCount}
      onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
      onNextPage={() => setPage((prev) => Math.min(pageCount, prev + 1))}
      pendingAction={pendingAction}
      actionBusy={actionBusy}
      actionError={actionError}
      onCancelAction={handleCancelAction}
      onConfirmAction={() => {
        void confirmServerAction();
      }}
      filtersOverlay={filtersOverlay}
    />
  );
}
