"use client";

import { useCallback, useEffect, useMemo } from "react";
import YAML from "yaml";
import { sanitizeAliasFilename } from "../workspace-panel/utils";
import {
  normalizePersistedDeviceMeta,
  parseHostVarsServerPatchData,
} from "../../lib/device_meta";
import {
  normalizeDeviceColor,
  normalizeDeviceEmoji,
  pickUniqueDeviceColor,
  pickUniqueDeviceEmoji,
} from "../deployment-credentials/device-visuals";
import type { ServerState } from "../deployment-credentials/types";
import { DEFAULT_PRIMARY_DOMAIN } from "./domain-utils";
import { encodeWorkspacePath } from "./helpers";

type UseWorkspaceServerMetadataProps = {
  baseUrl: string;
  workspaceId: string | null;
  servers: ServerState[];
  setServers: React.Dispatch<React.SetStateAction<ServerState[]>>;
  activeAlias: string;
};

export function useWorkspaceServerMetadata({
  baseUrl,
  workspaceId,
  servers,
  setServers,
  activeAlias,
}: UseWorkspaceServerMetadataProps) {
  const createServer = useCallback(
    (alias: string, existingServers: ServerState[] = []): ServerState => {
      const usedColors = new Set<string>();
      const usedLogos = new Set<string>();
      existingServers.forEach((server) => {
        const color = normalizeDeviceColor(server.color);
        if (color) usedColors.add(color);
        const logo = normalizeDeviceEmoji(server.logoEmoji);
        if (logo) usedLogos.add(logo);
      });
      return {
        alias,
        description: "",
        primaryDomain: DEFAULT_PRIMARY_DOMAIN,
        requirementServerType: "vps",
        requirementStorageGb: "200",
        requirementLocation: "Germany",
        host: "",
        port: "22",
        user: "root",
        color: pickUniqueDeviceColor(usedColors),
        logoEmoji: pickUniqueDeviceEmoji(usedLogos),
        authMethod: "password",
        password: "",
        privateKey: "",
        publicKey: "",
        keyAlgorithm: "ed25519",
        keyPassphrase: "",
      };
    },
    []
  );

  const persistDeviceVisualMetaForAlias = useCallback(
    async (
      alias: string,
      patch: { color?: string; logoEmoji?: string }
    ): Promise<void> => {
      if (!workspaceId) return;
      const targetAlias = String(alias || "").trim();
      if (!targetAlias) return;
      const hasColorPatch = Object.prototype.hasOwnProperty.call(patch, "color");
      const hasLogoPatch = Object.prototype.hasOwnProperty.call(patch, "logoEmoji");
      if (!hasColorPatch && !hasLogoPatch) return;

      const hostVarsPath = `host_vars/${sanitizeAliasFilename(targetAlias)}.yml`;
      const fileUrl = `${baseUrl}/api/workspaces/${workspaceId}/files/${encodeWorkspacePath(
        hostVarsPath
      )}`;

      let data: Record<string, any> = {};
      try {
        const readRes = await fetch(fileUrl, { cache: "no-store" });
        if (readRes.ok) {
          const payload = await readRes.json();
          const parsed = YAML.parse(String(payload?.content ?? ""));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed as Record<string, any>;
          }
        } else if (readRes.status !== 404) {
          return;
        }
      } catch {
        return;
      }

      let changed = false;

      if (hasColorPatch) {
        const nextColor = normalizeDeviceColor(patch.color) || "";
        if (nextColor) {
          if (data.color !== nextColor) {
            data.color = nextColor;
            changed = true;
          }
        } else if (Object.prototype.hasOwnProperty.call(data, "color")) {
          delete data.color;
          changed = true;
        }
      }

      if (hasLogoPatch) {
        const nextLogo = normalizeDeviceEmoji(patch.logoEmoji) || "";
        const logoNode: Record<string, any> =
          data.logo && typeof data.logo === "object" && !Array.isArray(data.logo)
            ? { ...data.logo }
            : {};
        const currentLogo =
          typeof logoNode.emoji === "string" ? String(logoNode.emoji || "") : "";
        if (nextLogo) {
          if (currentLogo !== nextLogo) {
            logoNode.emoji = nextLogo;
            data.logo = logoNode;
            changed = true;
          } else if (!data.logo || typeof data.logo !== "object" || Array.isArray(data.logo)) {
            data.logo = logoNode;
            changed = true;
          }
        } else if (Object.prototype.hasOwnProperty.call(logoNode, "emoji")) {
          delete logoNode.emoji;
          if (Object.keys(logoNode).length === 0) {
            delete data.logo;
          } else {
            data.logo = logoNode;
          }
          changed = true;
        }
      }

      if (!changed) return;
      try {
        await fetch(fileUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: YAML.stringify(data) }),
        });
      } catch {
        // Ignore visual metadata sync errors to keep the UI responsive.
      }
    },
    [baseUrl, workspaceId]
  );

  const activeServer = useMemo(() => {
    if (activeAlias) {
      const found = servers.find((server) => server.alias === activeAlias);
      if (found) return found;
    }
    return servers[0] ?? null;
  }, [servers, activeAlias]);

  const serverAliasKey = useMemo(
    () =>
      Array.from(
        new Set(
          servers
            .map((server) => String(server.alias || "").trim())
            .filter(Boolean)
        )
      )
        .sort((a, b) => a.localeCompare(b))
        .join("|"),
    [servers]
  );

  useEffect(() => {
    if (!workspaceId) return;
    const aliases = serverAliasKey
      ? serverAliasKey.split("|").map((alias) => String(alias || "").trim()).filter(Boolean)
      : [];
    if (aliases.length === 0) return;

    let cancelled = false;
    const loadServerMetaFromHostVars = async () => {
      try {
        const listRes = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/files`, {
          cache: "no-store",
        });
        if (!listRes.ok) return;
        const listData = await listRes.json();
        const files = Array.isArray(listData?.files) ? listData.files : [];
        const hostVarsPathByAlias = new Map<string, string>();

        files.forEach((entry: any) => {
          if (!entry || entry.is_dir) return;
          const path = String(entry.path || "");
          const match = path.match(/^host_vars\/([^/]+)\.ya?ml$/i);
          if (!match) return;
          const alias = String(match[1] || "").trim();
          if (!alias || hostVarsPathByAlias.has(alias)) return;
          hostVarsPathByAlias.set(alias, path);
        });

        const patchByAlias: Record<string, Partial<ServerState>> = {};
        const requirementsFallbackByAlias: Record<
          string,
          { server_type?: string; storage_gb?: number; location?: string }
        > = {};
        await Promise.all(
          aliases.map(async (alias) => {
            const hostVarsPath = hostVarsPathByAlias.get(alias);
            if (!hostVarsPath) return;
            const fileRes = await fetch(
              `${baseUrl}/api/workspaces/${workspaceId}/files/${encodeWorkspacePath(
                hostVarsPath
              )}`,
              { cache: "no-store" }
            );
            if (!fileRes.ok) return;
            const fileData = await fileRes.json();
            const parsed = (YAML.parse(String(fileData?.content ?? "")) ?? {}) as Record<
              string,
              unknown
            >;
            const patch = parseHostVarsServerPatchData(parsed);
            if (Object.keys(patch).length > 0) {
              patchByAlias[alias] = patch;
              if (
                typeof patch.requirementServerType === "string" ||
                typeof patch.requirementStorageGb === "string" ||
                typeof patch.requirementLocation === "string"
              ) {
                const server_type = String(patch.requirementServerType || "").trim();
                const storageRaw = String(patch.requirementStorageGb || "").trim();
                const storageParsed = Number(storageRaw);
                const storage_gb =
                  storageRaw && Number.isFinite(storageParsed)
                    ? Math.max(0, Math.floor(storageParsed))
                    : undefined;
                const location = String(patch.requirementLocation || "").trim();
                requirementsFallbackByAlias[alias] = {
                  ...(server_type ? { server_type } : {}),
                  ...(typeof storage_gb === "number" ? { storage_gb } : {}),
                  ...(location ? { location } : {}),
                };
              }
            }
          })
        );

        let requirementsByAlias: Record<string, any> = {};
        try {
          const reqRes = await fetch(
            `${baseUrl}/api/workspaces/${workspaceId}/server-requirements`,
            { cache: "no-store" }
          );
          if (reqRes.ok) {
            const reqData = await reqRes.json();
            const byAlias = reqData?.requirements_by_alias;
            if (byAlias && typeof byAlias === "object" && !Array.isArray(byAlias)) {
              requirementsByAlias = byAlias as Record<string, any>;
            }
          }
        } catch {
          // ignore requirements hydration errors
        }

        const aliasesNeedingMigration: Array<{ alias: string; requirements: Record<string, any> }> = [];
        Object.entries(requirementsFallbackByAlias).forEach(([alias, req]) => {
          const existing = requirementsByAlias?.[alias];
          const hasDb =
            existing && typeof existing === "object" && Object.keys(existing).length > 0;
          const hasFallback = Object.keys(req || {}).length > 0;
          if (!hasDb && hasFallback) {
            aliasesNeedingMigration.push({ alias, requirements: req as Record<string, any> });
          }
        });

        Object.keys(requirementsByAlias || {}).forEach((alias) => {
          const req = requirementsByAlias[alias];
          if (!req || typeof req !== "object" || Array.isArray(req)) return;
          const patch: Partial<ServerState> = {};
          if (Object.prototype.hasOwnProperty.call(req, "server_type")) {
            patch.requirementServerType = String(req.server_type ?? "").trim();
          }
          if (Object.prototype.hasOwnProperty.call(req, "storage_gb")) {
            patch.requirementStorageGb = String(req.storage_gb ?? "").trim();
          }
          if (Object.prototype.hasOwnProperty.call(req, "location")) {
            patch.requirementLocation = String(req.location ?? "").trim();
          }
          if (Object.keys(patch).length === 0) return;
          patchByAlias[alias] = { ...(patchByAlias[alias] || {}), ...patch };
        });

        if (cancelled || Object.keys(patchByAlias).length === 0) return;
        setServers((prev) => {
          let changed = false;
          const next = prev.map((server) => {
            const patch = patchByAlias[server.alias];
            if (!patch) return server;
            const merged: ServerState = { ...server, ...patch };
            const same =
              merged.host === server.host &&
              merged.port === server.port &&
              merged.user === server.user &&
              merged.description === server.description &&
              merged.primaryDomain === server.primaryDomain &&
              merged.requirementServerType === server.requirementServerType &&
              merged.requirementStorageGb === server.requirementStorageGb &&
              merged.requirementLocation === server.requirementLocation &&
              merged.color === server.color &&
              merged.logoEmoji === server.logoEmoji;
            if (same) return server;
            changed = true;
            return merged;
          });
          return changed ? normalizePersistedDeviceMeta(next) : prev;
        });

        if (!cancelled && aliasesNeedingMigration.length > 0) {
          void Promise.all(
            aliasesNeedingMigration.map(async ({ alias, requirements }) => {
              try {
                await fetch(
                  `${baseUrl}/api/workspaces/${workspaceId}/servers/${encodeURIComponent(
                    alias
                  )}/requirements`,
                  {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ requirements }),
                  }
                );
              } catch {
                // ignore best-effort migration failures
              }
            })
          );
        }
      } catch {
        // ignore hydration failures and keep current in-memory state
      }
    };

    void loadServerMetaFromHostVars();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, workspaceId, serverAliasKey, setServers]);

  return {
    createServer,
    persistDeviceVisualMetaForAlias,
    activeServer,
  };
}
