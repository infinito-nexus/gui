import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import AuditLogsPanel from "../../AuditLogsPanel";
import MembersPanel from "../../MembersPanel";
import styles from "../../DeploymentWorkspace.module.css";
import { USER_STORAGE_KEY } from "../../workspace-panel/utils";
import { listMembers } from "../../../lib/members-api";
import type { Role } from "../types";
import BillingPanel from "./BillingPanel";

// Renamed UI surface (was "Account"). The internal panel key stays
// `account` for state-stability, but every user-facing label says
// "Settings". The Settings panel is split into four sub-tabs:
//   - general: signed-in info, login/register/logout controls
//   - billing: existing BillingPanel (login-gated)
//   - rbac:    workspace-member management via MembersPanel (login-gated)
//   - audit:   AuditLogsPanel (login-gated)
export type AccountTabKey = "general" | "billing" | "rbac" | "audit";

type AccountPanelProps = {
  baseUrl: string;
  workspaceId: string;
  roles: Role[];
  selectedRolesByAlias: Record<string, string[]>;
  selectedPlansByAlias: Record<string, Record<string, string | null>>;
  activeTab: AccountTabKey;
  onTabChange: (next: AccountTabKey) => void;
};

const ACCOUNT_SESSION_UPDATED_EVENT = "infinito:account-session-updated";
// Fired by the global header switch button (DeploymentWorkspaceTemplate)
// when the user clicks "Login" while the AccountPanel is mounted; we
// react by opening the same login modal users see from inside the
// panel so the entry point is identical regardless of where they
// click.
const ACCOUNT_OPEN_AUTH_EVENT = "infinito:account-open-auth";

function normalizeUserId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "");
}

function readUserId(): string | null {
  if (typeof window === "undefined") return null;
  const value = normalizeUserId(window.localStorage.getItem(USER_STORAGE_KEY));
  return value || null;
}

export default function AccountPanel({
  baseUrl,
  workspaceId,
  roles,
  selectedRolesByAlias,
  selectedPlansByAlias,
  activeTab,
  onTabChange,
}: AccountPanelProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingTabAfterAuth, setPendingTabAfterAuth] =
    useState<AccountTabKey | null>(null);
  const [authForm, setAuthForm] = useState({
    userId: "",
    email: "",
    password: "",
    passwordConfirm: "",
  });

  const syncUserId = useCallback(() => {
    setUserId(readUserId());
  }, []);

  useEffect(() => {
    syncUserId();
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== USER_STORAGE_KEY) return;
      syncUserId();
    };
    const onCustom = () => syncUserId();
    const onOpenAuth = () => {
      // Honor only when no session exists; logged-in users clicking
      // "Logout" are handled by the header itself (which clears the
      // session before this event would even reach us).
      if (!readUserId()) {
        setAuthMode("login");
        setAuthError(null);
        setAuthOpen(true);
        setPendingTabAfterAuth(null);
        setAuthForm((prev) => ({ ...prev, userId: prev.userId || "" }));
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ACCOUNT_SESSION_UPDATED_EVENT, onCustom);
    window.addEventListener(ACCOUNT_OPEN_AUTH_EVENT, onOpenAuth);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ACCOUNT_SESSION_UPDATED_EVENT, onCustom);
      window.removeEventListener(ACCOUNT_OPEN_AUTH_EVENT, onOpenAuth);
    };
  }, [syncUserId]);

  const openAuth = useCallback(
    (
      mode: "login" | "register",
      { pendingTab }: { pendingTab?: AccountTabKey | null } = {}
    ) => {
      setAuthMode(mode);
      setAuthError(null);
      setAuthOpen(true);
      setPendingTabAfterAuth(pendingTab ?? null);
      setAuthForm((prev) => ({
        ...prev,
        userId: prev.userId || userId || "",
      }));
    },
    [userId]
  );

  const closeAuth = useCallback(() => {
    setAuthOpen(false);
    setAuthError(null);
    setPendingTabAfterAuth(null);
  }, []);

  const submitLogin = useCallback(() => {
    if (typeof window === "undefined") return;
    const normalized = normalizeUserId(authForm.userId);
    if (!normalized) {
      setAuthError("Please enter a user id.");
      return;
    }
    window.localStorage.setItem(USER_STORAGE_KEY, normalized);
    window.dispatchEvent(new Event(ACCOUNT_SESSION_UPDATED_EVENT));
    setAuthOpen(false);
    if (pendingTabAfterAuth) {
      onTabChange(pendingTabAfterAuth);
      setPendingTabAfterAuth(null);
    }
  }, [authForm.userId, onTabChange, pendingTabAfterAuth]);

  const submitRegister = useCallback(() => {
    if (typeof window === "undefined") return;
    const normalized = normalizeUserId(authForm.userId);
    if (!normalized) {
      setAuthError("Please choose a user id.");
      return;
    }
    if (authForm.password && authForm.password !== authForm.passwordConfirm) {
      setAuthError("Password confirmation does not match.");
      return;
    }
    window.localStorage.setItem(USER_STORAGE_KEY, normalized);
    window.dispatchEvent(new Event(ACCOUNT_SESSION_UPDATED_EVENT));
    setAuthOpen(false);
    if (pendingTabAfterAuth) {
      onTabChange(pendingTabAfterAuth);
      setPendingTabAfterAuth(null);
    }
  }, [authForm.password, authForm.passwordConfirm, authForm.userId, onTabChange, pendingTabAfterAuth]);

  const logout = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(USER_STORAGE_KEY);
    window.dispatchEvent(new Event(ACCOUNT_SESSION_UPDATED_EVENT));
    setPendingTabAfterAuth(null);
    onTabChange("general");
  }, [onTabChange]);

  const handleTabSelect = (next: AccountTabKey) => {
    if (
      (next === "billing" || next === "rbac" || next === "audit") &&
      !userId
    ) {
      openAuth("login", { pendingTab: next });
      return;
    }
    onTabChange(next);
  };

  useEffect(() => {
    if (
      activeTab !== "billing" &&
      activeTab !== "rbac" &&
      activeTab !== "audit"
    )
      return;
    if (userId) return;
    if (authOpen) return;
    onTabChange("general");
    openAuth("login", { pendingTab: activeTab });
  }, [activeTab, authOpen, onTabChange, openAuth, userId]);

  const tabItems = useMemo(
    () => {
      const base: Array<{ key: AccountTabKey; label: string }> = [
        { key: "general", label: "General" },
        { key: "billing", label: "Billing" },
      ];
      if (userId) {
        base.push({ key: "rbac", label: "RBAC" });
        base.push({ key: "audit", label: "Audit Logs" });
      }
      return base;
    },
    [userId]
  );

  const effectiveTab =
    (activeTab === "billing" || activeTab === "rbac" || activeTab === "audit") &&
    !userId
      ? "general"
      : activeTab;

  return (
    <div className={styles.accountPanel}>
      <div className={styles.accountSubTabList} role="tablist" aria-label="Settings sections">
        {tabItems.map((tab) => {
          const active = tab.key === effectiveTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.accountSubTabButton} ${active ? styles.accountSubTabButtonActive : ""}`}
              onClick={() => handleTabSelect(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {effectiveTab === "general" ? (
        <div className={styles.accountCard}>
          <h3 className={styles.accountCardTitle}>Settings</h3>
          {userId ? (
            <>
              <p className={styles.accountCardHint}>
                Signed in as <strong>{userId}</strong>.
              </p>
              <div className={styles.accountCardActions}>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => handleTabSelect("billing")}
                >
                  Open billing
                </button>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => handleTabSelect("rbac")}
                >
                  Open RBAC
                </button>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled} ${styles.smallButtonDanger}`}
                  onClick={logout}
                >
                  Logout
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.accountCardHint}>
                Sign in to access billing, RBAC and manage your account.
              </p>
              <div className={styles.accountCardActions}>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => openAuth("login")}
                >
                  Login
                </button>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => openAuth("register")}
                >
                  Register
                </button>
              </div>
            </>
          )}
        </div>
      ) : effectiveTab === "rbac" ? (
        <RbacView workspaceId={workspaceId} currentUserId={userId ?? ""} />
      ) : effectiveTab === "audit" ? (
        <AuditLogsPanel baseUrl={baseUrl} workspaceId={workspaceId} />
      ) : (
        <BillingPanel
          baseUrl={baseUrl}
          roles={roles}
          selectedRolesByAlias={selectedRolesByAlias}
          selectedPlansByAlias={selectedPlansByAlias}
        />
      )}

      {authOpen && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.accountAuthOverlay} onClick={closeAuth}>
              <div
                className={styles.accountAuthCard}
                onClick={(event) => event.stopPropagation()}
              >
                <div className={styles.accountAuthHeader}>
                  <div>
                    <h4 className={styles.accountAuthTitle}>
                      {authMode === "register" ? "Create account" : "Login"}
                    </h4>
                    <p className={styles.accountAuthHint}>
                      Billing is available after sign-in.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                    onClick={closeAuth}
                  >
                    Close
                  </button>
                </div>

                <div className={styles.accountAuthModeRow}>
                  <button
                    type="button"
                    className={`${styles.accountAuthModeButton} ${
                      authMode === "login" ? styles.accountAuthModeButtonActive : ""
                    }`}
                    onClick={() => {
                      setAuthMode("login");
                      setAuthError(null);
                    }}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    className={`${styles.accountAuthModeButton} ${
                      authMode === "register" ? styles.accountAuthModeButtonActive : ""
                    }`}
                    onClick={() => {
                      setAuthMode("register");
                      setAuthError(null);
                    }}
                  >
                    Register
                  </button>
                </div>

                {authError ? (
                  <div className={`text-danger ${styles.accountAuthError}`}>
                    {authError}
                  </div>
                ) : null}

                <form
                  className={styles.accountAuthForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    setAuthError(null);
                    if (authMode === "register") {
                      submitRegister();
                    } else {
                      submitLogin();
                    }
                  }}
                >
                  <label className={styles.accountAuthField}>
                    <span>User ID</span>
                    <input
                      value={authForm.userId}
                      onChange={(event) =>
                        setAuthForm((prev) => ({
                          ...prev,
                          userId: String(event.target.value || ""),
                        }))
                      }
                      autoComplete="username"
                      className="form-control"
                      placeholder="yourname"
                    />
                  </label>

                  {authMode === "register" ? (
                    <>
                      <label className={styles.accountAuthField}>
                        <span>Email (optional)</span>
                        <input
                          value={authForm.email}
                          onChange={(event) =>
                            setAuthForm((prev) => ({
                              ...prev,
                              email: String(event.target.value || ""),
                            }))
                          }
                          autoComplete="email"
                          className="form-control"
                          placeholder="you@example.com"
                        />
                      </label>
                      <label className={styles.accountAuthField}>
                        <span>Password (optional)</span>
                        <input
                          value={authForm.password}
                          onChange={(event) =>
                            setAuthForm((prev) => ({
                              ...prev,
                              password: String(event.target.value || ""),
                            }))
                          }
                          type="password"
                          autoComplete="new-password"
                          className="form-control"
                          placeholder="••••••••"
                        />
                      </label>
                      <label className={styles.accountAuthField}>
                        <span>Confirm password</span>
                        <input
                          value={authForm.passwordConfirm}
                          onChange={(event) =>
                            setAuthForm((prev) => ({
                              ...prev,
                              passwordConfirm: String(event.target.value || ""),
                            }))
                          }
                          type="password"
                          autoComplete="new-password"
                          className="form-control"
                          placeholder="••••••••"
                        />
                      </label>
                    </>
                  ) : null}

                  <div className={styles.accountAuthActions}>
                    <button
                      type="submit"
                      className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                    >
                      {authMode === "register" ? "Create account" : "Login"}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

// Loads the workspace's member list once to derive the current user's
// owner-vs-member role, then renders the existing MembersPanel with
// the correct ownership-gating. Server-side enforcement (req-019) is
// the actual authority; the client-side flag controls visibility of
// owner-only invite/remove/transfer controls in MembersPanel so a
// member doesn't see actions that would 403 anyway.
function RbacView({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !currentUserId) {
      setIsOwner(false);
      return;
    }
    let alive = true;
    setError(null);
    setIsOwner(null);
    listMembers(workspaceId)
      .then((data) => {
        if (!alive) return;
        const ownerId = data.owner?.user_id ?? "";
        setIsOwner(
          normalizeUserId(ownerId) === normalizeUserId(currentUserId),
        );
      })
      .catch((err) => {
        if (!alive) return;
        setError(`Failed to load workspace members: ${(err as Error).message}`);
        setIsOwner(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, currentUserId]);

  if (!workspaceId) {
    return (
      <div className={styles.accountCard}>
        <p className={styles.accountCardHint}>
          Select a workspace to manage member access.
        </p>
      </div>
    );
  }

  if (isOwner === null && !error) {
    return (
      <div className={styles.accountCard}>
        <p className={styles.accountCardHint}>Loading members…</p>
      </div>
    );
  }

  return (
    <div className={styles.accountCard}>
      {error ? (
        <p className={`text-danger ${styles.accountCardHint}`}>{error}</p>
      ) : null}
      <MembersPanel workspaceId={workspaceId} isOwner={isOwner ?? false} />
    </div>
  );
}
