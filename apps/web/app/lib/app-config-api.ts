// API client for the role-app-config PATCH endpoint (req-023).
//
// Used by the Forms tab and the Services tab in the role-detail
// modal. Both surfaces drive the same per-field write under
// host_vars/<alias>.yml.applications.<role-id>; services live at
// path = ["services", "<service-key>", "enabled"], form fields at
// path = field.path.

function apiBase(): string {
  if (typeof process !== "undefined" && process?.env?.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  return "";
}

export type AppConfigPatchInput = {
  workspaceId: string;
  roleId: string;
  alias?: string | null;
  path: string[];
  value?: unknown;
  delete?: boolean;
};

export type AppConfigPatchResponse = {
  role_id: string;
  alias: string;
  host_vars_path: string;
  content: string;
  path: string[];
  deleted: boolean;
};

export type AppConfigReadResponse = {
  role_id: string;
  alias: string;
  host_vars_path: string;
  content: string; // YAML fragment
};

function buildBody(input: AppConfigPatchInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    path: input.path,
    delete: Boolean(input.delete),
  };
  if (!input.delete) {
    body.value = input.value ?? null;
  }
  if (input.alias != null) {
    body.alias = input.alias;
  }
  return body;
}

export async function patchAppConfigField(
  input: AppConfigPatchInput,
): Promise<AppConfigPatchResponse> {
  const url = `${apiBase()}/api/workspaces/${encodeURIComponent(
    input.workspaceId,
  )}/roles/${encodeURIComponent(input.roleId)}/app-config/field`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildBody(input)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as AppConfigPatchResponse;
}

export async function readAppConfig(
  workspaceId: string,
  roleId: string,
  alias?: string | null,
): Promise<AppConfigReadResponse> {
  const params = new URLSearchParams();
  if (alias) params.set("alias", alias);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const url = `${apiBase()}/api/workspaces/${encodeURIComponent(
    workspaceId,
  )}/roles/${encodeURIComponent(roleId)}/app-config${qs}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AppConfigReadResponse;
}
