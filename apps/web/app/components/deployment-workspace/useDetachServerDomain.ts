"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { normalizePersistedDeviceMeta } from "../../lib/device_meta";
import type { ServerState } from "../deployment-credentials/types";
import { persistServerPrimaryDomain } from "./domain-utils";

// Persist primary_domain=null so the next host_vars hydration round
// doesn't reinstate the detached domain.
export function useDetachServerDomain(
  baseUrl: string,
  workspaceId: string | null,
  setServers: Dispatch<SetStateAction<ServerState[]>>
) {
  return useCallback(
    async (alias: string) => {
      setServers((prev) => {
        const idx = prev.findIndex((server) => server.alias === alias);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...prev[idx], primaryDomain: "" };
        return normalizePersistedDeviceMeta(next);
      });
      if (workspaceId) {
        await persistServerPrimaryDomain(baseUrl, workspaceId, alias, null);
      }
    },
    [baseUrl, setServers, workspaceId]
  );
}
