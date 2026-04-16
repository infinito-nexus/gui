"use client";

import { createPortal } from "react-dom";
import type { ChangeEvent as ReactChangeEvent, Dispatch, SetStateAction } from "react";
import styles from "./styles.module.css";
import { normalizeDeviceColor } from "./device-visuals";
import type { ConnectionResult, ServerState } from "./types";
import type { StatusIndicator, ValidationState } from "./ServerCollectionView.types";
import { ServerCollectionDetailCredentialSection } from "./ServerCollectionDetailCredentialSection";

type DetailModalProps = {
  isCustomerMode: boolean;
  detailServer: ServerState | null;
  detailValidation: ValidationState | null;
  detailIndicator: StatusIndicator | null;
  detailConnectionResult: ConnectionResult | undefined;
  detailActionBusy: "keygen" | null;
  detailActionError: string | null;
  detailActionStatus: string | null;
  aliasDrafts: Record<string, string>;
  passwordConfirmDrafts: Record<string, string>;
  setPasswordConfirmDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  keyInputModeByAlias: Record<string, "import" | "generate">;
  workspaceId: string | null;
  openEmojiAlias: string | null;
  setOpenEmojiAlias: Dispatch<SetStateAction<string | null>>;
  setDetailAlias: Dispatch<SetStateAction<string | null>>;
  onPatchServer: (alias: string, patch: Partial<ServerState>) => void;
  onAliasTyping: (server: ServerState, value: string) => void;
  commitAlias: (server: ServerState) => void;
  openPrimaryDomainMenuFor: (alias: string, target: HTMLElement) => void;
  commitPrimaryDomain: (server: ServerState, value?: string) => void;
  emitCredentialBlur: (
    server: ServerState,
    field:
      | "host"
      | "port"
      | "user"
      | "password"
      | "passwordConfirm"
      | "privateKey"
      | "keyPassphrase"
      | "primaryDomain",
    passwordConfirm?: string
  ) => void;
  patchPort: (alias: string, value: string) => void;
  onPortFieldBlur: (server: ServerState) => void;
  updateAuthMethod: (server: ServerState, method: "password" | "private_key") => void;
  setKeyInputMode: (alias: string, mode: "import" | "generate") => void;
  handlePrivateKeyUpload: (
    server: ServerState,
    event: ReactChangeEvent<HTMLInputElement>
  ) => void;
  runDetailKeygen: (server: ServerState) => Promise<void>;
  onRequestDelete: (aliases: string[]) => void;
  onRequestPurge: (aliases: string[]) => void;
  openStatusPopoverFor: (
    alias: string,
    indicator: StatusIndicator,
    event: React.MouseEvent<HTMLElement>
  ) => void;
  closeStatusPopoverFor: (alias: string) => void;
  statusDotClass: (tone: StatusIndicator["tone"]) => string;
  Picker: any;
  data: any;
};

export function renderServerCollectionDetailModal({
  isCustomerMode,
  detailServer,
  detailValidation,
  detailIndicator,
  detailConnectionResult,
  detailActionBusy,
  detailActionError,
  detailActionStatus,
  aliasDrafts,
  passwordConfirmDrafts,
  setPasswordConfirmDrafts,
  keyInputModeByAlias,
  workspaceId,
  openEmojiAlias,
  setOpenEmojiAlias,
  setDetailAlias,
  onPatchServer,
  onAliasTyping,
  commitAlias,
  openPrimaryDomainMenuFor,
  commitPrimaryDomain,
  emitCredentialBlur,
  patchPort,
  onPortFieldBlur,
  updateAuthMethod,
  setKeyInputMode,
  handlePrivateKeyUpload,
  runDetailKeygen,
  onRequestDelete,
  onRequestPurge,
  openStatusPopoverFor,
  closeStatusPopoverFor,
  statusDotClass,
  Picker,
  data,
}: DetailModalProps) {
  if (isCustomerMode || !detailServer || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={`${styles.modalOverlay} ${styles.serverModalOverlay}`}
      onClick={() => setDetailAlias(null)}
    >
      <div
        className={`${styles.modalCard} ${styles.serverModalCard} ${styles.detailModalCard}`}
        data-server-detail={detailServer.alias}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h3 className={styles.modalTitle}>
              <i className="fa-solid fa-circle-info" aria-hidden="true" /> Device detail ·{" "}
              {detailServer.alias}
            </h3>
            <p className={`text-body-secondary ${styles.modalHint}`}>
              Edit identity, connectivity and credentials in one place.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => setDetailAlias(null)}
          >
            Close
          </button>
        </div>

        <div className={styles.fieldGrid}>
          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Identity</label>
            <div className={styles.aliasInputRow}>
              <input
                type="color"
                value={normalizeDeviceColor(detailServer.color) || "#89CFF0"}
                onChange={(event) =>
                  onPatchServer(detailServer.alias, { color: event.target.value })
                }
                className={styles.colorPickerInput}
                aria-label="Device color"
              />
              <div className={styles.emojiPickerShell}>
                <button
                  type="button"
                  className={`${styles.emojiPickerTrigger} ${
                    openEmojiAlias === detailServer.alias
                      ? styles.emojiPickerTriggerOpen
                      : ""
                  }`}
                  onClick={() =>
                    setOpenEmojiAlias((prev) =>
                      prev === detailServer.alias ? null : detailServer.alias
                    )
                  }
                  title="Choose device emoji"
                  aria-label="Choose device emoji"
                >
                  <span className={styles.aliasEmojiPreview} aria-hidden="true">
                    {detailServer.logoEmoji || "💻"}
                  </span>
                </button>
                {openEmojiAlias === detailServer.alias ? (
                  <div className={styles.emojiPickerMenu}>
                    <Picker
                      data={data}
                      theme="dark"
                      previewPosition="none"
                      navPosition="bottom"
                      searchPosition="sticky"
                      perLine={8}
                      maxFrequentRows={2}
                      onEmojiSelect={(emoji: any) => {
                        const nextEmoji = String(emoji?.native || "").trim();
                        if (!nextEmoji) return;
                        onPatchServer(detailServer.alias, { logoEmoji: nextEmoji });
                        setOpenEmojiAlias(null);
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <input
                value={aliasDrafts[detailServer.alias] ?? detailServer.alias}
                onChange={(event) => onAliasTyping(detailServer, event.target.value)}
                onBlur={() => commitAlias(detailServer)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitAlias(detailServer);
                  }
                }}
                placeholder="device"
                className={`${styles.fieldInput} ${styles.identityAliasInput} ${
                  detailValidation?.aliasError ? styles.inputError : ""
                }`}
              />
            </div>
            {detailValidation?.aliasError ? (
              <p className="text-danger">{detailValidation.aliasError}</p>
            ) : null}
          </div>

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Description</label>
            <input
              value={detailServer.description}
              onChange={(event) =>
                onPatchServer(detailServer.alias, {
                  description: event.target.value,
                })
              }
              placeholder="Optional description"
              className={styles.fieldInput}
            />
          </div>

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Primary domain</label>
            <div className={styles.primaryDomainInputRow}>
              <input
                value={detailServer.primaryDomain || ""}
                onChange={(event) =>
                  onPatchServer(detailServer.alias, {
                    primaryDomain: event.target.value,
                  })
                }
                onFocus={(event) =>
                  openPrimaryDomainMenuFor(detailServer.alias, event.currentTarget)
                }
                onClick={(event) =>
                  openPrimaryDomainMenuFor(detailServer.alias, event.currentTarget)
                }
                onBlur={(event) =>
                  commitPrimaryDomain(detailServer, event.currentTarget.value)
                }
                placeholder="localhost"
                className={`${styles.fieldInput} ${styles.primaryDomainDropdownTrigger} ${
                  detailValidation?.primaryDomainError ? styles.inputError : ""
                }`}
              />
            </div>
            {detailValidation?.primaryDomainError ? (
              <p className="text-danger">{detailValidation.primaryDomainError}</p>
            ) : null}
          </div>

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Host</label>
            <input
              value={detailServer.host}
              onChange={(event) =>
                onPatchServer(detailServer.alias, { host: event.target.value })
              }
              onBlur={(event) =>
                emitCredentialBlur(
                  { ...detailServer, host: event.currentTarget.value },
                  "host"
                )
              }
              placeholder="example.com"
              className={`${styles.fieldInput} ${
                detailValidation?.hostMissing ? styles.inputError : ""
              }`}
            />
            {detailValidation?.hostMissing ? (
              <p className="text-danger">Host is required.</p>
            ) : null}
          </div>

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Port</label>
            <input
              type="number"
              value={detailServer.port}
              onChange={(event) => patchPort(detailServer.alias, event.target.value)}
              onBlur={() => onPortFieldBlur(detailServer)}
              placeholder="22"
              min={1}
              max={65535}
              step={1}
              inputMode="numeric"
              className={`${styles.fieldInput} ${
                detailValidation?.portError ? styles.inputError : ""
              }`}
            />
            {detailValidation?.portError ? (
              <p className="text-danger">{detailValidation.portError}</p>
            ) : null}
          </div>

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>User</label>
            <input
              value={detailServer.user}
              onChange={(event) =>
                onPatchServer(detailServer.alias, { user: event.target.value })
              }
              onBlur={(event) =>
                emitCredentialBlur(
                  { ...detailServer, user: event.currentTarget.value },
                  "user"
                )
              }
              placeholder="root"
              className={`${styles.fieldInput} ${
                detailValidation?.userMissing ? styles.inputError : ""
              }`}
            />
            {detailValidation?.userMissing ? (
              <p className="text-danger">User is required.</p>
            ) : null}
          </div>

          <ServerCollectionDetailCredentialSection
            detailServer={detailServer}
            detailValidation={detailValidation}
            passwordConfirmDrafts={passwordConfirmDrafts}
            setPasswordConfirmDrafts={setPasswordConfirmDrafts}
            keyInputModeByAlias={keyInputModeByAlias}
            workspaceId={workspaceId}
            detailActionBusy={detailActionBusy}
            onPatchServer={onPatchServer}
            emitCredentialBlur={emitCredentialBlur}
            updateAuthMethod={updateAuthMethod}
            setKeyInputMode={setKeyInputMode}
            runDetailKeygen={runDetailKeygen}
            handlePrivateKeyUpload={handlePrivateKeyUpload}
          />
        </div>

        <div className={styles.detailStatusBlock}>
          <div
            className={styles.statusHeadline}
            onMouseEnter={(event) => {
              if (!detailIndicator) return;
              openStatusPopoverFor(detailServer.alias, detailIndicator, event);
            }}
            onMouseLeave={() => closeStatusPopoverFor(detailServer.alias)}
          >
            <span
              className={`${styles.statusDot} ${statusDotClass(
                detailIndicator?.tone ?? "orange"
              )}`}
              aria-hidden="true"
            />
            <span>{detailIndicator?.label ?? "Unknown status"}</span>
          </div>
          <div className={styles.statusSummary}>
            {detailIndicator?.tooltip ?? "No status available."}
          </div>
          {detailConnectionResult ? (
            <div className={styles.detailResultGrid}>
              <span>
                Ping:{" "}
                {detailConnectionResult.ping_ok
                  ? "ok"
                  : detailConnectionResult.ping_error || "failed"}
              </span>
              <span>
                SSH:{" "}
                {detailConnectionResult.ssh_ok
                  ? "ok"
                  : detailConnectionResult.ssh_error || "failed"}
              </span>
            </div>
          ) : null}
          {detailActionError ? <p className="text-danger">{detailActionError}</p> : null}
          {detailActionStatus ? (
            <p className="text-success">{detailActionStatus}</p>
          ) : null}
        </div>

        <div className={styles.detailModalFooter}>
          <button
            type="button"
            onClick={() => {
              onRequestDelete([detailServer.alias]);
              setDetailAlias(null);
            }}
            className={styles.actionButtonDangerSoft}
          >
            <i className="fa-solid fa-trash" aria-hidden="true" />
            <span>Delete</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onRequestPurge([detailServer.alias]);
              setDetailAlias(null);
            }}
            className={styles.actionButtonDanger}
          >
            <i className="fa-solid fa-broom" aria-hidden="true" />
            <span>Purge</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
