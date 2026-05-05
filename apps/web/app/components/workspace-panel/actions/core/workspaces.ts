import { encodePath } from "../../utils";

export function createWorkspacePanelWorkspaceActions(ctx: any) {
  const {
    baseUrl,
    userId,
    openDirs,
    workspaceId,
    setUserId,
    setWorkspaceList,
    setWorkspaceId,
    setWorkspaceLoading,
    setWorkspaceError,
    setFiles,
    setOpenDirs,
    onWorkspaceIdChange,
    syncInventoryReady,
    resetWorkspaceState,
    rememberWorkspace,
    updateWorkspaceUrl,
    readQueryParam,
    saveWorkspaceList,
    loadWorkspaceList,
    WORKSPACE_STORAGE_KEY,
    USER_WORKSPACE_CURRENT_PREFIX,
  } = ctx;

  const normalizeWorkspaceList = (items: any[]): any[] =>
    (Array.isArray(items) ? items : [])
      .map((entry) => {
        const workspaceId = String(entry?.workspace_id || entry?.id || "").trim();
        if (!workspaceId) return null;
        return {
          id: workspaceId,
          name: String(entry?.name || workspaceId),
          state: String(entry?.state || "draft").toLowerCase(),
          created_at: entry?.created_at ?? null,
          last_modified_at: entry?.last_modified_at ?? null,
          last_used: entry?.last_used ?? null,
        };
      })
      .filter(Boolean);

  const fetchWorkspaceListFromApi = async (): Promise<{
    supported: boolean;
    authenticated: boolean;
    userId: string | null;
    workspaces: any[];
    unauthorized: boolean;
  }> => {
    try {
      const res = await fetch(`${baseUrl}/api/workspaces`, { cache: "no-store" });
      if (res.status === 404) {
        return {
          supported: false,
          authenticated: false,
          userId: null,
          workspaces: [],
          unauthorized: false,
        };
      }
      if (res.status === 401) {
        return {
          supported: true,
          authenticated: false,
          userId: null,
          workspaces: [],
          unauthorized: true,
        };
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const authenticated = Boolean(data?.authenticated);
      const resolvedUserId = String(data?.user_id || "").trim() || null;
      const workspaces = normalizeWorkspaceList(data?.workspaces);
      if (authenticated && resolvedUserId && setUserId) {
        setUserId(resolvedUserId);
      }
      return {
        supported: true,
        authenticated,
        userId: resolvedUserId,
        workspaces,
        unauthorized: false,
      };
    } catch {
      return {
        supported: false,
        authenticated: false,
        userId: null,
        workspaces: [],
        unauthorized: false,
      };
    }
  };

  const refreshWorkspaceListFromApi = async (): Promise<any[] | null> => {
    const data = await fetchWorkspaceListFromApi();
    if (!data.supported) return null;
    if (!data.authenticated) {
      setWorkspaceList([]);
      return [];
    }
    setWorkspaceList(data.workspaces);
    if (data.userId) {
      saveWorkspaceList(data.userId, data.workspaces);
    }
    return data.workspaces;
  };

  const refreshFiles = async (id: string) => {
    const res = await fetch(`${baseUrl}/api/workspaces/${id}/files`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const nextFiles = Array.isArray(data?.files) ? data.files : [];
    setFiles(nextFiles);
    syncInventoryReady(nextFiles);
    if (openDirs.size === 0) {
      const dirs = new Set<string>(
        nextFiles.filter((f: any) => f.is_dir).map((f: any) => f.path)
      );
      setOpenDirs(dirs);
    }
  };

  const selectWorkspace = async (id: string): Promise<boolean> => {
    if (!id) return false;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    resetWorkspaceState();
    try {
      await refreshFiles(id);
      setWorkspaceId(id);
      onWorkspaceIdChange?.(id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
        if (userId) {
          window.localStorage.setItem(`${USER_WORKSPACE_CURRENT_PREFIX}${userId}`, id);
        }
      }
      updateWorkspaceUrl(id);
      return true;
    } catch (err: any) {
      setWorkspaceError(err?.message ?? "workspace not found");
      return false;
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const createWorkspace = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const res = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const id = String(data?.workspace_id ?? "");
      if (!id) {
        throw new Error("workspace id missing");
      }
      resetWorkspaceState();
      setWorkspaceId(id);
      onWorkspaceIdChange?.(id);
      await refreshFiles(id);
      const apiContext = await fetchWorkspaceListFromApi();
      if (apiContext.supported) {
        if (apiContext.authenticated) {
          setWorkspaceList(apiContext.workspaces);
          if (apiContext.userId) {
            saveWorkspaceList(apiContext.userId, apiContext.workspaces);
            if (typeof window !== "undefined") {
              window.localStorage.setItem(`${USER_WORKSPACE_CURRENT_PREFIX}${apiContext.userId}`, id);
            }
          }
        } else {
          setWorkspaceList([]);
        }
      }
      if (userId && !apiContext.supported) {
        rememberWorkspace(id, data?.created_at ?? null);
      } else if (typeof window !== "undefined") {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
      }
      updateWorkspaceUrl(id);
    } catch (err: any) {
      setWorkspaceError(err?.message ?? "failed to create workspace");
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const initWorkspace = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const requested = readQueryParam("workspace");
      const apiListData = await fetchWorkspaceListFromApi();
      const apiAuthenticated = apiListData.supported && apiListData.authenticated;
      const apiUserId = apiListData.userId || userId || null;

      if (apiAuthenticated) {
        const list = apiListData.workspaces;
        setWorkspaceList(list);
        if (apiUserId) {
          saveWorkspaceList(apiUserId, list);
        }
        if (list.length === 0) {
          resetWorkspaceState();
          setWorkspaceId(null);
          onWorkspaceIdChange?.(null);
          updateWorkspaceUrl(null);
          if (apiUserId && typeof window !== "undefined") {
            window.localStorage.removeItem(`${USER_WORKSPACE_CURRENT_PREFIX}${apiUserId}`);
          }
          return;
        }
        const storedCurrent =
          typeof window !== "undefined" && apiUserId
            ? window.localStorage.getItem(`${USER_WORKSPACE_CURRENT_PREFIX}${apiUserId}`)
            : null;
        const candidates = [requested, storedCurrent, list[0]?.id].filter(Boolean) as string[];
        for (const candidate of candidates) {
          const ok = await selectWorkspace(candidate);
          if (ok) return;
          if (requested && candidate === requested) {
            setWorkspaceError(`Workspace '${requested}' not found.`);
          }
        }
        await createWorkspace();
        return;
      }

      if (apiListData.supported) {
        if (userId && setUserId) {
          setUserId(null);
          setWorkspaceList([]);
          return;
        }
        setWorkspaceList([]);
      }

      if (userId && !apiListData.supported) {
        const list = loadWorkspaceList(userId);
        setWorkspaceList(list);
        const storedCurrent =
          typeof window !== "undefined"
            ? window.localStorage.getItem(`${USER_WORKSPACE_CURRENT_PREFIX}${userId}`)
            : null;
        const candidates = [requested, storedCurrent, list[0]?.id].filter(Boolean) as string[];
        for (const candidate of candidates) {
          const ok = await selectWorkspace(candidate);
          if (ok) return;
          if (requested && candidate === requested) {
            setWorkspaceError(`Workspace '${requested}' not found.`);
          }
        }
        await createWorkspace();
        return;
      }

      if (requested) {
        const ok = await selectWorkspace(requested);
        if (ok) return;
        setWorkspaceError(`Workspace '${requested}' not found.`);
      }
      let id: string | null = null;
      if (typeof window !== "undefined") {
        id = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      }
      if (id) {
        const ok = await selectWorkspace(id);
        if (ok) return;
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        }
      }
      await createWorkspace();
    } catch (err: any) {
      setWorkspaceError(err?.message ?? "workspace init failed");
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const deleteWorkspace = async (id: string): Promise<void> => {
    const targetId = String(id || "").trim();
    if (!targetId) {
      throw new Error("workspace id is required");
    }
    const res = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.detail) {
          message = String(data.detail);
        }
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }

    const apiList = await refreshWorkspaceListFromApi();
    if (!apiList) {
      if (userId) {
        setWorkspaceList((prev: any[]) => {
          const next = prev.filter((entry) => entry.id !== targetId);
          saveWorkspaceList(userId, next);
          return next;
        });
      }
    }

    if (workspaceId === targetId) {
      resetWorkspaceState();
      setWorkspaceId(null);
      onWorkspaceIdChange?.(null);
      updateWorkspaceUrl(null);
      if (userId && typeof window !== "undefined") {
        window.localStorage.removeItem(`${USER_WORKSPACE_CURRENT_PREFIX}${userId}`);
      }

      const nextCandidate =
        (Array.isArray(apiList) ? apiList : []).find((entry) => entry.id !== targetId)?.id ||
        null;
      if (nextCandidate) {
        await selectWorkspace(nextCandidate);
      }
      return;
    }

    if (userId && typeof window !== "undefined") {
      const currentKey = `${USER_WORKSPACE_CURRENT_PREFIX}${userId}`;
      const currentValue = window.localStorage.getItem(currentKey);
      if (currentValue === targetId) {
        window.localStorage.removeItem(currentKey);
      }
    }
  };

  return {
    normalizeWorkspaceList,
    fetchWorkspaceListFromApi,
    refreshWorkspaceListFromApi,
    refreshFiles,
    selectWorkspace,
    createWorkspace,
    initWorkspace,
    deleteWorkspace,
  };
}
