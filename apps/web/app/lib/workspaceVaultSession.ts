const WORKSPACE_MASTER_PASSWORD_PREFIX = "infinito.workspace.master-password.";

function storageKey(workspaceId: string | null | undefined) {
  return `${WORKSPACE_MASTER_PASSWORD_PREFIX}${String(workspaceId || "").trim()}`;
}

function isBrowser() {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

export function getWorkspaceMasterPassword(
  workspaceId: string | null | undefined
) {
  const id = String(workspaceId || "").trim();
  if (!id || !isBrowser()) return "";
  return String(window.sessionStorage.getItem(storageKey(id)) || "").trim();
}

export function setWorkspaceMasterPassword(
  workspaceId: string | null | undefined,
  masterPassword: string
) {
  const id = String(workspaceId || "").trim();
  if (!id || !isBrowser()) return;
  const trimmed = String(masterPassword || "").trim();
  if (!trimmed) {
    window.sessionStorage.removeItem(storageKey(id));
    return;
  }
  window.sessionStorage.setItem(storageKey(id), trimmed);
}

export function clearWorkspaceMasterPassword(
  workspaceId: string | null | undefined
) {
  const id = String(workspaceId || "").trim();
  if (!id || !isBrowser()) return;
  window.sessionStorage.removeItem(storageKey(id));
}

export function promptWorkspaceMasterPassword(
  workspaceId: string | null | undefined,
  message = "Master password for credentials.kdbx"
) {
  const value = window.prompt(message);
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("Master password is required.");
  }
  setWorkspaceMasterPassword(workspaceId, trimmed);
  return trimmed;
}
