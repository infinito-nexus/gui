"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { normalizePersistedDeviceMeta } from "../../lib/device_meta";
import type { ServerState } from "../deployment-credentials/types";
import {
  DEFAULT_PRIMARY_DOMAIN,
  GROUP_VARS_DOMAIN_CATALOG_KEY,
  buildDomainCatalogPayload,
  isLikelyFqdn,
  isValidDomainToken,
  normalizeDomainLabel,
  normalizeDomainName,
  parseDomainCatalogFromGroupVars,
} from "./domain-utils";
import type {
  DomainEntry,
  DomainKind,
  PrimaryDomainAddRequest,
} from "./types";

type UseWorkspaceDomainPopupProps = {
  baseUrl: string;
  workspaceId: string | null;
  setServers: Dispatch<SetStateAction<ServerState[]>>;
  domainEntries: DomainEntry[];
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
  fqdnDomainOptions: string[];
  primaryDomainDraft: string;
  workspacePrimaryDomain: string;
  persistWorkspaceDomainSettings: (options?: {
    entries?: DomainEntry[];
    primaryDomain?: string;
  }) => Promise<void>;
};

export function useWorkspaceDomainPopup({
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
}: UseWorkspaceDomainPopupProps) {
  const openDomainPopup = useCallback(
    (preferredType: DomainKind = "fqdn", request?: PrimaryDomainAddRequest) => {
      const alias = String(request?.alias || "").trim();
      const requestedDomain = normalizeDomainName(request?.value);
      const requestedParentFqdn = normalizeDomainName(request?.parentFqdn);
      const requestedSubLabel = normalizeDomainLabel(request?.subLabel);
      const reason = request?.reason;
      setDomainPopupOpen(true);
      setDomainPopupError(null);
      setDomainPopupFqdnCheckResult(null);
      setDomainPopupTargetAlias(alias || null);
      if (reason === "missing") {
        setDomainPopupPrompt(
          "Please select an existing domain or add a valid domain first."
        );
      } else if (reason === "unknown" && requestedDomain) {
        setDomainPopupPrompt(
          `"${requestedDomain}" is not in the list. Add it as a valid domain.`
        );
      } else {
        setDomainPopupPrompt(null);
      }
      if (request?.kind === "subdomain" || preferredType === "subdomain") {
        setDomainPopupType("subdomain");
        setDomainPopupFqdnValue("");
        setDomainPopupLocalValue(DEFAULT_PRIMARY_DOMAIN);
        setDomainPopupSubLabel(requestedSubLabel);
        if (requestedParentFqdn && fqdnDomainOptions.includes(requestedParentFqdn)) {
          setDomainPopupParentFqdn(requestedParentFqdn);
        } else if (fqdnDomainOptions.length > 0) {
          setDomainPopupParentFqdn(fqdnDomainOptions[0]);
        } else {
          setDomainPopupParentFqdn("");
        }
        return;
      }
      if (requestedDomain) {
        if (requestedDomain.includes(".")) {
          setDomainPopupType("fqdn");
          setDomainPopupFqdnValue(requestedDomain);
          setDomainPopupSubLabel("");
          setDomainPopupParentFqdn("");
          setDomainPopupLocalValue(DEFAULT_PRIMARY_DOMAIN);
        } else {
          setDomainPopupType("local");
          setDomainPopupLocalValue(requestedDomain);
          setDomainPopupFqdnValue("");
          setDomainPopupSubLabel("");
          setDomainPopupParentFqdn("");
        }
        return;
      }
      setDomainPopupType(preferredType);
      setDomainPopupFqdnValue("");
      setDomainPopupLocalValue(DEFAULT_PRIMARY_DOMAIN);
      setDomainPopupParentFqdn("");
      setDomainPopupSubLabel("");
    },
    [
      fqdnDomainOptions,
      setDomainPopupError,
      setDomainPopupFqdnCheckResult,
      setDomainPopupFqdnValue,
      setDomainPopupLocalValue,
      setDomainPopupOpen,
      setDomainPopupParentFqdn,
      setDomainPopupPrompt,
      setDomainPopupSubLabel,
      setDomainPopupTargetAlias,
      setDomainPopupType,
    ]
  );

  const closeDomainPopup = useCallback(() => {
    setDomainPopupOpen(false);
    setDomainPopupError(null);
    setDomainPopupFqdnValue("");
    setDomainPopupFqdnCheckBusy(false);
    setDomainPopupFqdnCheckResult(null);
    setDomainPopupSubLabel("");
    setDomainPopupParentFqdn("");
    setDomainPopupLocalValue(DEFAULT_PRIMARY_DOMAIN);
    setDomainPopupType("fqdn");
    setDomainPopupPrompt(null);
    setDomainPopupTargetAlias(null);
  }, [
    setDomainPopupError,
    setDomainPopupFqdnCheckBusy,
    setDomainPopupFqdnCheckResult,
    setDomainPopupFqdnValue,
    setDomainPopupLocalValue,
    setDomainPopupOpen,
    setDomainPopupParentFqdn,
    setDomainPopupPrompt,
    setDomainPopupSubLabel,
    setDomainPopupTargetAlias,
    setDomainPopupType,
  ]);

  const checkDomainPopupFqdn = useCallback(async () => {
    const domain = normalizeDomainName(domainPopupFqdnValue);
    if (!isLikelyFqdn(domain)) {
      setDomainPopupError("Enter a valid FQDN (for example: shop.example.org).");
      setDomainPopupFqdnCheckResult(null);
      return;
    }
    setDomainPopupFqdnCheckBusy(true);
    setDomainPopupError(null);
    setDomainPopupFqdnCheckResult(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/providers/domain-availability?domain=${encodeURIComponent(
          domain
        )}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data?.detail === "string" && data.detail.trim()) {
            message = data.detail.trim();
          }
        } catch {
          const text = await res.text();
          if (text.trim()) message = text.trim();
        }
        throw new Error(message);
      }
      const data = (await res.json()) as {
        available?: boolean;
        note?: string;
      };
      const available = Boolean(data?.available);
      const note = String(data?.note || "").trim();
      setDomainPopupFqdnCheckResult({
        available,
        note:
          note ||
          (available ? "Domain looks available." : "Domain is likely already registered."),
      });
    } catch (err: any) {
      setDomainPopupError(err?.message ?? "Domain availability check failed.");
      setDomainPopupFqdnCheckResult(null);
    } finally {
      setDomainPopupFqdnCheckBusy(false);
    }
  }, [
    baseUrl,
    domainPopupFqdnValue,
    setDomainPopupError,
    setDomainPopupFqdnCheckBusy,
    setDomainPopupFqdnCheckResult,
  ]);

  const addDomainFromPopup = useCallback(() => {
    let nextDomain = "";
    let nextParentFqdn: string | null = null;

    if (domainPopupType === "local") {
      const localValue = normalizeDomainName(domainPopupLocalValue);
      if (!localValue || !isValidDomainToken(localValue)) {
        setDomainPopupError(
          "Enter a valid local domain (letters, numbers, dot, underscore, hyphen)."
        );
        return;
      }
      nextDomain = localValue;
    } else if (domainPopupType === "fqdn") {
      nextDomain = normalizeDomainName(domainPopupFqdnValue);
      if (!isLikelyFqdn(nextDomain)) {
        setDomainPopupError("Enter a valid FQDN (for example: shop.example.org).");
        return;
      }
    } else {
      const subLabel = normalizeDomainLabel(domainPopupSubLabel);
      const parentFqdn = normalizeDomainName(domainPopupParentFqdn);
      if (!subLabel || !parentFqdn) {
        setDomainPopupError("Provide subdomain label and parent FQDN.");
        return;
      }
      if (!fqdnDomainOptions.includes(parentFqdn)) {
        setDomainPopupError("Subdomains must belong to an existing FQDN.");
        return;
      }
      nextDomain = `${subLabel}.${parentFqdn}`;
      nextParentFqdn = parentFqdn;
    }

    const applyDomainToTargetAlias = (domain: string) => {
      const targetAlias = String(domainPopupTargetAlias || "").trim();
      if (!targetAlias) return false;
      setServers((prev) =>
        normalizePersistedDeviceMeta(
          prev.map((server) =>
            server.alias === targetAlias
              ? { ...server, primaryDomain: domain }
              : server
          )
        )
      );
      if (workspaceId) {
        void fetch(`${baseUrl}/api/providers/primary-domain`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            alias: targetAlias,
            primary_domain: domain,
          }),
        });
      }
      return true;
    };

    const duplicate = domainEntries.some(
      (entry) => normalizeDomainName(entry.domain) === nextDomain
    );
    if (duplicate) {
      if (applyDomainToTargetAlias(nextDomain)) {
        closeDomainPopup();
        return;
      }
      setDomainPopupError("Domain already exists.");
      return;
    }

    const nextEntries = parseDomainCatalogFromGroupVars({
      [GROUP_VARS_DOMAIN_CATALOG_KEY]: [
        ...buildDomainCatalogPayload(domainEntries),
        {
          type: domainPopupType,
          domain: nextDomain,
          status: "reserved",
          ...(nextParentFqdn ? { parent_fqdn: nextParentFqdn } : {}),
        },
      ],
      DOMAIN_PRIMARY: primaryDomainDraft || workspacePrimaryDomain || DEFAULT_PRIMARY_DOMAIN,
    });
    setDomainPopupError(null);
    const nextPrimaryDomain = normalizeDomainName(primaryDomainDraft)
      ? primaryDomainDraft
      : nextDomain;
    void persistWorkspaceDomainSettings({
      entries: nextEntries,
      primaryDomain: nextPrimaryDomain,
    });

    applyDomainToTargetAlias(nextDomain);
    closeDomainPopup();
  }, [
    baseUrl,
    closeDomainPopup,
    domainEntries,
    domainPopupFqdnValue,
    domainPopupLocalValue,
    domainPopupParentFqdn,
    domainPopupSubLabel,
    domainPopupTargetAlias,
    domainPopupType,
    fqdnDomainOptions,
    persistWorkspaceDomainSettings,
    primaryDomainDraft,
    setDomainPopupError,
    setServers,
    workspaceId,
    workspacePrimaryDomain,
  ]);

  return {
    openDomainPopup,
    closeDomainPopup,
    checkDomainPopupFqdn,
    addDomainFromPopup,
  };
}
