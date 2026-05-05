import YAML from "yaml";
import {
  encodePath,
  extensionForPath,
  extractRolesByAlias,
  rolesByAliasKey,
} from "../../utils";

export function createWorkspacePanelEditorActions(ctx: any) {
  const {
    baseUrl,
    workspaceId,
    activePath,
    selectedRolesByAlias,
    onSelectedRolesByAliasChange,
    kdbxPasswordRef,
    kdbxArgonReadyRef,
    inventorySeededRef,
    mergeRolesByAlias,
    normalizeRoles,
    readWorkspaceFile,
    refreshFiles,
    setActivePath,
    setEditorValue,
    setEditorDirty,
    setEditorLoading,
    setEditorError,
    setEditorStatus,
    setKdbxEntries,
    setKdbxError,
    setKdbxLoading,
    setKdbxPromptOpen,
    setKdbxRevealed,
    collectKdbxEntries,
  } = ctx;

  const lockKdbx = () => {
    kdbxPasswordRef.current = "";
    setKdbxEntries([]);
    setKdbxError(null);
    setKdbxRevealed({});
  };

  const loadKdbx = async (path: string, masterPassword: string) => {
    if (!workspaceId) return;
    setKdbxLoading(true);
    setKdbxError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/download/${encodePath(path)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buffer = await res.arrayBuffer();
      const kdbxMod = await import("kdbxweb");
      const kdbx = (kdbxMod as any).default ?? kdbxMod;
      if (!kdbxArgonReadyRef.current) {
        const argonMod = await import("argon2-browser/dist/argon2-bundled.min.js");
        let argon2Impl =
          (argonMod as any).argon2 || (argonMod as any).default || (argonMod as any);
        if (typeof argon2Impl === "function" && !argon2Impl?.hash) {
          try {
            const resolved = await (argon2Impl as any)();
            if (resolved?.hash) {
              argon2Impl = resolved;
            }
          } catch {
            // ignore and fall back to global argon2 if available
          }
        }
        if (!argon2Impl?.hash && (globalThis as any).argon2?.hash) {
          argon2Impl = (globalThis as any).argon2;
        }
        if (!argon2Impl?.hash) {
          throw new Error("Argon2 implementation missing");
        }
        const engine =
          kdbx?.CryptoEngine ||
          kdbx?.crypto ||
          (kdbxMod as any).CryptoEngine ||
          (kdbxMod as any).crypto;
        if (engine?.setArgon2Impl) {
          const argon2Wrapper = async (
            password: ArrayBuffer,
            salt: ArrayBuffer,
            memory: number,
            iterations: number,
            length: number,
            parallelism: number,
            type: number,
            version: number
          ) => {
            const result = await argon2Impl.hash({
              pass: new Uint8Array(password),
              salt: new Uint8Array(salt),
              time: iterations,
              mem: memory,
              hashLen: length,
              parallelism,
              type,
              version,
              raw: true,
            });
            return result?.hash;
          };
          engine.setArgon2Impl(argon2Wrapper);
          kdbxArgonReadyRef.current = true;
        } else {
          throw new Error("Argon2 engine not available");
        }
      }
      const creds = new kdbx.Credentials(kdbx.ProtectedValue.fromString(masterPassword));
      const db = await kdbx.Kdbx.load(buffer, creds);
      const entries: any[] = [];
      const rootGroup =
        typeof db.getDefaultGroup === "function"
          ? db.getDefaultGroup()
          : Array.isArray(db.groups)
            ? db.groups[0]
            : null;
      if (rootGroup) {
        collectKdbxEntries(rootGroup, [], entries);
      } else if (Array.isArray(db.groups)) {
        db.groups.forEach((group: any) => collectKdbxEntries(group, [], entries));
      }
      setKdbxEntries(entries);
    } catch (err: any) {
      setKdbxError(err?.message ?? "failed to open kdbx");
    } finally {
      setKdbxLoading(false);
      setEditorLoading(false);
    }
  };

  const handleKdbxSubmit = (masterPassword: string) => {
    setKdbxPromptOpen(false);
    kdbxPasswordRef.current = masterPassword;
    if (activePath) {
      void loadKdbx(activePath, masterPassword);
    }
  };

  const loadFile = async (path: string) => {
    if (!workspaceId) return;
    setEditorLoading(true);
    setEditorError(null);
    setEditorStatus(null);
    try {
      const kind = extensionForPath(path);
      if (kind === "kdbx") {
        setActivePath(path);
        setEditorValue("");
        setEditorDirty(false);
        setKdbxError(null);
        setKdbxEntries([]);
        if (kdbxPasswordRef.current) {
          await loadKdbx(path, kdbxPasswordRef.current);
        } else {
          setEditorLoading(false);
          setKdbxPromptOpen(true);
        }
        return;
      }
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setActivePath(path);
      setEditorValue(String(data?.content ?? ""));
      setEditorDirty(false);
    } catch (err: any) {
      setEditorError(err?.message ?? "failed to load file");
    } finally {
      setEditorLoading(false);
    }
  };

  const validateEditor = (editorValue: string, currentPath: string | null) => {
    if (!currentPath) return null;
    const kind = extensionForPath(currentPath);
    try {
      if (kind === "json") {
        JSON.parse(editorValue);
      } else if (kind === "yaml") {
        YAML.parse(editorValue);
      }
      return null;
    } catch (err: any) {
      return err?.message ?? "invalid content";
    }
  };

  const saveFile = async (editorValue: string, editorDirty: boolean) => {
    if (!workspaceId || !activePath) return false;
    const validationError = validateEditor(editorValue, activePath);
    if (validationError) {
      setEditorError(validationError);
      return false;
    }
    setEditorLoading(true);
    setEditorError(null);
    setEditorStatus(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(activePath)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editorValue }),
        }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (activePath === "inventory.yml") {
        inventorySeededRef.current = false;
      }
      setEditorDirty(false);
      setEditorStatus("Saved.");
      await refreshFiles(workspaceId);
      if (activePath === "inventory.yml" && onSelectedRolesByAliasChange) {
        const rolesByAlias = extractRolesByAlias(editorValue);
        const merged = mergeRolesByAlias(rolesByAlias);
        if (rolesByAliasKey(merged) !== rolesByAliasKey(selectedRolesByAlias)) {
          onSelectedRolesByAliasChange(merged);
        }
      }
      return true;
    } catch (err: any) {
      setEditorError(err?.message ?? "failed to save");
      return false;
    } finally {
      setEditorLoading(false);
    }
  };

  return {
    lockKdbx,
    loadKdbx,
    handleKdbxSubmit,
    loadFile,
    validateEditor,
    saveFile,
  };
}
