export type RoleLogo = {
  source: string;
  css_class?: string | null;
  url?: string | null;
};

export type Bundle = {
  id: string;
  slug: string;
  deploy_target: string;
  title: string;
  description: string;
  logo_class?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
  role_ids?: string[] | null;
};

export type ServiceLink = {
  key: string;
  default_enabled: boolean;
  shared: boolean;
};

export type FormFieldType =
  | "boolean"
  | "integer"
  | "float"
  | "string"
  | "text"
  | "list"
  | "mapping"
  | "password";

export type FormField = {
  path: string[];
  type: FormFieldType;
  label: string;
  description?: string | null;
  default?: unknown;
  enum?: unknown[] | null;
  validation?: string | null;
  secret?: boolean;
};

export type Role = {
  id: string;
  display_name: string;
  status: string;
  description: string;
  deployment_targets: string[];
  logo?: RoleLogo | null;
  documentation?: string | null;
  video?: string | null;
  forum?: string | null;
  homepage?: string | null;
  repository?: string | null;
  issue_tracker_url?: string | null;
  license_url?: string | null;
  categories?: string[] | null;
  galaxy_tags?: string[] | null;
  bundle_member?: boolean | null;
  services_links?: ServiceLink[] | null;
  form_fields?: FormField[] | null;
  pricing_summary?: {
    default_offering_id?: string | null;
    default_plan_id?: string | null;
    currencies?: string[] | null;
    regions?: string[] | null;
    [key: string]: unknown;
  } | null;
  pricing?: {
    default_offering_id?: string | null;
    default_plan_id?: string | null;
    offerings?: Array<{
      id: string;
      label?: string | null;
      plans?: Array<{
        id: string;
        label?: string | null;
        description?: string | null;
      }> | null;
    }> | null;
    [key: string]: unknown;
  } | null;
};

export const VIEW_MODES = ["detail", "list", "row", "column", "mini", "matrix"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export type ViewConfig = {
  minWidth: number;
  minHeight: number;
  iconSize: number;
  showDescription: boolean;
  showTargets: boolean;
  showLinks: boolean;
  horizontal: boolean;
};

export type QuickLink = {
  key: string;
  label: string;
  url?: string | null;
  type: "link" | "video";
  iconClass: string;
};

export type StatusColor = {
  bg: string;
  fg: string;
  border: string;
};
