import { useEffect } from "react";
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import {
  SW_QUERY_KEYS,
  isDeployTargetFilter,
  isReleaseTrack,
  parseCsvParam,
  parseFacetCsvParam,
  parseListColumnCsvParam,
  normalizeListColumnState,
  type SoftwareScope,
  type ReleaseTrack,
  type DeployTargetFilter,
} from "./dashboard-filters";
import type { BundleOptionalListColumnKey } from "./BundleGridView";
import type { OptionalListColumnKey } from "./RoleListView";
import { VIEW_MODES, type Bundle, type Role, type ViewMode } from "./types";

type UseRoleDashboardBootstrapParams = {
  baseUrl?: string;
  isExpertMode: boolean;
  releaseTrack: ReleaseTrack;
  setReleaseTrack: Dispatch<SetStateAction<ReleaseTrack>>;
  setSoftwareScope: Dispatch<SetStateAction<SoftwareScope>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setQueryDraft: Dispatch<SetStateAction<string>>;
  setTargetFilter: Dispatch<SetStateAction<DeployTargetFilter>>;
  setStatusFilter: Dispatch<SetStateAction<Set<string>>>;
  setCategoryFilter: Dispatch<SetStateAction<Set<string>>>;
  setTagFilter: Dispatch<SetStateAction<Set<string>>>;
  setShowSelectedOnly: Dispatch<SetStateAction<boolean>>;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  setRowsOverride: Dispatch<SetStateAction<number | null>>;
  setListForcedOpenColumns: Dispatch<SetStateAction<OptionalListColumnKey[]>>;
  setListForcedClosedColumns: Dispatch<SetStateAction<OptionalListColumnKey[]>>;
  setBundleListForcedOpenColumns: Dispatch<
    SetStateAction<BundleOptionalListColumnKey[]>
  >;
  setBundleListForcedClosedColumns: Dispatch<
    SetStateAction<BundleOptionalListColumnKey[]>
  >;
  optionalListColumns: readonly OptionalListColumnKey[];
  bundleOptionalListColumns: readonly BundleOptionalListColumnKey[];
  querySyncReadyRef: MutableRefObject<boolean>;
  activeVideo: { url: string; title: string } | null;
  setActiveVideo: Dispatch<SetStateAction<{ url: string; title: string } | null>>;
  activeDetails: { role: Role; alias: string } | null;
  setActiveDetails: Dispatch<SetStateAction<{ role: Role; alias: string } | null>>;
  setBundles: Dispatch<SetStateAction<Bundle[]>>;
  setBundlesLoading: Dispatch<SetStateAction<boolean>>;
  setBundlesError: Dispatch<SetStateAction<string | null>>;
  scrollRef: RefObject<HTMLDivElement>;
  controlsRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  setGridSize: Dispatch<SetStateAction<{ width: number; height: number }>>;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  filtersPopoverRef: RefObject<HTMLDivElement>;
  filtersButtonRef: RefObject<HTMLButtonElement>;
  viewMenuOpen: boolean;
  setViewMenuOpen: Dispatch<SetStateAction<boolean>>;
  viewPopoverRef: RefObject<HTMLDivElement>;
  viewButtonRef: RefObject<HTMLButtonElement>;
  softwareScope: SoftwareScope;
  query: string;
  targetFilter: DeployTargetFilter;
  statusFilter: Set<string>;
  categoryFilter: Set<string>;
  tagFilter: Set<string>;
  showSelectedOnly: boolean;
  viewMode: ViewMode;
  rowsOverride: number | null;
  listForcedOpenColumns: OptionalListColumnKey[];
  listForcedClosedColumns: OptionalListColumnKey[];
  bundleListForcedOpenColumns: BundleOptionalListColumnKey[];
  bundleListForcedClosedColumns: BundleOptionalListColumnKey[];
  editingRole: Role | null;
  setEditingRole: Dispatch<SetStateAction<Role | null>>;
};

export function useRoleDashboardBootstrap({
  baseUrl,
  isExpertMode,
  releaseTrack,
  setReleaseTrack,
  setSoftwareScope,
  setQuery,
  setQueryDraft,
  setTargetFilter,
  setStatusFilter,
  setCategoryFilter,
  setTagFilter,
  setShowSelectedOnly,
  setViewMode,
  setRowsOverride,
  setListForcedOpenColumns,
  setListForcedClosedColumns,
  setBundleListForcedOpenColumns,
  setBundleListForcedClosedColumns,
  optionalListColumns,
  bundleOptionalListColumns,
  querySyncReadyRef,
  activeVideo,
  setActiveVideo,
  activeDetails,
  setActiveDetails,
  setBundles,
  setBundlesLoading,
  setBundlesError,
  scrollRef,
  controlsRef,
  contentRef,
  setGridSize,
  filtersOpen,
  setFiltersOpen,
  filtersPopoverRef,
  filtersButtonRef,
  viewMenuOpen,
  setViewMenuOpen,
  viewPopoverRef,
  viewButtonRef,
  softwareScope,
  query,
  targetFilter,
  statusFilter,
  categoryFilter,
  tagFilter,
  showSelectedOnly,
  viewMode,
  rowsOverride,
  listForcedOpenColumns,
  listForcedClosedColumns,
  bundleListForcedOpenColumns,
  bundleListForcedClosedColumns,
  editingRole,
  setEditingRole,
}: UseRoleDashboardBootstrapParams) {
  useEffect(() => {
    if (querySyncReadyRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    const scopeParam = String(params.get(SW_QUERY_KEYS.scope) || "")
      .trim()
      .toLowerCase();
    if (scopeParam === "apps" || scopeParam === "bundles") {
      setSoftwareScope(scopeParam);
    }

    const trackParam = String(params.get(SW_QUERY_KEYS.track) || "")
      .trim()
      .toLowerCase();
    if (isReleaseTrack(trackParam)) {
      setReleaseTrack(trackParam);
    }

    const searchParam = params.get(SW_QUERY_KEYS.search);
    if (searchParam !== null) {
      setQuery(searchParam);
      setQueryDraft(searchParam);
    }

    const targetParam = String(params.get(SW_QUERY_KEYS.target) || "")
      .trim()
      .toLowerCase();
    if (isDeployTargetFilter(targetParam)) {
      setTargetFilter(targetParam);
    }

    const statusParam = params.get(SW_QUERY_KEYS.status);
    if (statusParam !== null) {
      setStatusFilter(new Set(parseCsvParam(statusParam)));
    }

    const categoriesParam = params.get(SW_QUERY_KEYS.categories);
    if (categoriesParam !== null) {
      setCategoryFilter(new Set(parseFacetCsvParam(categoriesParam)));
    }

    const tagsParam = params.get(SW_QUERY_KEYS.tags);
    if (tagsParam !== null) {
      setTagFilter(new Set(parseFacetCsvParam(tagsParam)));
    }

    const selectedParam = String(params.get(SW_QUERY_KEYS.selected) || "")
      .trim()
      .toLowerCase();
    if (selectedParam) {
      setShowSelectedOnly(selectedParam === "1" || selectedParam === "true");
    }

    const viewParam = String(params.get(SW_QUERY_KEYS.view) || "")
      .trim()
      .toLowerCase();
    if ((VIEW_MODES as readonly string[]).includes(viewParam)) {
      setViewMode(viewParam as ViewMode);
    }

    const rowsParam = String(params.get(SW_QUERY_KEYS.rows) || "")
      .trim()
      .toLowerCase();
    if (rowsParam) {
      if (rowsParam === "auto") {
        setRowsOverride(null);
      } else {
        const parsed = Number(rowsParam);
        setRowsOverride(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
      }
    }

    const listOpenParam = params.get(SW_QUERY_KEYS.listOpen);
    const listClosedParam = params.get(SW_QUERY_KEYS.listClosed);
    if (listOpenParam !== null || listClosedParam !== null) {
      const normalized = normalizeListColumnState(
        parseListColumnCsvParam(listOpenParam, optionalListColumns),
        parseListColumnCsvParam(listClosedParam, optionalListColumns),
        optionalListColumns
      );
      setListForcedOpenColumns(normalized.open);
      setListForcedClosedColumns(normalized.closed);
    }

    const bundleListOpenParam = params.get(SW_QUERY_KEYS.bundleListOpen);
    const bundleListClosedParam = params.get(SW_QUERY_KEYS.bundleListClosed);
    if (bundleListOpenParam !== null || bundleListClosedParam !== null) {
      const normalized = normalizeListColumnState(
        parseListColumnCsvParam(bundleListOpenParam, bundleOptionalListColumns),
        parseListColumnCsvParam(bundleListClosedParam, bundleOptionalListColumns),
        bundleOptionalListColumns
      );
      setBundleListForcedOpenColumns(normalized.open);
      setBundleListForcedClosedColumns(normalized.closed);
    }

    querySyncReadyRef.current = true;
  }, [
    bundleOptionalListColumns,
    optionalListColumns,
    querySyncReadyRef,
    setBundleListForcedClosedColumns,
    setBundleListForcedOpenColumns,
    setCategoryFilter,
    setListForcedClosedColumns,
    setListForcedOpenColumns,
    setQuery,
    setQueryDraft,
    setReleaseTrack,
    setRowsOverride,
    setShowSelectedOnly,
    setSoftwareScope,
    setStatusFilter,
    setTagFilter,
    setTargetFilter,
    setViewMode,
  ]);

  useEffect(() => {
    if (isExpertMode) return;
    if (releaseTrack === "stable") return;
    setReleaseTrack("stable");
  }, [isExpertMode, releaseTrack, setReleaseTrack]);

  useEffect(() => {
    if (!activeVideo) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveVideo(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [activeVideo, setActiveVideo]);

  useEffect(() => {
    if (!activeDetails) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveDetails(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [activeDetails, setActiveDetails]);

  useEffect(() => {
    const apiBase = String(baseUrl || "").trim();
    const endpoint = `${apiBase}/api/bundles`;
    let alive = true;
    const loadBundles = async () => {
      setBundlesLoading(true);
      setBundlesError(null);
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        setBundles(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!alive) return;
        setBundles([]);
        setBundlesError(err?.message ?? "failed to load bundles");
      } finally {
        if (alive) setBundlesLoading(false);
      }
    };
    void loadBundles();
    return () => {
      alive = false;
    };
  }, [baseUrl, setBundles, setBundlesError, setBundlesLoading]);

  useEffect(() => {
    const node = scrollRef.current;
    const contentNode = contentRef.current;
    if (!node && !contentNode) return;
    const toNumber = (value: string) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const update = () => {
      const currentContentNode = contentRef.current;
      if (currentContentNode) {
        const computed = window.getComputedStyle(currentContentNode);
        const horizontalPadding = toNumber(computed.paddingLeft) + toNumber(computed.paddingRight);
        const verticalPadding = toNumber(computed.paddingTop) + toNumber(computed.paddingBottom);
        setGridSize({
          width: Math.max(0, (currentContentNode.clientWidth || 0) - horizontalPadding),
          height: Math.max(0, (currentContentNode.clientHeight || 0) - verticalPadding),
        });
        return;
      }
      if (!node) return;
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
    if (node) observer.observe(node);
    if (controlsRef.current) observer.observe(controlsRef.current);
    if (contentNode) observer.observe(contentNode);
    return () => observer.disconnect();
  }, [contentRef, controlsRef, scrollRef, setGridSize]);

  useEffect(() => {
    if (!filtersOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filtersPopoverRef.current?.contains(target)) return;
      if (filtersButtonRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    const closeOnViewportChange = () => setFiltersOpen(false);

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [filtersOpen, filtersPopoverRef, filtersButtonRef, setFiltersOpen]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (viewPopoverRef.current?.contains(target)) return;
      if (viewButtonRef.current?.contains(target)) return;
      setViewMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [viewMenuOpen, viewPopoverRef, viewButtonRef, setViewMenuOpen]);

  useEffect(() => {
    setViewMenuOpen(false);
  }, [softwareScope, setViewMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!querySyncReadyRef.current) return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    params.set(SW_QUERY_KEYS.scope, softwareScope);
    params.set(SW_QUERY_KEYS.track, releaseTrack);
    params.set(SW_QUERY_KEYS.search, query);
    params.set(SW_QUERY_KEYS.target, targetFilter);
    params.set(
      SW_QUERY_KEYS.status,
      Array.from(statusFilter)
        .sort((a, b) => a.localeCompare(b))
        .join(",")
    );
    params.set(
      SW_QUERY_KEYS.categories,
      Array.from(categoryFilter)
        .sort((a, b) => a.localeCompare(b))
        .join(",")
    );
    params.set(
      SW_QUERY_KEYS.tags,
      Array.from(tagFilter)
        .sort((a, b) => a.localeCompare(b))
        .join(",")
    );
    params.set(SW_QUERY_KEYS.selected, showSelectedOnly ? "1" : "0");
    params.set(SW_QUERY_KEYS.view, viewMode);
    params.set(SW_QUERY_KEYS.rows, rowsOverride ? String(rowsOverride) : "auto");
    params.set(SW_QUERY_KEYS.listOpen, listForcedOpenColumns.join(","));
    params.set(SW_QUERY_KEYS.listClosed, listForcedClosedColumns.join(","));
    params.set(SW_QUERY_KEYS.bundleListOpen, bundleListForcedOpenColumns.join(","));
    params.set(SW_QUERY_KEYS.bundleListClosed, bundleListForcedClosedColumns.join(","));
    window.history.replaceState({}, "", url.toString());
  }, [
    softwareScope,
    releaseTrack,
    query,
    targetFilter,
    statusFilter,
    categoryFilter,
    tagFilter,
    showSelectedOnly,
    viewMode,
    rowsOverride,
    listForcedOpenColumns,
    listForcedClosedColumns,
    bundleListForcedOpenColumns,
    bundleListForcedClosedColumns,
    querySyncReadyRef,
  ]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editingRole) {
        setEditingRole(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [editingRole, setEditingRole]);
}
