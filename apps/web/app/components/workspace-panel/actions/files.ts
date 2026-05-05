import type { ChangeEvent, MouseEvent } from "react";
import { encodePath } from "../utils";

type ZipImportMode = "override" | "merge";

type ZipImportUploadOptions = {
  defaultMode?: ZipImportMode;
  perFileMode?: Record<string, ZipImportMode>;
};

type ZipImportUploadResult = {
  ok: boolean;
  error?: string;
};

type ZipImportPreviewEntry = {
  path: string;
  exists: boolean;
};

export function createWorkspacePanelFileActions(ctx: any) {
  const {
    baseUrl,
    workspaceId,
    uploadBusy,
    activePath,
    uploadInputRef,
    setZipBusy,
    setZipError,
    setWorkspaceError,
    setUploadBusy,
    setUploadError,
    setUploadStatus,
    setFileOpError,
    setActivePath,
    setEditorValue,
    setEditorDirty,
    setContextMenu,
    setEditorMenu,
    refreshFiles,
    loadFile,
  } = ctx;

  const downloadZip = async () => {
    if (!workspaceId) return;
    setZipBusy(true);
    setZipError(null);
    try {
      const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/download.zip`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workspace-${workspaceId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setZipError(err?.message ?? "failed to download zip");
    } finally {
      setZipBusy(false);
    }
  };

  const downloadFile = async (path: string) => {
    if (!workspaceId) return;
    setWorkspaceError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/download/${encodePath(path)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err: any) {
      setWorkspaceError(err?.message ?? "failed to download file");
    }
  };

  const previewZip = async (file: File): Promise<ZipImportPreviewEntry[]> => {
    if (!workspaceId) return [];
    const name = file?.name || "";
    if (!name.toLowerCase().endsWith(".zip")) {
      throw new Error("Please select a .zip file.");
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/upload.zip/preview`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.detail) message = data.detail;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    const data = await res.json();
    const files = Array.isArray(data?.files) ? data.files : [];
    return files
      .map((entry: any) => ({
        path: String(entry?.path || "").trim(),
        exists: Boolean(entry?.exists),
      }))
      .filter((entry: ZipImportPreviewEntry) => Boolean(entry.path));
  };

  const uploadZip = async (
    file: File,
    options?: ZipImportUploadOptions
  ): Promise<ZipImportUploadResult> => {
    if (!workspaceId || uploadBusy) {
      return { ok: false, error: "Upload is currently unavailable." };
    }
    const name = file?.name || "";
    if (!name.toLowerCase().endsWith(".zip")) {
      const message = "Please select a .zip file.";
      setUploadError(message);
      return { ok: false, error: message };
    }
    const defaultMode: ZipImportMode =
      options?.defaultMode === "merge" ? "merge" : "override";
    const rawPerFileMode = options?.perFileMode || {};
    const perFileMode: Record<string, ZipImportMode> = {};
    Object.entries(rawPerFileMode).forEach(([path, mode]) => {
      const relPath = String(path || "").trim();
      if (!relPath) return;
      perFileMode[relPath] = mode === "merge" ? "merge" : "override";
    });

    setUploadBusy(true);
    setUploadError(null);
    setUploadStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("default_mode", defaultMode);
      form.append("per_file_mode_json", JSON.stringify(perFileMode));
      const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/upload.zip`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const data = await res.json();
      const created = Number(data?.created_files ?? 0);
      const overridden = Number(data?.overridden_files ?? 0);
      const merged = Number(data?.merged_files ?? 0);
      const skipped = Number(data?.skipped_files ?? 0);
      const parts: string[] = [];
      if (created > 0) parts.push(`${created} created`);
      if (overridden > 0) parts.push(`${overridden} overridden`);
      if (merged > 0) parts.push(`${merged} merged`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      setUploadStatus(
        parts.length > 0
          ? `Workspace loaded (${parts.join(", ")}).`
          : "Workspace loaded."
      );
      await refreshFiles(workspaceId);
      return { ok: true };
    } catch (err: any) {
      const message = err?.message ?? "failed to upload zip";
      setUploadError(message);
      return { ok: false, error: message };
    } finally {
      setUploadBusy(false);
    }
  };

  const onUploadSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void uploadZip(file);
    }
    event.target.value = "";
  };

  const openUploadPicker = () => {
    uploadInputRef.current?.click();
  };

  const createFile = async (baseDir?: string) => {
    if (!workspaceId) return;
    const prefix = baseDir ? `${baseDir}/` : "";
    const input = window.prompt("Create file", prefix);
    if (!input) return;
    const raw = input.trim().replace(/^\/+/, "");
    if (!raw || raw.endsWith("/")) {
      setFileOpError("Provide a valid file path.");
      return;
    }
    const finalPath = baseDir && !raw.includes("/") ? `${baseDir}/${raw}` : raw;

    setFileOpError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(finalPath)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "" }),
        }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await refreshFiles(workspaceId);
      await loadFile(finalPath);
    } catch (err: any) {
      setFileOpError(err?.message ?? "failed to create file");
    }
  };

  const createDirectory = async (baseDir?: string) => {
    if (!workspaceId) return;
    const prefix = baseDir ? `${baseDir}/` : "";
    const input = window.prompt("Create folder", prefix);
    if (!input) return;
    const raw = input.trim().replace(/^\/+/, "");
    if (!raw) {
      setFileOpError("Provide a valid folder path.");
      return;
    }
    const normalized = raw.replace(/\/+$/, "");
    const finalPath =
      baseDir && !normalized.includes("/") ? `${baseDir}/${normalized}` : normalized;

    setFileOpError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(finalPath)}/mkdir`,
        { method: "POST" }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await refreshFiles(workspaceId);
    } catch (err: any) {
      setFileOpError(err?.message ?? "failed to create folder");
    }
  };

  const renameFile = async (path: string, isDir = false) => {
    if (!workspaceId) return;
    const currentName = path.split("/").pop() || path;
    const nextName = window.prompt(isDir ? "Rename folder" : "Rename file", currentName);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const dir = path.split("/").slice(0, -1).join("/");
    const normalized = trimmed.replace(/^\/+/, "");
    const nextPath = normalized.includes("/") ? normalized : dir ? `${dir}/${normalized}` : normalized;
    if (nextPath === path) return;

    setFileOpError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}/rename`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_path: nextPath }),
        }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      await refreshFiles(workspaceId);
      if (activePath === path) {
        await loadFile(nextPath);
      }
    } catch (err: any) {
      setFileOpError(err?.message ?? "failed to rename file");
    }
  };

  const deleteFile = async (path: string, isDir = false) => {
    if (!workspaceId) return;
    if (!window.confirm(isDir ? `Delete folder ${path}?` : `Delete file ${path}?`)) {
      return;
    }
    setFileOpError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(path)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.detail) message = data.detail;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      if (activePath && (activePath === path || (isDir && activePath.startsWith(`${path}/`)))) {
        setActivePath(null);
        setEditorValue("");
        setEditorDirty(false);
      }
      await refreshFiles(workspaceId);
    } catch (err: any) {
      setFileOpError(err?.message ?? "failed to delete file");
    }
  };

  const openContextMenu = (
    event: MouseEvent,
    path: string | null,
    isDir: boolean
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setEditorMenu(null);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      path: path ?? undefined,
      isDir,
    });
  };

  return {
    downloadZip,
    downloadFile,
    previewZip,
    uploadZip,
    onUploadSelect,
    openUploadPicker,
    createFile,
    createDirectory,
    renameFile,
    deleteFile,
    openContextMenu,
  };
}
