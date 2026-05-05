"use client";

// Persists workspace-scoped UI selection state across hard reloads.
// `selectedByAlias` mirrors what's in inventory.yml but is needed
// before that file finishes loading; `selectedPlansByAlias` has no
// backend home at all, so localStorage is its sole persistence layer.

import { useEffect } from "react";

const SELECTED_BY_ALIAS_KEY_PREFIX = "infinito.selectedByAlias.";
const SELECTED_PLANS_BY_ALIAS_KEY_PREFIX = "infinito.selectedPlansByAlias.";

function selectedByAliasKey(workspaceId: string): string {
  return `${SELECTED_BY_ALIAS_KEY_PREFIX}${workspaceId}`;
}

function selectedPlansByAliasKey(workspaceId: string): string {
  return `${SELECTED_PLANS_BY_ALIAS_KEY_PREFIX}${workspaceId}`;
}

export function readSelectedByAlias(
  workspaceId: string | null | undefined
): Record<string, Set<string>> {
  if (typeof window === "undefined" || !workspaceId) return {};
  try {
    const raw = window.localStorage.getItem(selectedByAliasKey(workspaceId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, Set<string>> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([alias, roles]) => {
      const key = String(alias || "").trim();
      if (!key || !Array.isArray(roles)) return;
      out[key] = new Set<string>(
        roles
          .map((role) => String(role || "").trim())
          .filter((role): role is string => Boolean(role))
      );
    });
    return out;
  } catch {
    return {};
  }
}

export function readSelectedPlansByAlias(
  workspaceId: string | null | undefined
): Record<string, Record<string, string | null>> {
  if (typeof window === "undefined" || !workspaceId) return {};
  try {
    const raw = window.localStorage.getItem(selectedPlansByAliasKey(workspaceId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, Record<string, string | null>> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([alias, plans]) => {
      const key = String(alias || "").trim();
      if (!key || !plans || typeof plans !== "object" || Array.isArray(plans)) {
        return;
      }
      const inner: Record<string, string | null> = {};
      Object.entries(plans as Record<string, unknown>).forEach(([roleId, plan]) => {
        const roleKey = String(roleId || "").trim();
        if (!roleKey) return;
        if (plan === null || plan === undefined) {
          inner[roleKey] = null;
          return;
        }
        const planStr = String(plan).trim();
        inner[roleKey] = planStr || null;
      });
      out[key] = inner;
    });
    return out;
  } catch {
    return {};
  }
}

export function useWorkspaceSelectionStorage(
  workspaceId: string | null,
  selectedByAlias: Record<string, Set<string>>,
  selectedPlansByAlias: Record<string, Record<string, string | null>>
): void {
  useEffect(() => {
    if (typeof window === "undefined" || !workspaceId) return;
    try {
      const serialized: Record<string, string[]> = {};
      Object.entries(selectedByAlias || {}).forEach(([alias, set]) => {
        const key = String(alias || "").trim();
        if (!key) return;
        serialized[key] = Array.from(set || new Set<string>())
          .map((role) => String(role || "").trim())
          .filter(Boolean);
      });
      window.localStorage.setItem(
        selectedByAliasKey(workspaceId),
        JSON.stringify(serialized)
      );
    } catch {
      // ignore quota / serialization errors
    }
  }, [workspaceId, selectedByAlias]);

  useEffect(() => {
    if (typeof window === "undefined" || !workspaceId) return;
    try {
      window.localStorage.setItem(
        selectedPlansByAliasKey(workspaceId),
        JSON.stringify(selectedPlansByAlias || {})
      );
    } catch {
      // ignore
    }
  }, [workspaceId, selectedPlansByAlias]);
}
