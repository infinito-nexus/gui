// API client for workspace memberships (req 019).
// All endpoints require the proxy-set X-Auth-Request-{User,Email} headers
// so the calls work transparently behind oauth2-proxy or the e2e
// header-mock path.
import type { WorkspaceMembers, WorkspaceMember } from "../components/workspace-panel/types";

function apiBase(): string {
  if (typeof process !== "undefined" && process?.env?.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  return "";
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMembers> {
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as WorkspaceMembers;
}

export async function inviteMember(
  workspaceId: string,
  email: string
): Promise<WorkspaceMember> {
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as WorkspaceMember;
}

export async function removeMember(
  workspaceId: string,
  memberKey: string
): Promise<void> {
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(
      workspaceId
    )}/members/${encodeURIComponent(memberKey)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
}

export async function transferOwnership(
  workspaceId: string,
  newOwnerId: string
): Promise<void> {
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(
      workspaceId
    )}/members/transfer-ownership`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ new_owner_id: newOwnerId }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
}
