"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import YAML from "yaml";
import { parseApiError } from "./helpers";
import type { RoleAppConfigResponse } from "./types";
import { resolvePersistedRolePlanId } from "../../lib/role_app_config_plan.js";

type UseWorkspaceRoleAppConfigProps = {
  baseUrl: string;
  workspaceId: string | null;
  activeAlias: string;
  defaultPlanForRole: (roleId: string) => string;
  setSelectedByAlias: Dispatch<SetStateAction<Record<string, Set<string>>>>;
  setSelectedPlansByAlias: Dispatch<
    SetStateAction<Record<string, Record<string, string | null>>>
  >;
  setSelectionTouched: Dispatch<SetStateAction<boolean>>;
};

export function useWorkspaceRoleAppConfig({
  baseUrl,
  workspaceId,
  activeAlias,
  defaultPlanForRole,
  setSelectedByAlias,
  setSelectedPlansByAlias,
  setSelectionTouched,
}: UseWorkspaceRoleAppConfigProps) {
  const roleAppConfigUrl = useCallback(
    (roleId: string, suffix = "", aliasOverride?: string) => {
      if (!workspaceId) {
        throw new Error("Workspace is not ready yet.");
      }
      const rid = encodeURIComponent(String(roleId || "").trim());
      const alias = String(aliasOverride || activeAlias || "").trim();
      const query = alias ? `?alias=${encodeURIComponent(alias)}` : "";
      return `${baseUrl}/api/workspaces/${workspaceId}/roles/${rid}/app-config${suffix}${query}`;
    },
    [activeAlias, baseUrl, workspaceId]
  );

  const loadRoleAppConfig = useCallback(
    async (roleId: string, aliasOverride?: string): Promise<RoleAppConfigResponse> => {
      const url = roleAppConfigUrl(roleId, "", aliasOverride);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      return (await res.json()) as RoleAppConfigResponse;
    },
    [roleAppConfigUrl]
  );

  const saveRoleAppConfig = useCallback(
    async (
      roleId: string,
      content: string,
      aliasOverride?: string
    ): Promise<RoleAppConfigResponse> => {
      const url = roleAppConfigUrl(roleId, "", aliasOverride);
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      return (await res.json()) as RoleAppConfigResponse;
    },
    [roleAppConfigUrl]
  );

  const selectRolePlanForAlias = useCallback(
    (alias: string, roleId: string, planId: string | null) => {
      const targetAlias = String(alias || "").trim();
      const targetRole = String(roleId || "").trim();
      if (!targetAlias || !targetRole) return;

      const normalizedPlan = planId ? String(planId || "").trim() : null;
      const defaultPlanId = defaultPlanForRole(targetRole);
      const resolvedPlan = normalizedPlan || defaultPlanId;
      const persistedPlanId = resolvePersistedRolePlanId(
        normalizedPlan,
        defaultPlanId
      );

      setSelectedByAlias((prev) => {
        const next: Record<string, Set<string>> = { ...prev };
        const set = next[targetAlias] ? new Set(next[targetAlias]) : new Set<string>();
        if (normalizedPlan) {
          set.add(targetRole);
        } else {
          set.delete(targetRole);
        }
        next[targetAlias] = set;
        return next;
      });

      setSelectedPlansByAlias((prev) => {
        const next: Record<string, Record<string, string | null>> = { ...prev };
        const current = { ...(next[targetAlias] || {}) };
        current[targetRole] = normalizedPlan ? resolvedPlan : null;
        next[targetAlias] = current;
        return next;
      });
      setSelectionTouched(true);

      if (!workspaceId) return;
      void (async () => {
        try {
          const loaded = await loadRoleAppConfig(targetRole, targetAlias);
          let parsed: Record<string, any> = {};
          try {
            const data = YAML.parse(String(loaded?.content ?? "")) ?? {};
            if (data && typeof data === "object" && !Array.isArray(data)) {
              parsed = data as Record<string, any>;
            }
          } catch {
            parsed = {};
          }
          if (persistedPlanId) {
            parsed.plan_id = persistedPlanId;
          } else {
            delete parsed.plan_id;
          }
          await saveRoleAppConfig(targetRole, YAML.stringify(parsed), targetAlias);
        } catch {
          // keep UI responsive; inventory write errors are surfaced in the config editor flow
        }
      })();
    },
    [
      defaultPlanForRole,
      loadRoleAppConfig,
      saveRoleAppConfig,
      setSelectedByAlias,
      setSelectedPlansByAlias,
      setSelectionTouched,
      workspaceId,
    ]
  );

  const importRoleAppDefaults = useCallback(
    async (roleId: string, aliasOverride?: string): Promise<RoleAppConfigResponse> => {
      const url = roleAppConfigUrl(roleId, "/import-defaults", aliasOverride);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      return (await res.json()) as RoleAppConfigResponse;
    },
    [roleAppConfigUrl]
  );

  return {
    loadRoleAppConfig,
    saveRoleAppConfig,
    selectRolePlanForAlias,
    importRoleAppDefaults,
  };
}
