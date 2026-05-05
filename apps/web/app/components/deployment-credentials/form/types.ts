import type { ConnectionResult, ServerState, ServerViewMode } from "../types";

export type DeploymentCredentialsFormProps = {
  baseUrl: string;
  workspaceId: string | null;
  servers: ServerState[];
  connectionResults: Record<string, ConnectionResult>;
  activeAlias: string;
  onActiveAliasChange: (alias: string) => void;
  onUpdateServer: (alias: string, patch: Partial<ServerState>) => void;
  onConnectionResult: (alias: string, result: ConnectionResult) => void;
  onRemoveServer: (alias: string) => Promise<void> | void;
  onCleanupServer: (alias: string) => Promise<void> | void;
  onAddServer: (aliasHint?: string) => void;
  openCredentialsAlias?: string | null;
  onOpenCredentialsAliasHandled?: () => void;
  deviceMode?: "customer" | "expert";
  onDeviceModeChange?: (mode: "customer" | "expert") => void;
  onOpenDetailSearch?: (alias?: string) => void;
  primaryDomainOptions?: string[];
  onRequestAddPrimaryDomain?: (request?: {
    alias?: string;
    value?: string;
    kind?: "local" | "fqdn" | "subdomain";
    parentFqdn?: string;
    subLabel?: string;
    reason?: "missing" | "unknown";
  }) => void;
  compact?: boolean;
};

export type PendingServerAction = {
  mode: "delete" | "purge";
  aliases: string[];
} | null;

export type CredentialBlurPayload = {
  server: ServerState;
  field:
    | "host"
    | "port"
    | "user"
    | "password"
    | "passwordConfirm"
    | "privateKey"
    | "keyPassphrase"
    | "primaryDomain";
  passwordConfirm?: string;
};

export type ViewModeIconMap = Record<ServerViewMode, string>;
