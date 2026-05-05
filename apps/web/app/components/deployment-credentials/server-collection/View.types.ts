import type { ConnectionResult, ServerState, ServerViewMode } from "../types";

export type ServerCollectionViewProps = {
  viewMode: ServerViewMode;
  deviceMode?: "customer" | "expert";
  onOpenDetailSearch?: (alias?: string) => void;
  paginatedServers: ServerState[];
  computedColumns: number;
  laneCount?: number;
  laneSize?: number;
  aliasCounts: Record<string, number>;
  testResults: Record<string, ConnectionResult>;
  workspaceId: string | null;
  onAliasChange: (alias: string, nextAlias: string) => void;
  onPatchServer: (alias: string, patch: Partial<ServerState>) => void;
  onOpenDetail: (alias: string) => void;
  onGenerateKey: (alias: string) => Promise<void> | void;
  onCredentialFieldBlur: (payload: {
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
  }) => Promise<void> | void;
  onRequestDelete: (aliases: string[]) => void;
  onRequestPurge: (aliases: string[]) => void;
  requestedDetailAlias?: string | null;
  onRequestedDetailAliasHandled?: () => void;
  primaryDomainOptions?: string[];
  onRequestAddPrimaryDomain?: (request?: {
    alias?: string;
    value?: string;
    kind?: "local" | "fqdn" | "subdomain";
    parentFqdn?: string;
    subLabel?: string;
    reason?: "missing" | "unknown";
  }) => void;
};

export type ValidationState = {
  aliasError: string | null;
  hostMissing: boolean;
  userMissing: boolean;
  portError: string | null;
  primaryDomainError: string | null;
  colorError: string | null;
  logoMissing: boolean;
  credentialsMissing: boolean;
  passwordConfirmError: string | null;
};

export type StatusIndicator = {
  tone: "green" | "yellow" | "orange";
  label: string;
  tooltip: string;
  missingCredentials: boolean;
};

export type OverlayMenu = {
  alias: string;
  top: number;
  left: number;
};

export type StatusPopover = {
  alias: string;
  top: number;
  left: number;
  label: string;
  tooltip: string;
};

export type PrimaryDomainMenu = {
  alias: string;
  top: number;
  left: number;
  width: number;
};
