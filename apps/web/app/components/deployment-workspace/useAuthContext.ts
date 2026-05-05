"use client";

// Fetches the caller's auth snapshot from the backend so the UI can
// gate admin-only controls. Backend is the source of truth — the
// localStorage-based username is just a dev-mode convenience.

import { useEffect, useState } from "react";

export type AuthSnapshot = {
  authenticated: boolean;
  user_id: string | null;
  email: string | null;
  groups: string[];
  is_administrator: boolean;
  proxy_enabled: boolean;
};

const ANONYMOUS: AuthSnapshot = {
  authenticated: false,
  user_id: null,
  email: null,
  groups: [],
  is_administrator: false,
  proxy_enabled: false,
};

export function useAuthContext(baseUrl: string): AuthSnapshot {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(ANONYMOUS);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/auth/me`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<AuthSnapshot>;
        if (cancelled) return;
        setSnapshot({
          authenticated: Boolean(data.authenticated),
          user_id: data.user_id ?? null,
          email: data.email ?? null,
          groups: Array.isArray(data.groups) ? data.groups : [],
          is_administrator: Boolean(data.is_administrator),
          proxy_enabled: Boolean(data.proxy_enabled),
        });
      } catch {
        // Stay anonymous on error.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);
  return snapshot;
}
