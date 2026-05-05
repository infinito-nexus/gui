import YAML from "yaml";
import { buildCredentialsPatchFromHostVarsData } from "../../../../lib/device_meta";
import {
  normalizeDeviceColor,
  normalizeDeviceEmoji,
} from "../../../deployment-credentials/device-visuals";
import { sanitizeAliasFilename } from "../../utils";

export function createWorkspacePanelSyncActions(ctx: any) {
  const {
    baseUrl,
    workspaceId,
    inventoryReady,
    canGenerate,
    activeAlias,
    activeRoles,
    selectedRolesByAlias,
    activePath,
    credentials,
    hostVarsPath,
    hostVarsSyncRef,
    lastPortRef,
    onSelectedRolesByAliasChange,
    onCredentialsPatch,
    mergeRolesByAlias,
    normalizeRoles,
    rolesByAliasKey,
    extractRolesByAlias,
    readWorkspaceFile,
    writeWorkspaceFile,
    refreshFiles,
    setEditorValue,
    setEditorDirty,
    setGenerateBusy,
    setInventorySyncError,
  } = ctx;

  const generateInventory = async () => {
    if (!workspaceId || !canGenerate) return;
    setGenerateBusy(true);
    setInventorySyncError(null);
    try {
      const portRaw = credentials.port?.trim() || "";
      const portNum = portRaw ? Number(portRaw) : null;
      const payload = {
        alias: activeAlias,
        host: credentials.host,
        port: Number.isInteger(portNum) ? portNum : undefined,
        user: credentials.user,
        auth_method: credentials.authMethod || null,
        selected_roles: activeRoles,
      };
      const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/generate-inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        if (res.status === 409 && message === "inventory already exists") {
          await refreshFiles(workspaceId);
          setInventorySyncError(null);
          return;
        }
        throw new Error(message);
      }
      await refreshFiles(workspaceId);
      setInventorySyncError(null);
    } catch (err: any) {
      setInventorySyncError(
        err?.message ? `Inventory creation failed: ${err.message}` : "Inventory creation failed."
      );
    } finally {
      setGenerateBusy(false);
    }
  };

  const resolveTargetRoles = (credentialsScope: "all" | "single", credentialsRole: string) => {
    if (credentialsScope === "single") {
      return credentialsRole ? [credentialsRole] : [];
    }
    return activeRoles;
  };

  const renameAliasInInventory = async (fromAlias: string, toAlias: string) => {
    if (!workspaceId || !inventoryReady) return;
    const content = await readWorkspaceFile("inventory.yml");
    const data = (YAML.parse(content) ?? {}) as Record<string, any>;
    const allNode = data.all && typeof data.all === "object" ? data.all : {};
    const childrenNode =
      allNode.children && typeof allNode.children === "object" ? allNode.children : {};

    let changed = false;
    const nextChildren: Record<string, any> = { ...childrenNode };

    Object.entries(childrenNode).forEach(([roleId, entryValue]) => {
      if (!entryValue || typeof entryValue !== "object") return;
      const entry = { ...(entryValue as Record<string, any>) };
      const hosts = entry.hosts && typeof entry.hosts === "object" ? { ...entry.hosts } : null;
      if (!hosts) return;
      if (!Object.prototype.hasOwnProperty.call(hosts, fromAlias)) return;
      if (!Object.prototype.hasOwnProperty.call(hosts, toAlias)) {
        hosts[toAlias] = hosts[fromAlias];
      }
      delete hosts[fromAlias];
      entry.hosts = hosts;
      nextChildren[roleId] = entry;
      changed = true;
    });

    if (!changed) return;

    const nextAll = { ...allNode, children: nextChildren };
    const nextData = { ...data, all: nextAll };
    const nextYaml = YAML.stringify(nextData);
    await writeWorkspaceFile("inventory.yml", nextYaml);
    if (activePath === "inventory.yml") {
      setEditorValue(nextYaml);
      setEditorDirty(false);
    }
  };

  const removeAliasFromInventory = async (alias: string) => {
    if (!workspaceId || !inventoryReady) return;
    const content = await readWorkspaceFile("inventory.yml");
    const data = (YAML.parse(content) ?? {}) as Record<string, any>;
    const allNode = data.all && typeof data.all === "object" ? data.all : {};
    const childrenNode =
      allNode.children && typeof allNode.children === "object" ? allNode.children : {};

    let changed = false;
    const nextChildren: Record<string, any> = { ...childrenNode };

    Object.entries(childrenNode).forEach(([roleId, entryValue]) => {
      if (!entryValue || typeof entryValue !== "object") return;
      const entry = { ...(entryValue as Record<string, any>) };
      const hosts = entry.hosts && typeof entry.hosts === "object" ? { ...entry.hosts } : null;
      if (!hosts) return;
      if (Object.prototype.hasOwnProperty.call(hosts, alias)) {
        delete hosts[alias];
        changed = true;
      }
      if (Object.keys(hosts).length === 0) {
        delete nextChildren[roleId];
        changed = true;
      } else {
        entry.hosts = hosts;
        nextChildren[roleId] = entry;
      }
    });

    if (!changed) return;

    const nextAll = { ...allNode, children: nextChildren };
    const nextData = { ...data, all: nextAll };
    const nextYaml = YAML.stringify(nextData);
    await writeWorkspaceFile("inventory.yml", nextYaml);
    if (activePath === "inventory.yml") {
      setEditorValue(nextYaml);
      setEditorDirty(false);
    }
  };

  const syncInventoryWithSelection = async (editorDirty: boolean) => {
    if (!workspaceId || !inventoryReady) return;
    if (activePath === "inventory.yml" && editorDirty) return;

    try {
      if (ctx.inventorySyncError) {
        setInventorySyncError(null);
      }
      const content = await readWorkspaceFile("inventory.yml");
      const data = (YAML.parse(content) ?? {}) as Record<string, any>;
      const allNode = data.all && typeof data.all === "object" ? data.all : {};
      const childrenNode =
        allNode.children && typeof allNode.children === "object" ? allNode.children : {};

      const mergedSelection = mergeRolesByAlias(selectedRolesByAlias);
      const managedAliases = new Set(
        Object.keys(mergedSelection)
          .map((alias) => String(alias || "").trim())
          .filter(Boolean)
      );
      const desiredHostsByRole: Record<string, Set<string>> = {};
      managedAliases.forEach((alias) => {
        const roles = normalizeRoles(mergedSelection[alias] || []);
        roles.forEach((roleId: string) => {
          if (!desiredHostsByRole[roleId]) {
            desiredHostsByRole[roleId] = new Set<string>();
          }
          desiredHostsByRole[roleId].add(alias);
        });
      });
      let changed = false;
      const nextChildren: Record<string, any> = { ...childrenNode };
      const roleIdsToProcess = new Set<string>([
        ...Object.keys(childrenNode),
        ...Object.keys(desiredHostsByRole),
      ]);

      roleIdsToProcess.forEach((roleId) => {
        const existing = nextChildren[roleId];
        const entry = existing && typeof existing === "object" ? { ...existing } : {};
        const hosts = entry.hosts && typeof entry.hosts === "object" ? { ...entry.hosts } : {};
        const desiredAliasesForRole = desiredHostsByRole[roleId] || new Set<string>();

        desiredAliasesForRole.forEach((alias) => {
          if (!Object.prototype.hasOwnProperty.call(hosts, alias)) {
            hosts[alias] = {};
            changed = true;
          }
        });

        Object.keys(hosts).forEach((alias) => {
          if (managedAliases.has(alias) && !desiredAliasesForRole.has(alias)) {
            delete hosts[alias];
            changed = true;
          }
        });

        if (Object.keys(hosts).length === 0) {
          if (Object.prototype.hasOwnProperty.call(nextChildren, roleId)) {
            delete nextChildren[roleId];
            changed = true;
          }
          return;
        }

        nextChildren[roleId] = { ...entry, hosts };
      });

      if (!changed) return;

      const nextAll = { ...allNode, children: nextChildren };
      const nextData = { ...data, all: nextAll };
      const nextYaml = YAML.stringify(nextData);

      await writeWorkspaceFile("inventory.yml", nextYaml);
      if (activePath === "inventory.yml") {
        setEditorValue(nextYaml);
        setEditorDirty(false);
      }
      await refreshFiles(workspaceId);
    } catch (err: any) {
      setInventorySyncError(err?.message ? `Inventory sync failed: ${err.message}` : "Inventory sync failed.");
    }
  };

  const syncSelectionFromInventory = async (editorDirty: boolean) => {
    if (
      !workspaceId ||
      !inventoryReady ||
      !onSelectedRolesByAliasChange ||
      (activePath === "inventory.yml" && editorDirty)
    )
      return;

    try {
      const content = await readWorkspaceFile("inventory.yml");
      const rolesByAlias = extractRolesByAlias(content);
      const merged = mergeRolesByAlias(rolesByAlias);
      if (rolesByAliasKey(merged) !== rolesByAliasKey(selectedRolesByAlias)) {
        onSelectedRolesByAliasChange(merged);
      }
    } catch {
      // ignore
    }
  };

  const syncHostVarsFromCredentials = async (editorDirty: boolean) => {
    if (!workspaceId) return;
    if (hostVarsSyncRef.current) return;
    if (!activeAlias) return;
    const host = credentials.host?.trim() || "";
    const portRaw = credentials.port?.trim() || "";
    const user = credentials.user?.trim() || "";
    const description = credentials.description?.trim() || "";
    const primaryDomain = credentials.primaryDomain?.trim() || "";
    const color = normalizeDeviceColor(credentials.color) || "";
    const logoEmoji = normalizeDeviceEmoji(credentials.logoEmoji) || "";
    const targetPath = hostVarsPath || (activeAlias ? `host_vars/${sanitizeAliasFilename(activeAlias)}.yml` : null);
    if (!targetPath) return;
    if (activePath === targetPath && editorDirty) return;
    if (
      !host &&
      !user &&
      !description &&
      !primaryDomain &&
      !color &&
      !logoEmoji
    ) {
      return;
    }

    try {
      let data: Record<string, any> = {};
      try {
        const content = await readWorkspaceFile(targetPath);
        data = (YAML.parse(content) ?? {}) as Record<string, any>;
      } catch {
        data = {};
      }
      let changed = false;
      if (host && data.ansible_host !== host) {
        data.ansible_host = host;
        changed = true;
      }
      if (user && data.ansible_user !== user) {
        data.ansible_user = user;
        changed = true;
      }
      if (description) {
        if (data.description !== description) {
          data.description = description;
          changed = true;
        }
      } else if (Object.prototype.hasOwnProperty.call(data, "description")) {
        delete data.description;
        changed = true;
      }
      if (primaryDomain) {
        if (data.DOMAIN_PRIMARY !== primaryDomain) {
          data.DOMAIN_PRIMARY = primaryDomain;
          changed = true;
        }
      } else if (Object.prototype.hasOwnProperty.call(data, "DOMAIN_PRIMARY")) {
        delete data.DOMAIN_PRIMARY;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(data, "server_requirements")) {
        delete data.server_requirements;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(data, "server_type")) {
        delete data.server_type;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(data, "storage_gb")) {
        delete data.storage_gb;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(data, "location")) {
        delete data.location;
        changed = true;
      }
      if (color && data.color !== color) {
        data.color = color;
        changed = true;
      }
      if (logoEmoji) {
        const currentLogo: Record<string, any> = data.logo && typeof data.logo === "object" ? { ...data.logo } : {};
        if (currentLogo.emoji !== logoEmoji) {
          currentLogo.emoji = logoEmoji;
          changed = true;
        }
        data.logo = currentLogo;
      } else if (
        data.logo &&
        typeof data.logo === "object" &&
        Object.prototype.hasOwnProperty.call(data.logo, "emoji")
      ) {
        const nextLogo: Record<string, any> = { ...data.logo };
        delete nextLogo.emoji;
        if (Object.keys(nextLogo).length === 0) {
          delete data.logo;
        } else {
          data.logo = nextLogo;
        }
        changed = true;
      }
      const prevPort = lastPortRef.current;
      lastPortRef.current = portRaw;
      if (portRaw) {
        const portNum = Number(portRaw);
        if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535) {
          const existing =
            typeof data.ansible_port === "number"
              ? data.ansible_port
              : Number.isInteger(Number(data.ansible_port))
                ? Number(data.ansible_port)
                : null;
          if (existing !== portNum) {
            data.ansible_port = portNum;
            changed = true;
          }
        }
      } else if (prevPort && Object.prototype.hasOwnProperty.call(data, "ansible_port")) {
        delete data.ansible_port;
        changed = true;
      }
      if (!changed) return;
      const nextYaml = YAML.stringify(data);
      hostVarsSyncRef.current = true;
      await writeWorkspaceFile(targetPath, nextYaml);
      if (activePath === targetPath) {
        setEditorValue(nextYaml);
        setEditorDirty(false);
      }
      await refreshFiles(workspaceId);
    } catch {
      // ignore
    } finally {
      hostVarsSyncRef.current = false;
    }
  };

  const syncCredentialsFromHostVars = async (editorDirty: boolean) => {
    if (!workspaceId || !hostVarsPath) return;
    if (!onCredentialsPatch) return;
    if (hostVarsSyncRef.current) return;
    if (activePath === hostVarsPath && editorDirty) return;
    try {
      const content = await readWorkspaceFile(hostVarsPath);
      const data = (YAML.parse(content) ?? {}) as Record<string, any>;
      const patch = buildCredentialsPatchFromHostVarsData(data, credentials);
      if (Object.keys(patch).length > 0) {
        onCredentialsPatch(patch);
      }
    } catch {
      // ignore
    }
  };

  const syncServerRequirementsFromCredentials = async () => {
    if (!workspaceId) return;
    if (!activeAlias) return;
    const alias = String(activeAlias || "").trim();
    if (!alias) return;

    const requirementServerType = String(credentials.requirementServerType || "")
      .trim()
      .toLowerCase();
    const requirementStorageGbRaw = String(credentials.requirementStorageGb || "").trim();
    const requirementStorageGbParsed = Number(requirementStorageGbRaw);
    const requirementStorageGb =
      requirementStorageGbRaw &&
      Number.isFinite(requirementStorageGbParsed) &&
      requirementStorageGbParsed >= 0
        ? Math.floor(requirementStorageGbParsed)
        : null;
    const requirementLocation = String(credentials.requirementLocation || "").trim();

    const requirements: Record<string, any> = {};
    if (requirementServerType) requirements.server_type = requirementServerType;
    if (requirementStorageGb != null) requirements.storage_gb = requirementStorageGb;
    if (requirementLocation) requirements.location = requirementLocation;

    const url = `${baseUrl}/api/workspaces/${workspaceId}/servers/${encodeURIComponent(
      alias
    )}/requirements`;
    try {
      const method = Object.keys(requirements).length === 0 ? "DELETE" : "PUT";
      await fetch(url, {
        method,
        headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
        body: method === "PUT" ? JSON.stringify({ requirements }) : undefined,
      });
    } catch {
      // ignore requirements sync errors
    }
  };

  return {
    generateInventory,
    resolveTargetRoles,
    renameAliasInInventory,
    removeAliasFromInventory,
    syncInventoryWithSelection,
    syncSelectionFromInventory,
    syncHostVarsFromCredentials,
    syncCredentialsFromHostVars,
    syncServerRequirementsFromCredentials,
  };
}
