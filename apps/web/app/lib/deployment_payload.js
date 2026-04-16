import { validateForm } from "./deploy_form.js";

/**
 * @param {object} args
 * @param {object | null} args.activeServer
 * @param {Record<string, string[]>} args.selectedRolesByAlias
 * @param {string[]} args.selectedAliases
 * @param {string[]} args.selectableAliases
 * @param {string[]} [args.roleFilter]
 * @param {string | null} args.workspaceId
 * @param {boolean} args.inventoryReady
 * @param {string} [args.infinitoNexusVersion]
 */
export function buildDeploymentPayload({
  activeServer,
  selectedRolesByAlias,
  selectedAliases,
  selectableAliases,
  roleFilter,
  workspaceId,
  inventoryReady,
  infinitoNexusVersion,
}) {
  const server = activeServer || {};
  const credentials = {
    alias: server.alias || "",
    host: server.host || "",
    port: server.port || "",
    user: server.user || "",
    authMethod: server.authMethod || "password",
    password: server.password || "",
    privateKey: server.privateKey || "",
    keyPassphrase: server.keyPassphrase || "",
  };

  const errors = { ...validateForm(credentials) };

  const rolesByAlias = selectedRolesByAlias || {};
  const normalizedSelected = Array.from(
    new Set((selectedAliases || []).map((alias) => String(alias || "").trim()))
  ).filter(Boolean);
  let rolesFromAliases = [];
  const seen = new Set();
  normalizedSelected.forEach((alias) => {
    const list = rolesByAlias?.[alias] || [];
    (Array.isArray(list) ? list : []).forEach((role) => {
      const r = String(role ?? "").trim();
      if (r && !seen.has(r)) {
        seen.add(r);
        rolesFromAliases.push(r);
      }
    });
  });

  const normalizedRoleFilter = Array.from(
    new Set((roleFilter || []).map((role) => String(role || "").trim()))
  ).filter(Boolean);
  const roles =
    normalizedRoleFilter.length > 0 ? normalizedRoleFilter : rolesFromAliases;

  if (roles.length === 0) {
    errors.selectedRoles = "Select at least one role.";
  }

  if (!workspaceId) {
    errors.workspace = "Workspace is not ready yet.";
  }

  if (!inventoryReady) {
    errors.inventory = "Generate inventory in Workspace & Files first.";
  }

  if (normalizedSelected.length === 0) {
    errors.deployScope = "Select at least one device to deploy.";
  }

  const hasErrors = Object.keys(errors).length > 0;
  if (hasErrors) {
    return { payload: null, errors };
  }

  const auth = { method: credentials.authMethod };
  if (credentials.authMethod === "password") {
    auth.password = String(credentials.password ?? "");
  }
  if (credentials.authMethod === "private_key") {
    auth.private_key = String(credentials.privateKey ?? "");
    if (credentials.keyPassphrase) {
      auth.passphrase = String(credentials.keyPassphrase ?? "");
    }
  }

  const payload = {
    workspace_id: workspaceId,
    host: String(credentials.host ?? "").trim(),
    user: String(credentials.user ?? "").trim(),
    auth,
    selected_roles: roles,
  };
  const normalizedVersion = String(infinitoNexusVersion ?? "").trim();
  if (normalizedVersion) {
    payload.infinito_nexus_version = normalizedVersion;
  }

  const portRaw = String(credentials.port ?? "").trim();
  if (portRaw) {
    const portNum = Number(portRaw);
    if (Number.isInteger(portNum)) {
      payload.port = portNum;
    }
  }

  const selectable = Array.from(
    new Set((selectableAliases || []).map((alias) => String(alias || "").trim()))
  ).filter(Boolean);
  const allSelectableSelected =
    selectable.length > 0 &&
    selectable.every((alias) => normalizedSelected.includes(alias));
  if (!allSelectableSelected) {
    payload.limit = normalizedSelected.join(",");
  }

  return {
    payload,
    errors: {},
  };
}
