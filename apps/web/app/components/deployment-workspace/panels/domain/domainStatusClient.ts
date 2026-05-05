"use client";

// Thin client wrapper for the workspace domain status endpoint.
// Included because both the Expert DomainPanel and the customer-facing
// CustomerDomainPanel need the same write path; the read side stays
// with the existing group_vars/all.yml hydration.

import type { DomainStatus } from "../../types";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
  );
  return match ? decodeURIComponent(match[1]) : "";
}

export type DomainStatusResponse = {
  domain: string;
  status: DomainStatus;
  status_changed_at?: string | null;
  order_id?: string | null;
};

export async function transitionDomainStatus(args: {
  baseUrl: string;
  workspaceId: string;
  domain: string;
  next: DomainStatus;
  orderId?: string | null;
}): Promise<DomainStatusResponse> {
  const { baseUrl, workspaceId, domain, next, orderId } = args;
  const csrf = readCookie("csrf");
  const res = await fetch(
    `${baseUrl}/api/workspaces/${encodeURIComponent(
      workspaceId
    )}/domains/${encodeURIComponent(domain)}/status`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF": csrf } : {}),
      },
      body: JSON.stringify({
        status: next,
        ...(orderId ? { order_id: orderId } : {}),
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text || `Domain status transition failed (HTTP ${res.status})`
    );
  }
  return (await res.json()) as DomainStatusResponse;
}
