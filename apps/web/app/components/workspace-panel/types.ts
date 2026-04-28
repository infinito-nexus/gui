export type FileEntry = {
  path: string;
  is_dir: boolean;
  size?: number | null;
  modified_at?: string | null;
};

export type CredentialsState = {
  alias: string;
  description: string;
  primaryDomain: string;
  requirementServerType: string;
  requirementStorageGb: string;
  requirementLocation: string;
  host: string;
  port: string;
  user: string;
  color: string;
  logoEmoji: string;
  authMethod: string;
};

export type WorkspacePanelProps = {
  baseUrl: string;
  selectedRolesByAlias: Record<string, string[]>;
  credentials: CredentialsState;
  onCredentialsPatch?: (patch: Partial<CredentialsState>) => void;
  onInventoryReadyChange?: (ready: boolean) => void;
  onSelectedRolesByAliasChange?: (rolesByAlias: Record<string, string[]>) => void;
  onWorkspaceIdChange?: (id: string | null) => void;
  aliasRenames?: { from: string; to: string }[];
  onAliasRenamesHandled?: (count: number) => void;
  aliasDeletes?: string[];
  onAliasDeletesHandled?: (count: number) => void;
  aliasCleanups?: string[];
  onAliasCleanupsHandled?: (count: number) => void;
  selectionTouched?: boolean;
  compact?: boolean;
};

export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  size?: number | null;
  children: Map<string, TreeNode>;
};

export type TreeItem = {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  size?: number | null;
};

export type KdbxEntryView = {
  id: string;
  group: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
};

export type VaultBlock = {
  key: string;
  start: number;
  end: number;
  indent: string;
};

export type ZipImportMode = "override" | "merge";

export type ZipImportPreviewFile = {
  path: string;
  exists: boolean;
};

export type WorkspaceListEntry = {
  id: string;
  name?: string;
  state?: string;
  created_at?: string | null;
  last_modified_at?: string | null;
  last_used?: string | null;
  // req 019: role of the current user on this workspace.
  role?: "owner" | "member";
};

// req 019 — workspace memberships.
export type WorkspaceMember = {
  user_id: string | null;
  email: string | null;
  role: "owner" | "member";
  joined_at?: string | null;
  invited_at?: string | null;
  invited_by?: string | null;
};

export type WorkspaceMembers = {
  owner: WorkspaceMember;
  members: WorkspaceMember[];
  pending: WorkspaceMember[];
};

export type UsersAction =
  | "overview"
  | "add"
  | "import-csv"
  | "import-yaml"
  | "export-csv"
  | "export-yaml";

export type HistoryOpenIntent = "history" | "diff-current" | "restore";

export type WorkspaceHistoryFileChange = {
  status: string;
  path: string;
  old_path?: string | null;
};

export type WorkspaceHistoryCommit = {
  sha: string;
  created_at?: string | null;
  summary: string;
  files: WorkspaceHistoryFileChange[];
};

export type OrphanCleanupItem = {
  path: string;
  alias: string;
  kind: "host_vars" | "ssh_key_private" | "ssh_key_public";
};
