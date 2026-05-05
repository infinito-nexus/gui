"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import YAML from "yaml";
import { normalizePersistedDeviceMeta } from "../../lib/device_meta";
import type { ServerState } from "../deployment-credentials/types";
import {
  DEFAULT_PRIMARY_DOMAIN,
  GROUP_VARS_ALL_PATH,
  GROUP_VARS_DOMAIN_CATALOG_KEY,
  buildDomainCatalogPayload,
  createDefaultDomainEntries,
  fetchDomainAvailability,
  isLikelyFqdn,
  normalizeDomainName,
  normalizePrimaryDomainSelection,
  parseDomainCatalogFromGroupVars,
  readPrimaryDomainFromGroupVars,
} from "./domain-utils";
import { encodeWorkspacePath, parseYamlMapping } from "./helpers";
import { useWorkspaceDomainPopup } from "./useWorkspaceDomainPopup";
import type {
  DomainEntry,
  DomainFilterKind,
  DomainKind,
} from "./types";

type UseWorkspaceDomainLogicProps = {
  baseUrl: string;
  workspaceId: string | null;
  servers: ServerState[];
  setServers: Dispatch<SetStateAction<ServerState[]>>;
  workspacePrimaryDomain: string;
  setWorkspacePrimaryDomain: Dispatch<SetStateAction<string>>;
  primaryDomainDraft: string;
  setPrimaryDomainDraft: Dispatch<SetStateAction<string>>;
  setPrimaryDomainModalError: Dispatch<SetStateAction<string | null>>;
  setPrimaryDomainModalSaving: Dispatch<SetStateAction<boolean>>;
  domainEntries: DomainEntry[];
  setDomainEntries: Dispatch<SetStateAction<DomainEntry[]>>;
  domainFilterQuery: string;
  domainFilterKind: DomainFilterKind;
  domainPopupType: DomainKind;
  setDomainPopupType: Dispatch<SetStateAction<DomainKind>>;
  domainPopupFqdnValue: string;
  setDomainPopupFqdnValue: Dispatch<SetStateAction<string>>;
  setDomainPopupOpen: Dispatch<SetStateAction<boolean>>;
  setDomainPopupError: Dispatch<SetStateAction<string | null>>;
  setDomainPopupFqdnCheckBusy: Dispatch<SetStateAction<boolean>>;
  setDomainPopupFqdnCheckResult: Dispatch<
    SetStateAction<{ available: boolean; note: string } | null>
  >;
  domainPopupLocalValue: string;
  setDomainPopupLocalValue: Dispatch<SetStateAction<string>>;
  domainPopupSubLabel: string;
  setDomainPopupSubLabel: Dispatch<SetStateAction<string>>;
  domainPopupParentFqdn: string;
  setDomainPopupParentFqdn: Dispatch<SetStateAction<string>>;
  setDomainPopupPrompt: Dispatch<SetStateAction<string | null>>;
  domainPopupTargetAlias: string | null;
  setDomainPopupTargetAlias: Dispatch<SetStateAction<string | null>>;
};

export function useWorkspaceDomainLogic({
  baseUrl,
  workspaceId,
  servers,
  setServers,
  workspacePrimaryDomain,
  setWorkspacePrimaryDomain,
  primaryDomainDraft,
  setPrimaryDomainDraft,
  setPrimaryDomainModalError,
  setPrimaryDomainModalSaving,
  domainEntries,
  setDomainEntries,
  domainFilterQuery,
  domainFilterKind,
  domainPopupType,
  setDomainPopupType,
  domainPopupFqdnValue,
  setDomainPopupFqdnValue,
  setDomainPopupOpen,
  setDomainPopupError,
  setDomainPopupFqdnCheckBusy,
  setDomainPopupFqdnCheckResult,
  domainPopupLocalValue,
  setDomainPopupLocalValue,
  domainPopupSubLabel,
  setDomainPopupSubLabel,
  domainPopupParentFqdn,
  setDomainPopupParentFqdn,
  setDomainPopupPrompt,
  domainPopupTargetAlias,
  setDomainPopupTargetAlias,
}: UseWorkspaceDomainLogicProps) {
  const readGroupVarsAll = useCallback(
    async (targetWorkspaceId: string): Promise<Record<string, unknown>> => {
      const path = encodeWorkspacePath(GROUP_VARS_ALL_PATH);
      const res = await fetch(
        `${baseUrl}/api/workspaces/${targetWorkspaceId}/files/${path}`,
        {
          cache: "no-store",
        }
      );
      if (res.status === 404) return {};
      if (!res.ok) {
        throw new Error(`Failed to read ${GROUP_VARS_ALL_PATH}: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { content?: unknown };
      try {
        return parseYamlMapping(String(data?.content ?? ""));
      } catch {
        throw new Error(`${GROUP_VARS_ALL_PATH} is not valid YAML.`);
      }
    },
    [baseUrl]
  );

  const writeGroupVarsAll = useCallback(
    async (targetWorkspaceId: string, data: Record<string, unknown>) => {
      const path = encodeWorkspacePath(GROUP_VARS_ALL_PATH);
      const res = await fetch(
        `${baseUrl}/api/workspaces/${targetWorkspaceId}/files/${path}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: YAML.stringify(data) }),
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to write ${GROUP_VARS_ALL_PATH}: HTTP ${res.status}`);
      }
    },
    [baseUrl]
  );

  const primaryDomainOptions = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    domainEntries.forEach((entry) => {
      const domain = normalizeDomainName(entry.domain);
      if (!domain || seen.has(domain)) return;
      seen.add(domain);
      out.push(entry.domain);
    });
    if (!seen.has(DEFAULT_PRIMARY_DOMAIN)) {
      out.unshift(DEFAULT_PRIMARY_DOMAIN);
    }
    return out;
  }, [domainEntries]);

  const fqdnDomainOptions = useMemo(
    () =>
      domainEntries
        .filter((entry) => entry.kind === "fqdn")
        .map((entry) => normalizeDomainName(entry.domain))
        .filter(Boolean),
    [domainEntries]
  );

  const devicesByDomain = useMemo(() => {
    // Maps domain → list of server aliases that have it as primary.
    // The Domain panel renders these as detachable chips and uses the
    // length to decide whether removal is allowed.
    const map = new Map<string, string[]>();
    servers.forEach((server) => {
      const value = normalizeDomainName(server.primaryDomain);
      if (!value) return;
      const alias = String(server.alias || "").trim();
      if (!alias) return;
      const existing = map.get(value);
      if (existing) {
        existing.push(alias);
      } else {
        map.set(value, [alias]);
      }
    });
    return map;
  }, [servers]);

  const filteredDomainEntries = useMemo(() => {
    const query = normalizeDomainName(domainFilterQuery);
    return domainEntries.filter((entry) => {
      if (domainFilterKind !== "all" && entry.kind !== domainFilterKind) {
        return false;
      }
      if (!query) return true;
      const parent = normalizeDomainName(entry.parentFqdn || "");
      return (
        entry.domain.includes(query) ||
        entry.kind.includes(query) ||
        parent.includes(query)
      );
    });
  }, [domainEntries, domainFilterKind, domainFilterQuery]);

  const persistWorkspaceDomainSettings = useCallback(
    async (options?: {
      entries?: DomainEntry[];
      primaryDomain?: string;
    }) => {
      const sourceEntries = Array.isArray(options?.entries)
        ? options.entries
        : domainEntries;
      const sourcePrimaryDomain =
        typeof options?.primaryDomain === "string"
          ? options.primaryDomain
          : primaryDomainDraft;
      const nextEntries = parseDomainCatalogFromGroupVars({
        [GROUP_VARS_DOMAIN_CATALOG_KEY]: buildDomainCatalogPayload(sourceEntries),
        DOMAIN_PRIMARY: sourcePrimaryDomain,
      });
      const nextDomain = normalizePrimaryDomainSelection(
        sourcePrimaryDomain,
        nextEntries
      );
      setPrimaryDomainModalSaving(true);
      setPrimaryDomainModalError(null);
      try {
        if (workspaceId) {
          const data = await readGroupVarsAll(workspaceId);
          const nextData = {
            ...data,
            DOMAIN_PRIMARY: nextDomain,
            [GROUP_VARS_DOMAIN_CATALOG_KEY]: buildDomainCatalogPayload(nextEntries),
          };
          await writeGroupVarsAll(workspaceId, nextData);
        }
        setDomainEntries(nextEntries);
        setWorkspacePrimaryDomain(nextDomain);
        setPrimaryDomainDraft(nextDomain);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : `Failed to write ${GROUP_VARS_ALL_PATH}.`;
        setPrimaryDomainModalError(message);
      } finally {
        setPrimaryDomainModalSaving(false);
      }
    },
    [
      workspaceId,
      domainEntries,
      primaryDomainDraft,
      readGroupVarsAll,
      setDomainEntries,
      setPrimaryDomainDraft,
      setPrimaryDomainModalError,
      setPrimaryDomainModalSaving,
      setWorkspacePrimaryDomain,
      writeGroupVarsAll,
    ]
  );

  const removeDomainEntry = useCallback(
    (domain: string) => {
      const targetDomain = normalizeDomainName(domain);
      if (!targetDomain || targetDomain === DEFAULT_PRIMARY_DOMAIN) {
        setPrimaryDomainModalError("localhost cannot be removed.");
        return;
      }
      const hasLinkedSubdomains = domainEntries.some(
        (entry) =>
          entry.kind === "subdomain" &&
          normalizeDomainName(entry.parentFqdn || "") === targetDomain
      );
      if (hasLinkedSubdomains) {
        setPrimaryDomainModalError(
          "Remove subdomains first. Each subdomain must belong to a FQDN."
        );
        return;
      }
      setPrimaryDomainModalError(null);
      const nextEntries = domainEntries.filter(
        (entry) => normalizeDomainName(entry.domain) !== targetDomain
      );
      const nextPrimaryDomain =
        normalizeDomainName(primaryDomainDraft) === targetDomain
          ? DEFAULT_PRIMARY_DOMAIN
          : primaryDomainDraft;
      void persistWorkspaceDomainSettings({
        entries: nextEntries,
        primaryDomain: nextPrimaryDomain,
      });
    },
    [
      domainEntries,
      persistWorkspaceDomainSettings,
      primaryDomainDraft,
      setPrimaryDomainModalError,
    ]
  );

  useEffect(() => {
    if (!workspaceId) {
      setDomainEntries(createDefaultDomainEntries());
      setWorkspacePrimaryDomain(DEFAULT_PRIMARY_DOMAIN);
      return;
    }
    let cancelled = false;
    const loadDomainSettings = async () => {
      try {
        const data = await readGroupVarsAll(workspaceId);
        const entries = parseDomainCatalogFromGroupVars(data);
        const domain = normalizePrimaryDomainSelection(
          readPrimaryDomainFromGroupVars(data),
          entries
        );
        if (!cancelled) {
          setDomainEntries(entries);
          setWorkspacePrimaryDomain(domain);
        }
      } catch {
        if (!cancelled) {
          setDomainEntries(createDefaultDomainEntries());
          setWorkspacePrimaryDomain(DEFAULT_PRIMARY_DOMAIN);
        }
      }
    };
    void loadDomainSettings();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, readGroupVarsAll, setDomainEntries, setWorkspacePrimaryDomain]);

  useEffect(() => {
    setPrimaryDomainDraft(
      normalizePrimaryDomainSelection(workspacePrimaryDomain, domainEntries)
    );
    setPrimaryDomainModalError(null);
  }, [
    workspaceId,
    workspacePrimaryDomain,
    domainEntries,
    setPrimaryDomainDraft,
    setPrimaryDomainModalError,
  ]);

  const persistPrimaryDomainForAlias = useCallback(
    async (alias: string, primaryDomain: string) => {
      const targetAlias = String(alias || "").trim();
      if (!workspaceId || !targetAlias) return;
      try {
        await fetch(`${baseUrl}/api/providers/primary-domain`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            alias: targetAlias,
            primary_domain: normalizePrimaryDomainSelection(primaryDomain, domainEntries),
          }),
        });
      } catch {
        // Keep UI responsive if background sync fails.
      }
    },
    [baseUrl, workspaceId, domainEntries]
  );

  useEffect(() => {
    const fallbackPrimary = normalizePrimaryDomainSelection(
      workspacePrimaryDomain,
      domainEntries
    );
    const corrections: Array<{ alias: string; primaryDomain: string }> = [];
    setServers((prev) => {
      let changed = false;
      const next = prev.map((server) => {
        const currentPrimary = normalizeDomainName(server.primaryDomain);
        if (currentPrimary) {
          return server;
        }
        const normalizedPrimary = fallbackPrimary;
        changed = true;
        corrections.push({ alias: server.alias, primaryDomain: normalizedPrimary });
        return { ...server, primaryDomain: normalizedPrimary };
      });
      return changed ? normalizePersistedDeviceMeta(next) : prev;
    });
    if (corrections.length > 0 && workspaceId) {
      corrections.forEach(({ alias, primaryDomain }) => {
        void persistPrimaryDomainForAlias(alias, primaryDomain);
      });
    }
  }, [
    domainEntries,
    persistPrimaryDomainForAlias,
    setServers,
    workspaceId,
    workspacePrimaryDomain,
  ]);

  const { openDomainPopup, closeDomainPopup, checkDomainPopupFqdn, addDomainFromPopup } =
    useWorkspaceDomainPopup({
      baseUrl,
      workspaceId,
      setServers,
      domainEntries,
      domainPopupType,
      setDomainPopupType,
      domainPopupFqdnValue,
      setDomainPopupFqdnValue,
      setDomainPopupOpen,
      setDomainPopupError,
      setDomainPopupFqdnCheckBusy,
      setDomainPopupFqdnCheckResult,
      domainPopupLocalValue,
      setDomainPopupLocalValue,
      domainPopupSubLabel,
      setDomainPopupSubLabel,
      domainPopupParentFqdn,
      setDomainPopupParentFqdn,
      setDomainPopupPrompt,
      domainPopupTargetAlias,
      setDomainPopupTargetAlias,
      fqdnDomainOptions,
      primaryDomainDraft,
      workspacePrimaryDomain,
      persistWorkspaceDomainSettings,
    });

  const addReservedDomain = useCallback(
    async (rawFqdn: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const fqdn = normalizeDomainName(rawFqdn);
      if (!isLikelyFqdn(fqdn)) {
        return { ok: false, error: "Enter a valid FQDN (e.g. shop.example.org)." };
      }
      const duplicate = domainEntries.some(
        (entry) => normalizeDomainName(entry.domain) === fqdn
      );
      if (duplicate) {
        // Already in the workspace — nothing to add. The user can
        // pick it as default via the radio if they want.
        return { ok: true };
      }
      // Same availability gate the Add Domain popup uses, so the
      // inline Reserve flow can't bypass it.
      const check = await fetchDomainAvailability(baseUrl, fqdn);
      if ("error" in check) return { ok: false, error: check.error };
      if (!check.available) {
        return {
          ok: false,
          error: check.note || "Domain is likely already registered.",
        };
      }
      const nextEntries = parseDomainCatalogFromGroupVars({
        [GROUP_VARS_DOMAIN_CATALOG_KEY]: [
          ...buildDomainCatalogPayload(domainEntries),
          { type: "fqdn", domain: fqdn, status: "reserved" },
        ],
      });
      // Don't auto-select the new domain as primary — the user picks
      // it explicitly via the radio button (which itself persists).
      await persistWorkspaceDomainSettings({
        entries: nextEntries,
        primaryDomain: primaryDomainDraft,
      });
      return { ok: true };
    },
    [baseUrl, domainEntries, primaryDomainDraft, persistWorkspaceDomainSettings]
  );

  const applyDomainStatus = useCallback(
    (
      domain: string,
      status: DomainEntry["status"],
      statusChangedAt: string | null
    ) => {
      const targetDomain = normalizeDomainName(domain);
      if (!targetDomain) return;
      setDomainEntries((prev) =>
        prev.map((entry) =>
          normalizeDomainName(entry.domain) === targetDomain
            ? { ...entry, status, statusChangedAt }
            : entry
        )
      );
    },
    [setDomainEntries]
  );

  return {
    primaryDomainOptions,
    fqdnDomainOptions,
    devicesByDomain,
    filteredDomainEntries,
    persistWorkspaceDomainSettings,
    openDomainPopup,
    closeDomainPopup,
    checkDomainPopupFqdn,
    addDomainFromPopup,
    removeDomainEntry,
    applyDomainStatus,
    addReservedDomain,
  };
}
