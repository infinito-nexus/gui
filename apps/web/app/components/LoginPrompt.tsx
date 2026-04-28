"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "infinito-login-prompt:dismissed";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated" }
  | { status: "anonymous" };

async function probeAuth(): Promise<AuthState> {
  try {
    const res = await fetch("/api/workspaces", { cache: "no-store" });
    if (res.status === 401) return { status: "anonymous" };
    if (!res.ok) return { status: "anonymous" };
    const data = await res.json().catch(() => null);
    if (data?.authenticated && data?.user_id) return { status: "authenticated" };
    return { status: "anonymous" };
  } catch {
    return { status: "anonymous" };
  }
}

/**
 * Login prompt modal (req 021).
 *
 * Shown on the entry page when the API reports the user is anonymous AND
 * the dismissed flag in localStorage is unset. "Continue as guest" sets
 * the flag; "Sign in" navigates to the OAuth2-Proxy sign-in path.
 *
 * The dismissed flag is cleared on sign-out (handled by the Account hub
 * sign-out button) so the prompt re-appears on the next anonymous visit.
 */
export default function LoginPrompt() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      setDismissed(true);
    }
    probeAuth().then(setAuth);
  }, []);

  // Re-arm: when authenticated → anonymous transition (sign-out), the
  // sign-out path clears the flag and we re-render here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setDismissed(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const close = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const signIn = () => {
    // OAuth2-Proxy convention. In the e2e header-mock stack this 404s
    // — Playwright asserts the URL only.
    window.location.href = "/oauth2/sign_in";
  };

  // Esc → guest.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    if (auth.status === "anonymous" && !dismissed) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [auth.status, dismissed]);

  if (auth.status !== "anonymous" || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-prompt-title"
      data-testid="login-prompt"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
      }}
      // Backdrop click does NOT dismiss (req 021 acceptance).
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          background: "var(--deployer-surface, #fff)",
          color: "var(--deployer-text, #111)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 480,
          width: "calc(100% - 32px)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="login-prompt-title" style={{ marginTop: 0 }}>
          Welcome to Infinito Deployer
        </h2>
        <p style={{ marginBottom: 16 }}>How would you like to continue?</p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <button
            onClick={close}
            data-testid="login-prompt-guest"
            style={{ padding: "12px 16px", textAlign: "left" }}
          >
            <strong>Continue as guest</strong>
            <div style={{ fontSize: 12, marginTop: 6, color: "#666" }}>
              Workspaces last for this session only
            </div>
          </button>
          <button
            onClick={signIn}
            data-testid="login-prompt-signin"
            style={{ padding: "12px 16px", textAlign: "left" }}
          >
            <strong>Sign in</strong>
            <div style={{ fontSize: 12, marginTop: 6, color: "#666" }}>
              Persist your work, invite collaborators
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export { STORAGE_KEY as LOGIN_PROMPT_STORAGE_KEY };
