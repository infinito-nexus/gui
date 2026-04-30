import type { ReactNode } from "react";

export type Role = {
  id: string;
  display_name: string;
  status: string;
  description: string;
  deployment_targets: string[];
  logo?: { source: string; css_class?: string | null; url?: string | null };
  documentation?: string | null;
  video?: string | null;
  forum?: string | null;
  homepage?: string | null;
  issue_tracker_url?: string | null;
  license_url?: string | null;
  categories?: string[] | null;
  galaxy_tags?: string[] | null;
  bundle_member?: boolean | null;
  pricing_summary?: {
    default_offering_id?: string;
    default_plan_id?: string;
    currencies?: string[];
    regions?: string[];
    [key: string]: unknown;
  } | null;
  pricing?: {
    default_offering_id?: string;
    default_plan_id?: string;
    offerings?: Array<{
      id: string;
      label?: string;
      plans?: Array<{ id: string; label?: string; description?: string }>;
    }>;
    [key: string]: unknown;
  } | null;
};

export type AliasRename = { from: string; to: string };

export type DeploymentWorkspaceProps = {
  baseUrl: string;
  streamBaseUrl?: string;
  onJobCreated?: (jobId: string) => void;
  initialRoles?: Role[];
  initialPanel?: PanelKey;
  initialWorkspaceId?: string;
};

export type RoleAppConfigResponse = {
  role_id: string;
  alias: string;
  host_vars_path: string;
  content: string;
  imported_paths?: number;
};

export type DomainKind = "local" | "fqdn" | "subdomain";

export type DomainEntry = {
  id: string;
  kind: DomainKind;
  domain: string;
  parentFqdn: string | null;
};

export type DomainFilterKind = "all" | DomainKind;

export type PrimaryDomainAddRequest = {
  alias?: string;
  value?: string;
  kind?: DomainKind;
  parentFqdn?: string;
  subLabel?: string;
  reason?: "missing" | "unknown";
};

export type PanelKey =
  | "intro"
  | "store"
  | "domain"
  | "server"
  | "inventory"
  | "deploy"
  | "account";

export type PanelQueryKey =
  | "intro"
  | "software"
  | "domain"
  | "hardware"
  | "inventory"
  | "audit"
  | "setup"
  | "account"
  | "settings"
  | "billing";

// Audit logs are no longer their own top-level tab — they live as a
// sub-tab inside the Settings panel (formerly "Account"), gated behind
// an authenticated session. The legacy `?ui_panel=audit` deep link is
// preserved here so existing bookmarks (and the audit_logs Playwright
// spec) keep working: the URL still routes to the Settings panel and
// the effect hook in `useDeploymentWorkspaceEffects` opens the audit
// sub-tab when it sees `audit`.
export const PANEL_QUERY_TO_KEY: Record<string, PanelKey> = {
  intro: "intro",
  software: "store",
  domain: "domain",
  hardware: "server",
  device: "server",
  inventory: "inventory",
  audit: "account",
  setup: "deploy",
  account: "account",
  settings: "account",
  billing: "account",
};

export const PANEL_KEY_TO_QUERY: Record<PanelKey, PanelQueryKey> = {
  intro: "intro",
  store: "software",
  domain: "domain",
  server: "hardware",
  inventory: "inventory",
  deploy: "setup",
  account: "settings",
};

export const PANEL_ICON_BY_KEY: Record<PanelKey, string> = {
  intro: "fa-circle-info",
  store: "fa-cubes",
  domain: "fa-globe",
  server: "fa-server",
  inventory: "fa-box-archive",
  deploy: "fa-screwdriver-wrench",
  account: "fa-gear",
};

export type WorkspaceTabPanel = {
  key: PanelKey;
  title: string;
  content: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
};

export type DomainCheckResult = {
  available: boolean;
  note: string;
};

export type OrderedProviderServer = {
  alias: string;
  ansible_host: string;
  ansible_user: string;
  ansible_port: number;
  requirementServerType?: string;
  requirementStorageGb?: string;
  requirementLocation?: string;
};
