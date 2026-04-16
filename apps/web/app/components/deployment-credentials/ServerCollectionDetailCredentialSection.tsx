"use client";

import type { ChangeEvent as ReactChangeEvent, Dispatch, SetStateAction } from "react";
import styles from "./styles.module.css";
import type { ValidationState } from "./ServerCollectionView.types";
import type { ServerState } from "./types";

type CredentialSectionProps = {
  detailServer: ServerState;
  detailValidation: ValidationState | null;
  passwordConfirmDrafts: Record<string, string>;
  setPasswordConfirmDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  keyInputModeByAlias: Record<string, "import" | "generate">;
  workspaceId: string | null;
  detailActionBusy: "keygen" | null;
  onPatchServer: (alias: string, patch: Partial<ServerState>) => void;
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
  updateAuthMethod: (server: ServerState, method: "password" | "private_key") => void;
  setKeyInputMode: (alias: string, mode: "import" | "generate") => void;
  runDetailKeygen: (server: ServerState) => Promise<void>;
  handlePrivateKeyUpload: (
    server: ServerState,
    event: ReactChangeEvent<HTMLInputElement>
  ) => void;
};

export function ServerCollectionDetailCredentialSection({
  detailServer,
  detailValidation,
  passwordConfirmDrafts,
  setPasswordConfirmDrafts,
  keyInputModeByAlias,
  workspaceId,
  detailActionBusy,
  onPatchServer,
  emitCredentialBlur,
  updateAuthMethod,
  setKeyInputMode,
  runDetailKeygen,
  handlePrivateKeyUpload,
}: CredentialSectionProps) {
  return (
    <>
      <div className={styles.fieldWrap}>
        <label className={`text-body-tertiary ${styles.fieldLabel}`}>Credential type</label>
        <div className={styles.segmentedButtons}>
          <button
            type="button"
            onClick={() => updateAuthMethod(detailServer, "password")}
            className={`${styles.segmentedButton} ${
              detailServer.authMethod === "password" ? styles.segmentedButtonActive : ""
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => updateAuthMethod(detailServer, "private_key")}
            className={`${styles.segmentedButton} ${
              detailServer.authMethod === "private_key"
                ? styles.segmentedButtonActive
                : ""
            }`}
          >
            SSH key
          </button>
        </div>
      </div>

      {detailServer.authMethod === "password" ? (
        <div className={styles.fieldWrap}>
          <label className={`text-body-tertiary ${styles.fieldLabel}`}>Password</label>
          <input
            type="password"
            value={detailServer.password}
            onChange={(event) =>
              onPatchServer(detailServer.alias, {
                password: event.target.value,
              })
            }
            onBlur={(event) =>
              emitCredentialBlur(
                { ...detailServer, password: event.currentTarget.value },
                "password",
                passwordConfirmDrafts[detailServer.alias] ?? ""
              )
            }
            placeholder="Enter password"
            autoComplete="off"
            className={`${styles.fieldInput} ${
              detailValidation?.credentialsMissing ? styles.inputError : ""
            }`}
          />
          <input
            type="password"
            value={passwordConfirmDrafts[detailServer.alias] ?? ""}
            onChange={(event) =>
              setPasswordConfirmDrafts((prev) => ({
                ...prev,
                [detailServer.alias]: event.target.value,
              }))
            }
            onBlur={(event) =>
              emitCredentialBlur(
                detailServer,
                "passwordConfirm",
                event.currentTarget.value
              )
            }
            placeholder="Confirm password"
            autoComplete="off"
            className={`${styles.fieldInput} ${
              detailValidation?.passwordConfirmError ? styles.inputError : ""
            }`}
          />
          {detailValidation?.passwordConfirmError ? (
            <p className="text-danger">{detailValidation.passwordConfirmError}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Algorithm</label>
            <select
              value={detailServer.keyAlgorithm || "ed25519"}
              onChange={(event) =>
                onPatchServer(detailServer.alias, {
                  keyAlgorithm: event.target.value,
                })
              }
              className={styles.selectControl}
            >
              <option value="ed25519">ed25519 (recommended)</option>
              <option value="rsa">rsa 4096</option>
              <option value="ecdsa">ecdsa</option>
            </select>
            {!String(detailServer.privateKey || "").trim() ? (
              <div className={styles.segmentedButtons}>
                <button
                  type="button"
                  onClick={() => setKeyInputMode(detailServer.alias, "import")}
                  className={`${styles.segmentedButton} ${
                    (keyInputModeByAlias[detailServer.alias] ?? "import") === "import"
                      ? styles.segmentedButtonActive
                      : ""
                  }`}
                >
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => setKeyInputMode(detailServer.alias, "generate")}
                  className={`${styles.segmentedButton} ${
                    (keyInputModeByAlias[detailServer.alias] ?? "import") ===
                    "generate"
                      ? styles.segmentedButtonActive
                      : ""
                  }`}
                >
                  Generate
                </button>
              </div>
            ) : null}
            {!String(detailServer.privateKey || "").trim() &&
            (keyInputModeByAlias[detailServer.alias] ?? "import") === "generate" ? (
              <button
                type="button"
                onClick={() => {
                  void runDetailKeygen(detailServer);
                }}
                disabled={detailActionBusy === "keygen" || !workspaceId}
                className={styles.actionButtonSecondary}
              >
                <i className="fa-solid fa-key" aria-hidden="true" />
                <span>{detailActionBusy === "keygen" ? "Generating..." : "Generate key"}</span>
              </button>
            ) : null}
            {!String(detailServer.privateKey || "").trim() &&
            (keyInputModeByAlias[detailServer.alias] ?? "import") === "generate" ? (
              <p className={`text-body-secondary ${styles.statusHint}`}>
                Generates a new keypair with random passphrase protection.
              </p>
            ) : null}
          </div>

          {(String(detailServer.privateKey || "").trim() ||
            (keyInputModeByAlias[detailServer.alias] ?? "import") === "import") && (
            <div className={styles.fieldWrap}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>Private key</label>
              <textarea
                value={detailServer.privateKey}
                onChange={(event) =>
                  onPatchServer(detailServer.alias, {
                    privateKey: event.target.value,
                  })
                }
                onBlur={(event) =>
                  emitCredentialBlur(
                    { ...detailServer, privateKey: event.currentTarget.value },
                    "privateKey"
                  )
                }
                placeholder="Paste SSH private key"
                rows={6}
                autoComplete="off"
                spellCheck={false}
                className={`${styles.textAreaControl} ${
                  detailValidation?.credentialsMissing ? styles.inputError : ""
                }`}
              />
              <label className={styles.uploadKeyButton}>
                <i className="fa-solid fa-upload" aria-hidden="true" />
                <span>Upload private key</span>
                <input
                  type="file"
                  accept=".pem,.key,.txt,text/plain"
                  onChange={(event) => handlePrivateKeyUpload(detailServer, event)}
                  className={styles.fileInputHidden}
                />
              </label>
              {detailValidation?.credentialsMissing ? (
                <p className="text-danger">Private key is required.</p>
              ) : null}
            </div>
          )}

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>
              Key passphrase (optional)
            </label>
            <input
              type="password"
              value={detailServer.keyPassphrase}
              onChange={(event) =>
                onPatchServer(detailServer.alias, {
                  keyPassphrase: event.target.value,
                })
              }
              onBlur={(event) =>
                emitCredentialBlur(
                  { ...detailServer, keyPassphrase: event.currentTarget.value },
                  "keyPassphrase"
                )
              }
              placeholder="Optional key passphrase"
              autoComplete="off"
              className={styles.fieldInput}
            />
          </div>

          <div className={styles.fieldWrap}>
            <label className={`text-body-tertiary ${styles.fieldLabel}`}>Public key</label>
            <textarea
              readOnly
              value={detailServer.publicKey || ""}
              placeholder="Public key will appear here"
              rows={3}
              className={`${styles.textAreaControl} ${styles.inputDisabledBg}`}
            />
          </div>
        </>
      )}
    </>
  );
}
