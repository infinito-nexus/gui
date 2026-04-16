import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import YAML from "yaml";
import type { UsersAction } from "./types";
import {
  USERS_GROUP_VARS_PATH,
  USERNAME_PATTERN,
  asTrimmed,
  dedupeWorkspaceUsers,
  emptyUserForm,
  extractWorkspaceUsers,
  isRecord,
  normalizeWorkspaceUser,
  parseOptionalInt,
  parseOptionalObject,
  parseStringList,
  parseUsersFromCsv,
  syncPricingUsersStorage,
  toYamlUsersMap,
  userToForm,
  usersToCsv,
  type WorkspaceUser,
  type WorkspaceUserForm,
} from "./users-utils";
import { encodePath } from "./utils";

type Args = {
  baseUrl: string;
  workspaceId: string | null;
  readApiDetail: (res: Response) => Promise<string>;
  refreshFiles: (workspaceId: string) => Promise<void>;
};
export function useWorkspaceUsers({
  baseUrl,
  workspaceId,
  readApiDetail,
  refreshFiles,
}: Args) {
  const [usersOverviewOpen, setUsersOverviewOpen] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSaving, setUsersSaving] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersStatus, setUsersStatus] = useState<string | null>(null);
  const [usersDraft, setUsersDraft] = useState<WorkspaceUser[]>([]);
  const [usersSelection, setUsersSelection] = useState<Record<string, boolean>>({});
  const [usersDoc, setUsersDoc] = useState<Record<string, unknown>>({});
  const [userForm, setUserForm] = useState<WorkspaceUserForm>(() => emptyUserForm());
  const [usersEditorMode, setUsersEditorMode] = useState<"create" | "edit">("create");
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [userEntryModalOpen, setUserEntryModalOpen] = useState(false);
  const usersImportInputRef = useRef<HTMLInputElement | null>(null);
  const usersImportFormatRef = useRef<"csv" | "yaml" | null>(null);

  const readWorkspaceUsers = async (): Promise<{
    doc: Record<string, unknown>;
    users: WorkspaceUser[];
  }> => {
    if (!workspaceId) {
      throw new Error("Workspace is not ready.");
    }
    const res = await fetch(
      `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(USERS_GROUP_VARS_PATH)}`,
      { cache: "no-store" }
    );
    if (res.status === 404) {
      return { doc: {}, users: [] };
    }
    if (!res.ok) {
      throw new Error(await readApiDetail(res));
    }
    const data = await res.json();
    const content = String(data?.content ?? "");
    if (!content.trim()) {
      return { doc: {}, users: [] };
    }
    let parsed: unknown = {};
    try {
      parsed = YAML.parse(content) ?? {};
    } catch {
      throw new Error("group_vars/all.yml is not valid YAML.");
    }
    const doc = isRecord(parsed) ? { ...parsed } : {};
    return {
      doc,
      users: extractWorkspaceUsers(doc.users),
    };
  };
  const downloadUsersExport = (
    filename: string,
    content: string,
    mimeType: string
  ) => {
    if (typeof window === "undefined") return;
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 0);
  };

  const exportUsersYaml = (users: WorkspaceUser[] = usersDraft) => {
    const yamlExport = YAML.stringify({
      users: toYamlUsersMap(users),
    });
    downloadUsersExport("users.yml", yamlExport, "application/x-yaml");
  };

  const exportUsersCsv = (users: WorkspaceUser[] = usersDraft) => {
    downloadUsersExport("users.csv", usersToCsv(users), "text/csv;charset=utf-8");
  };

  const triggerUsersImport = (format: "csv" | "yaml") => {
    usersImportFormatRef.current = format;
    window.setTimeout(() => {
      usersImportInputRef.current?.click();
    }, 0);
  };
  const startCreateUserEditor = () => {
    setUsersEditorMode("create");
    setEditingUsername(null);
    setUserForm(emptyUserForm());
    setUserEntryModalOpen(true);
    setUsersError(null);
    setUsersStatus("Create a new user.");
  };

  const openUsersEditor = async (action: UsersAction = "overview") => {
    if (!workspaceId) return;
    setUsersOverviewOpen(action !== "add");
    setUsersLoading(true);
    setUsersSaving(false);
    setUsersError(null);
    setUsersStatus(null);
    setUsersEditorMode("create");
    setEditingUsername(null);
    setUserEntryModalOpen(false);
    setUserForm(emptyUserForm());
    try {
      const { doc, users } = await readWorkspaceUsers();
      setUsersDoc(doc);
      setUsersDraft(users);
      const nextSelection: Record<string, boolean> = {};
      users.forEach((user) => {
        nextSelection[user.username] = false;
      });
      setUsersSelection(nextSelection);
      syncPricingUsersStorage(users);
      if (action === "export-csv") {
        exportUsersCsv(users);
        setUsersStatus("Users exported as CSV.");
      } else if (action === "export-yaml") {
        exportUsersYaml(users);
        setUsersStatus("Users exported as YML.");
      } else if (action === "import-csv") {
        triggerUsersImport("csv");
      } else if (action === "import-yaml") {
        triggerUsersImport("yaml");
      } else if (action === "add") {
        startCreateUserEditor();
      }
    } catch (err: any) {
      setUsersDoc({});
      setUsersDraft([]);
      setUsersError(err?.message ?? "Failed to load users from group_vars/all.yml.");
    } finally {
      setUsersLoading(false);
    }
  };

  const closeUsersEditor = () => {
    if (usersSaving) return;
    setUsersOverviewOpen(false);
    setUsersLoading(false);
    setUsersError(null);
    setUsersStatus(null);
    setUsersEditorMode("create");
    setEditingUsername(null);
    setUserEntryModalOpen(false);
    setUserForm(emptyUserForm());
    usersImportFormatRef.current = null;
    if (usersImportInputRef.current) {
      usersImportInputRef.current.value = "";
    }
  };

  const startEditUserEditor = (username: string) => {
    const target = usersDraft.find((entry) => entry.username === username);
    if (!target) {
      setUsersError(`User '${username}' not found.`);
      return;
    }
    setUsersEditorMode("edit");
    setEditingUsername(target.username);
    setUserForm(userToForm(target));
    setUserEntryModalOpen(true);
    setUsersError(null);
    setUsersStatus(`Editing user '${target.username}'.`);
  };

  const closeUserEntryModal = () => {
    if (usersSaving) return;
    setUserEntryModalOpen(false);
  };

  const applyUserEditor = () => {
    const username = asTrimmed(userForm.username).toLowerCase();
    const firstname = asTrimmed(userForm.firstname);
    const lastname = asTrimmed(userForm.lastname);
    if (!USERNAME_PATTERN.test(username)) {
      setUsersError("Username must match a-z0-9.");
      return;
    }
    if (!firstname || !lastname) {
      setUsersError("Firstname and lastname are required.");
      return;
    }

    const email = asTrimmed(userForm.email);
    const password = asTrimmed(userForm.password);
    const uid = parseOptionalInt(userForm.uid);
    const gid = parseOptionalInt(userForm.gid);
    const roles = parseStringList(userForm.roles);
    const authorizedKeys = parseStringList(userForm.authorized_keys);
    const tokens = parseOptionalObject(userForm.tokens);
    if (asTrimmed(userForm.tokens) && !tokens) {
      setUsersError("Tokens must be a YAML/JSON object.");
      return;
    }
    const description = asTrimmed(userForm.description);

    const nextUser: WorkspaceUser = {
      username,
      firstname,
      lastname,
      ...(email ? { email } : {}),
      ...(password ? { password } : {}),
      ...(uid !== undefined ? { uid } : {}),
      ...(gid !== undefined ? { gid } : {}),
      ...(roles?.length ? { roles } : {}),
      ...(tokens ? { tokens } : {}),
      ...(authorizedKeys?.length ? { authorized_keys: authorizedKeys } : {}),
      ...(userForm.reserved === "true"
        ? { reserved: true }
        : userForm.reserved === "false"
          ? { reserved: false }
          : {}),
      ...(description ? { description } : {}),
    };

    const editingKey = usersEditorMode === "edit" ? editingUsername : null;
    if (editingKey) {
      if (
        username !== editingKey &&
        usersDraft.some((entry) => entry.username === username)
      ) {
        setUsersError(`User '${username}' already exists.`);
        return;
      }
    } else if (usersDraft.some((entry) => entry.username === username)) {
      setUsersError(`User '${username}' already exists.`);
      return;
    }

    let nextDraft: WorkspaceUser[];
    if (editingKey) {
      nextDraft = usersDraft.map((entry) =>
        entry.username === editingKey ? nextUser : entry
      );
      setUsersEditorMode("edit");
      setEditingUsername(nextUser.username);
      setUsersStatus(`User '${nextUser.username}' updated. Save to persist changes.`);
    } else {
      nextDraft = [...usersDraft, nextUser];
      setUsersEditorMode("create");
      setEditingUsername(null);
      setUserForm(emptyUserForm());
      setUsersStatus(`User '${nextUser.username}' added. Save to persist changes.`);
    }

    setUsersDraft(nextDraft);
    setUsersSelection((prev) => {
      const next = { ...prev };
      if (editingKey && editingKey !== nextUser.username) {
        delete next[editingKey];
      }
      if (!Object.prototype.hasOwnProperty.call(next, nextUser.username)) {
        next[nextUser.username] = false;
      }
      return next;
    });
    syncPricingUsersStorage(nextDraft);
    setUsersError(null);
    setUserEntryModalOpen(false);
  };

  const removeUserDraft = (username: string) => {
    setUsersDraft((prev) => {
      const next = prev.filter((entry) => entry.username !== username);
      syncPricingUsersStorage(next);
      return next;
    });
    setUsersSelection((prev) => {
      const next = { ...prev };
      delete next[username];
      return next;
    });
    setUsersError(null);
    setUsersStatus(`User '${username}' removed. Save to persist changes.`);
    if (editingUsername === username) {
      setUsersEditorMode("create");
      setEditingUsername(null);
      setUserForm(emptyUserForm());
      setUserEntryModalOpen(false);
    }
  };

  const toggleUserSelection = (username: string, checked: boolean) => {
    setUsersSelection((prev) => ({ ...prev, [username]: checked }));
  };

  const setUsersSelectionAll = (checked: boolean) => {
    setUsersSelection((prev) => {
      const next = { ...prev };
      usersDraft.forEach((user) => {
        next[user.username] = checked;
      });
      return next;
    });
  };

  const deleteSelectedUsers = () => {
    const selected = usersDraft
      .map((user) => user.username)
      .filter((username) => Boolean(usersSelection[username]));
    if (selected.length === 0) {
      setUsersError("No users selected.");
      return;
    }
    setUsersDraft((prev) => {
      const next = prev.filter((entry) => !selected.includes(entry.username));
      syncPricingUsersStorage(next);
      return next;
    });
    setUsersSelection((prev) => {
      const next = { ...prev };
      selected.forEach((username) => {
        delete next[username];
      });
      return next;
    });
    setUsersError(null);
    setUsersStatus(`${selected.length} user(s) removed. Save to persist changes.`);
    if (editingUsername && selected.includes(editingUsername)) {
      setUsersEditorMode("create");
      setEditingUsername(null);
      setUserForm(emptyUserForm());
      setUserEntryModalOpen(false);
    }
  };

  const handleUsersImportSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const format =
      usersImportFormatRef.current ||
      (fileName.endsWith(".csv") ? "csv" : "yaml");

    setUsersError(null);
    setUsersStatus(null);
    try {
      const text = await file.text();
      let importedUsers: WorkspaceUser[] = [];
      if (format === "csv") {
        importedUsers = parseUsersFromCsv(text);
      } else {
        const parsed = YAML.parse(text);
        if (isRecord(parsed) && "users" in parsed) {
          importedUsers = extractWorkspaceUsers(parsed.users);
        } else {
          importedUsers = extractWorkspaceUsers(parsed);
        }
      }
      const uniqueUsers = dedupeWorkspaceUsers(importedUsers);
      if (uniqueUsers.length === 0) {
        setUsersError("Import contains no valid users.");
        return;
      }
      setUsersDraft(uniqueUsers);
      const nextSelection: Record<string, boolean> = {};
      uniqueUsers.forEach((user) => {
        nextSelection[user.username] = false;
      });
      setUsersSelection(nextSelection);
      syncPricingUsersStorage(uniqueUsers);
      setUsersEditorMode("create");
      setEditingUsername(null);
      setUserForm(emptyUserForm());
      setUsersStatus(
        `Imported ${uniqueUsers.length} user(s). Save to write ${USERS_GROUP_VARS_PATH}.`
      );
    } catch {
      setUsersError("Failed to import users. Check file format.");
    } finally {
      usersImportFormatRef.current = null;
    }
  };

  const saveWorkspaceUsers = async () => {
    if (!workspaceId) return;
    const uniqueUsers = dedupeWorkspaceUsers(
      usersDraft
        .map((entry) => normalizeWorkspaceUser(entry))
        .filter((entry): entry is WorkspaceUser => Boolean(entry))
    );
    const invalidCount = usersDraft.length - uniqueUsers.length;
    if (invalidCount > 0) {
      setUsersError("Fix invalid users first (username a-z0-9, firstname, lastname).");
      return;
    }

    const nextDoc = isRecord(usersDoc) ? { ...usersDoc } : {};
    nextDoc.users = toYamlUsersMap(uniqueUsers);
    const content = YAML.stringify(nextDoc);

    setUsersSaving(true);
    setUsersError(null);
    setUsersStatus(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/files/${encodePath(USERS_GROUP_VARS_PATH)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (!res.ok) {
        throw new Error(await readApiDetail(res));
      }
      setUsersDoc(nextDoc);
      setUsersDraft(uniqueUsers);
      const nextSelection: Record<string, boolean> = {};
      uniqueUsers.forEach((user) => {
        nextSelection[user.username] = false;
      });
      setUsersSelection(nextSelection);
      syncPricingUsersStorage(uniqueUsers);
      await refreshFiles(workspaceId);
      setUsersStatus(`Saved ${uniqueUsers.length} user(s) to ${USERS_GROUP_VARS_PATH}.`);
    } catch (err: any) {
      setUsersError(err?.message ?? "Failed to save users.");
    } finally {
      setUsersSaving(false);
    }
  };

  const selectedUsersCount = usersDraft.reduce(
    (sum, user) => sum + (usersSelection[user.username] ? 1 : 0),
    0
  );

  return {
    usersOverviewOpen,
    usersLoading,
    usersSaving,
    usersError,
    usersStatus,
    usersDraft,
    usersSelection,
    userForm,
    usersEditorMode,
    editingUsername,
    userEntryModalOpen,
    usersImportInputRef,
    selectedUsersCount,
    openUsersEditor,
    closeUsersEditor,
    startCreateUserEditor,
    startEditUserEditor,
    closeUserEntryModal,
    applyUserEditor,
    removeUserDraft,
    toggleUserSelection,
    setUsersSelectionAll,
    deleteSelectedUsers,
    handleUsersImportSelect,
    saveWorkspaceUsers,
    setUserForm,
  };
}
