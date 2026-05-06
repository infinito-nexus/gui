"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import YAML from "yaml";
import VaultPasswordModal from "../../../VaultPasswordModal";
import styles from "../../../deployment/workspace/Main.module.css";
import {
  classifyPassword,
  isConventionalUidGid,
  isUsernameAvailable,
  isValidEmail,
  isValidUidGid,
  isValidUsername,
  readCookie,
  sanitizeIntegerInput,
  sanitizeUsernameInput,
  type UserRow,
} from "./users-tab-utils";

type Props = {
  row: UserRow;
  rows: UserRow[];
  baseUrl: string;
  workspaceId: string;
  onClose: () => void;
  onChange: (patch: Partial<UserRow>) => void;
};

function FieldLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span>
      <i className={`fa-solid fa-${icon}`} aria-hidden="true" /> {children}
    </span>
  );
}

// Hover/focus popover that renders its content via a portal at the
// document root, positioned with fixed coordinates relative to the
// trigger. This sidesteps overflow clipping from the surrounding
// modal card (which uses overflow: auto for vertical scrolling) and
// keeps the popover stacked above sibling content.
function HoverPopover({
  contentClassName,
  trigger,
  children,
  align = "left",
}: {
  contentClassName: string;
  trigger: (props: {
    ref: React.RefObject<HTMLButtonElement>;
    onFocus: () => void;
    onBlur: () => void;
  }) => ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const computePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: align === "right" ? r.right : r.left,
    });
  };

  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    computePos();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <span
      style={{ display: "inline-block" }}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      {trigger({
        ref: triggerRef,
        onFocus: openNow,
        onBlur: scheduleClose,
      })}
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              className={contentClassName}
              style={{
                position: "fixed",
                top: pos.top,
                left: align === "right" ? undefined : pos.left,
                right:
                  align === "right" ? window.innerWidth - pos.left : undefined,
                zIndex: 1300,
              }}
              onMouseEnter={openNow}
              onMouseLeave={scheduleClose}
              onFocusCapture={cancelClose}
              onBlurCapture={scheduleClose}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

export default function UserDetailModal({
  row,
  rows,
  baseUrl,
  workspaceId,
  onClose,
  onChange,
}: Props) {
  const [roleInput, setRoleInput] = useState("");
  // Password change → vault encrypt. The plaintext lives in local
  // state until the user explicitly clicks Set; only the encrypted
  // body is ever written to the row (and into the YAML).
  const [pwInput, setPwInput] = useState("");
  const [pwConfirmInput, setPwConfirmInput] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const keyFileInputRef = useRef<HTMLInputElement | null>(null);
  const [vaultPromptOpen, setVaultPromptOpen] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultNotice, setVaultNotice] = useState<string | null>(null);
  // Username uses blur-commit semantics: a local draft tracks the
  // input value, and we only forward the change to the row (which
  // would re-key autosave / detail lookup) once the field is left
  // with a valid, unique value.
  const [usernameDraft, setUsernameDraft] = useState(row.username);

  useEffect(() => {
    setRoleInput("");
    setUsernameDraft(row.username);
    setPwInput("");
    setPwConfirmInput("");
    setVaultPromptOpen(false);
    setVaultError(null);
    setVaultNotice(null);
    setKeyDraft("");
  }, [row]);

  const trimmedUsername = usernameDraft.trim();
  const usernameValid = isValidUsername(trimmedUsername);
  const usernameUnique = isUsernameAvailable(rows, trimmedUsername, row);
  const usernameError = !usernameValid
    ? "Username must contain only lowercase letters and digits."
    : !usernameUnique
      ? "Another user already has this username."
      : null;

  const emailValid = isValidEmail(row.email);
  const emailError = !emailValid ? "Enter a valid email address." : null;

  const uidStructValid = isValidUidGid(row.uid);
  const gidStructValid = isValidUidGid(row.gid);
  const uidConventional = isConventionalUidGid(row.uid);
  const gidConventional = isConventionalUidGid(row.gid);

  const passwordStatus = classifyPassword(row.password);

  // Row-level lock: while any structurally-validated field is broken,
  // every other input gets disabled. The user must fix the offender
  // before they can edit anything else or close the dialog through
  // some other input — Close itself stays enabled (as an escape hatch
  // for read-only inspection) but Save-bound activity is gated.
  const fieldErrors = {
    username: !!usernameError,
    email: !!emailError,
    uid: !uidStructValid,
    gid: !gidStructValid,
  };
  const hasError = Object.values(fieldErrors).some(Boolean);
  const lock = (myFieldHasError: boolean) => hasError && !myFieldHasError;

  const roles = useMemo(() => row.roles ?? [], [row.roles]);

  const addRole = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (roles.includes(v)) return;
    onChange({ roles: [...roles, v] });
    setRoleInput("");
  };

  const removeRole = (target: string) => {
    onChange({ roles: roles.filter((r) => r !== target) });
  };

  const onRoleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addRole(roleInput);
    }
  };

  const keys = useMemo(() => row.authorized_keys ?? [], [row.authorized_keys]);

  const setKeyAt = (index: number, value: string) => {
    const next = keys.slice();
    next[index] = value;
    onChange({ authorized_keys: next });
  };

  const removeKeyAt = (index: number) => {
    const next = keys.filter((_, i) => i !== index);
    onChange({ authorized_keys: next });
  };

  const appendKeysFromText = (text: string) => {
    const parsed = (text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;
    onChange({ authorized_keys: [...keys, ...parsed] });
  };

  const onAddKeyTyped = () => {
    appendKeysFromText(keyDraft);
    setKeyDraft("");
  };

  const onKeyFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Just stage the file content into the input — the user can
      // review and press Enter or click Add to commit.
      setKeyDraft(String(reader.result || "").trim());
    };
    reader.readAsText(file);
  };

  const clearPassword = () => {
    onChange({ password: undefined });
  };

  const pwMatches =
    pwInput.length > 0 && pwInput === pwConfirmInput;

  const submitPasswordEncryption = async (masterPassword: string) => {
    setVaultBusy(true);
    setVaultError(null);
    setVaultNotice(null);
    try {
      const csrf = readCookie("csrf");
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (csrf) headers["X-CSRF"] = csrf;
      const res = await fetch(
        `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/vault/encrypt`,
        {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({
            master_password: masterPassword,
            plaintext: pwInput,
          }),
        },
      );
      if (!res.ok) {
        let detail = "";
        try {
          detail = ((await res.json()) as { detail?: string }).detail || "";
        } catch {}
        if (res.status === 404 || /vault password not set/i.test(detail)) {
          setVaultPromptOpen(false);
          setVaultNotice(
            "The workspace credentials vault isn't initialized yet. Open the Credentials tab and click Generate credentials, then come back to set the password.",
          );
          return;
        }
        if (res.status === 400 && /master password|invalid/i.test(detail)) {
          setVaultError("Wrong master password.");
          return;
        }
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { vault_text?: string };
      const vaultText = String(data?.vault_text ?? "");
      if (!vaultText.startsWith("$ANSIBLE_VAULT;")) {
        throw new Error("Unexpected vault response");
      }
      onChange({ password: vaultText });
      setPwInput("");
      setPwConfirmInput("");
      setVaultPromptOpen(false);
      setVaultNotice("Password encrypted and saved.");
    } catch (err: any) {
      setVaultError(err?.message ?? "vault encrypt failed");
    } finally {
      setVaultBusy(false);
    }
  };

  const invalidClass = (invalid: boolean) =>
    `form-control${invalid ? ` ${styles.formControlInvalid}` : ""}`;

  return (
    <div className={styles.usersTabModalOverlay} onClick={onClose}>
      <div
        className={styles.usersTabModalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.usersTabModalHeader}>
          <h4 className={styles.usersTabModalTitle}>
            <i className="fa-solid fa-user-pen" aria-hidden="true" /> User: {row.username}
          </h4>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" /> Close
          </button>
        </div>

        <div className={styles.usersTabModalBody}>
          <label className={styles.usersTabModalField}>
            <FieldLabel icon="user">Username</FieldLabel>
            <input
              type="text"
              className={invalidClass(!!usernameError)}
              value={usernameDraft}
              aria-invalid={usernameError ? true : undefined}
              disabled={lock(fieldErrors.username)}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setUsernameDraft(sanitizeUsernameInput(e.target.value))}
              onBlur={(e) => {
                if (usernameError) {
                  const target = e.currentTarget;
                  requestAnimationFrame(() => target.focus());
                  return;
                }
                if (trimmedUsername !== row.username) {
                  onChange({ username: trimmedUsername });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              autoComplete="username"
            />
            {usernameError ? (
              <span className={styles.usersTabFieldError}>{usernameError}</span>
            ) : null}
          </label>

          <label className={styles.usersTabModalField}>
            <FieldLabel icon="envelope">Email</FieldLabel>
            <input
              type="email"
              className={invalidClass(!!emailError)}
              value={row.email ?? ""}
              aria-invalid={emailError ? true : undefined}
              disabled={lock(fieldErrors.email)}
              onChange={(e) => onChange({ email: e.target.value })}
              onBlur={(e) => {
                if (emailError) {
                  const target = e.currentTarget;
                  requestAnimationFrame(() => target.focus());
                }
              }}
            />
            {emailError ? (
              <span className={styles.usersTabFieldError}>{emailError}</span>
            ) : null}
          </label>

          <div className={styles.usersTabModalField}>
            <FieldLabel icon="lock">Password</FieldLabel>
            <div className={styles.usersTabPasswordStatus}>
              {passwordStatus === "unset" ? (
                <span className={styles.usersTabFieldHintMuted}>
                  <i className="fa-solid fa-circle-minus" aria-hidden="true" /> Not set
                </span>
              ) : passwordStatus === "vault" ? (
                <span className={styles.usersTabFieldHintOk}>
                  <i className="fa-solid fa-shield-halved" aria-hidden="true" /> Set (vault-encrypted)
                </span>
              ) : (
                <span className={styles.usersTabFieldError}>
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> Set as
                  plaintext &mdash; autosave will be blocked until cleared.
                </span>
              )}
              {passwordStatus !== "unset" ? (
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled} ${styles.smallButtonDanger}`}
                  onClick={clearPassword}
                  disabled={hasError}
                  title="Remove the password entry from the YAML"
                >
                  <i className="fa-solid fa-eraser" aria-hidden="true" /> Clear
                </button>
              ) : null}
            </div>
            <div className={styles.usersTabPasswordSet}>
              <input
                type="password"
                className="form-control"
                value={pwInput}
                placeholder="New password"
                autoComplete="new-password"
                disabled={hasError}
                onChange={(e) => setPwInput(e.target.value)}
              />
              {pwInput ? (
                <input
                  type="password"
                  className={invalidClass(!pwMatches)}
                  value={pwConfirmInput}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  disabled={hasError}
                  onChange={(e) => setPwConfirmInput(e.target.value)}
                />
              ) : null}
              <button
                type="button"
                className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                onClick={() => {
                  setVaultError(null);
                  setVaultNotice(null);
                  setVaultPromptOpen(true);
                }}
                disabled={hasError || !pwMatches}
                title={
                  !pwMatches
                    ? "Type the new password into both fields"
                    : "Encrypt and store via the workspace vault"
                }
              >
                <i className="fa-solid fa-shield-halved" aria-hidden="true" /> Set
              </button>
            </div>
            {pwInput && !pwMatches ? (
              <span className={styles.usersTabFieldError}>
                Passwords do not match.
              </span>
            ) : null}
            {vaultNotice ? (
              <span className={styles.usersTabFieldHint}>
                <i className="fa-solid fa-circle-info" aria-hidden="true" /> {vaultNotice}
              </span>
            ) : null}
          </div>

          <div className={styles.usersTabModalRow}>
            <label className={styles.usersTabModalField}>
              <FieldLabel icon="hashtag">UID</FieldLabel>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className={invalidClass(!uidStructValid)}
                value={row.uid ?? ""}
                aria-invalid={!uidStructValid ? true : undefined}
                disabled={lock(fieldErrors.uid)}
                onKeyDown={(e) => {
                  if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                    e.preventDefault();
                  }
                }}
                onChange={(e) => {
                  const v = sanitizeIntegerInput(e.target.value);
                  onChange({ uid: v === "" ? undefined : Number(v) });
                }}
                onBlur={(e) => {
                  if (!uidStructValid) {
                    const target = e.currentTarget;
                    requestAnimationFrame(() => target.focus());
                  }
                }}
              />
              {!uidStructValid ? (
                <span className={styles.usersTabFieldError}>
                  UID must be a non-negative integer.
                </span>
              ) : !uidConventional && row.uid !== undefined ? (
                <span className={styles.usersTabFieldHint}>
                  Outside the conventional 1000–60000 range.
                </span>
              ) : null}
            </label>
            <label className={styles.usersTabModalField}>
              <FieldLabel icon="people-group">GID</FieldLabel>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className={invalidClass(!gidStructValid)}
                value={row.gid ?? ""}
                aria-invalid={!gidStructValid ? true : undefined}
                disabled={lock(fieldErrors.gid)}
                onKeyDown={(e) => {
                  if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                    e.preventDefault();
                  }
                }}
                onChange={(e) => {
                  const v = sanitizeIntegerInput(e.target.value);
                  onChange({ gid: v === "" ? undefined : Number(v) });
                }}
                onBlur={(e) => {
                  if (!gidStructValid) {
                    const target = e.currentTarget;
                    requestAnimationFrame(() => target.focus());
                  }
                }}
              />
              {!gidStructValid ? (
                <span className={styles.usersTabFieldError}>
                  GID must be a non-negative integer.
                </span>
              ) : !gidConventional && row.gid !== undefined ? (
                <span className={styles.usersTabFieldHint}>
                  Outside the conventional 1000–60000 range.
                </span>
              ) : null}
            </label>
          </div>

          <div className={styles.usersTabModalField}>
            <FieldLabel icon="user-shield">Roles</FieldLabel>
            <div className={styles.usersTabRoleChips}>
              {roles.length === 0 ? (
                <span className={styles.usersTabKeyEmpty}>No roles assigned.</span>
              ) : (
                roles.map((r) => (
                  <span key={r} className={styles.usersTabRoleChip}>
                    <i className="fa-solid fa-id-badge" aria-hidden="true" /> {r}
                    <button
                      type="button"
                      className={styles.usersTabRoleChipRemove}
                      onClick={() => removeRole(r)}
                      disabled={hasError}
                      title={`Remove role ${r}`}
                      aria-label={`Remove role ${r}`}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </span>
                ))
              )}
              <HoverPopover
                contentClassName={styles.usersTabRoleAddPopover}
                trigger={({ ref, onFocus, onBlur }) => (
                  <button
                    ref={ref}
                    type="button"
                    className={styles.usersTabRoleAddTrigger}
                    disabled={hasError}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    title="Add a role"
                    aria-label="Add a role"
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                  </button>
                )}
              >
                <input
                  type="text"
                  className="form-control"
                  value={roleInput}
                  placeholder="Role name"
                  disabled={hasError}
                  onChange={(e) => setRoleInput(e.target.value)}
                  onKeyDown={onRoleKeyDown}
                />
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => addRole(roleInput)}
                  disabled={hasError || !roleInput.trim()}
                >
                  <i className="fa-solid fa-check" aria-hidden="true" />
                </button>
              </HoverPopover>
            </div>
          </div>

          <div className={styles.usersTabModalField}>
            <FieldLabel icon="key">Authorized keys</FieldLabel>
            <div className={styles.usersTabKeysList}>
              {keys.length === 0 ? (
                <span className={styles.usersTabKeyEmpty}>No keys yet.</span>
              ) : (
                keys.map((k, idx) => (
                  <div key={idx} className={styles.usersTabKeyRow}>
                    <input
                      type="text"
                      className="form-control"
                      value={k}
                      placeholder="ssh-ed25519 AAAA…"
                      disabled={hasError}
                      onChange={(e) => setKeyAt(idx, e.target.value)}
                    />
                    <button
                      type="button"
                      className={`${styles.smallButton} ${styles.smallButtonEnabled} ${styles.smallButtonDanger}`}
                      onClick={() => removeKeyAt(idx)}
                      disabled={hasError}
                      title="Remove this key"
                      aria-label="Remove this key"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
              <HoverPopover
                contentClassName={styles.usersTabKeyAddPopover}
                trigger={({ ref, onFocus, onBlur }) => (
                  <button
                    ref={ref}
                    type="button"
                    className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                    disabled={hasError}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    title="Add a key"
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" /> Add key
                  </button>
                )}
              >
                <input
                  type="text"
                  className="form-control"
                  value={keyDraft}
                  placeholder="ssh-ed25519 AAAA…"
                  disabled={hasError}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddKeyTyped();
                    }
                  }}
                />
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={() => keyFileInputRef.current?.click()}
                  disabled={hasError}
                  title="Upload a key file (.pub) into the input"
                >
                  <i className="fa-solid fa-file-arrow-up" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
                  onClick={onAddKeyTyped}
                  disabled={hasError || !keyDraft.trim()}
                  title={
                    !keyDraft.trim()
                      ? "Paste or upload a key first"
                      : "Append the key (Enter)"
                  }
                >
                  <i className="fa-solid fa-check" aria-hidden="true" />
                </button>
                <input
                  ref={keyFileInputRef}
                  type="file"
                  accept=".pub,text/plain,application/x-pem-file"
                  onChange={onKeyFileChange}
                  className={styles.usersTabHiddenInput}
                />
              </HoverPopover>
            </div>
          </div>

          <label className={styles.usersTabModalField}>
            <FieldLabel icon="align-left">Description</FieldLabel>
            <textarea
              className="form-control"
              rows={3}
              value={row.description ?? ""}
              disabled={hasError}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </label>
          <label className={styles.usersTabModalCheckbox}>
            <input
              type="checkbox"
              checked={Boolean(row.reserved)}
              disabled={hasError}
              onChange={(e) => onChange({ reserved: e.target.checked })}
            />
            <span>
              <i className="fa-solid fa-server" aria-hidden="true" /> Reserved (system user)
            </span>
          </label>
          {row.tokens ? (
            <div className={styles.usersTabModalField}>
              <FieldLabel icon="ticket">Tokens (read-only YAML)</FieldLabel>
              <pre className={styles.usersTabModalTokens}>
                {YAML.stringify(row.tokens)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      <VaultPasswordModal
        open={vaultPromptOpen}
        title={`Encrypt password for ${row.username}`}
        helperText={
          vaultError
            ? vaultError
            : vaultBusy
              ? "Encrypting…"
              : "Enter the workspace master password to vault-encrypt this user's password."
        }
        onSubmit={(master) => {
          if (!vaultBusy) submitPasswordEncryption(master);
        }}
        onClose={() => {
          if (!vaultBusy) {
            setVaultPromptOpen(false);
            setVaultError(null);
          }
        }}
      />
    </div>
  );
}
