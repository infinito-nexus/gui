"use client";

import VaultPasswordModal from "../../VaultPasswordModal";
import styles from "./Overlays.module.css";

export default function WorkspacePanelSecurityModals(props: any) {
  const {
    kdbxPromptOpen,
    handleKdbxSubmit,
    setKdbxPromptOpen,
    setEditorLoading,
    vaultPromptOpen,
    vaultPromptConfirm,
    handleVaultPromptSubmit,
    setVaultPromptOpen,
    setVaultPromptMode,
    setPendingCredentials,
    masterChangeOpen,
    setMasterChangeOpen,
    masterChangeMode,
    masterChangeValues,
    setMasterChangeValues,
    masterChangeError,
    submitMasterChange,
    masterChangeBusy,
    keyPassphraseModal,
    setKeyPassphraseModal,
    keyPassphraseValues,
    setKeyPassphraseValues,
    keyPassphraseError,
    submitKeyPassphraseChange,
    keyPassphraseBusy,
    vaultValueModal,
    setVaultValueModal,
    vaultValueInputs,
    setVaultValueInputs,
    submitVaultValue,
  } = props;

  return (
    <>
      <VaultPasswordModal
        open={kdbxPromptOpen}
        title="Unlock credentials.kdbx"
        helperText="Master password is required to read KDBX files."
        onSubmit={(masterPassword) => handleKdbxSubmit(masterPassword)}
        onClose={() => {
          setKdbxPromptOpen(false);
          setEditorLoading(false);
        }}
      />
      <VaultPasswordModal
        open={vaultPromptOpen}
        title="Unlock credentials vault"
        requireConfirm={vaultPromptConfirm}
        confirmLabel="Confirm master password"
        helperText="Master password is required for each vault action."
        onSubmit={handleVaultPromptSubmit}
        onClose={() => {
          setVaultPromptOpen(false);
          setVaultPromptMode(null);
          setPendingCredentials(null);
        }}
      />
      {masterChangeOpen ? (
        <div onClick={() => setMasterChangeOpen(false)} className={styles.modalOverlay}>
          <div onClick={(event) => event.stopPropagation()} className={styles.modalCard}>
            <h3 className={styles.modalTitle}>
              {masterChangeMode === "set" ? "Set master password" : "Reset master password"}
            </h3>
            {masterChangeMode === "reset" ? (
              <div className={styles.fieldStack}>
                <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                  Current master password
                </label>
                <input
                  type="password"
                  value={masterChangeValues.current}
                  onChange={(event) =>
                    setMasterChangeValues((prev: any) => ({
                      ...prev,
                      current: event.target.value,
                    }))
                  }
                  className={styles.inputControl}
                />
              </div>
            ) : null}
            <div className={styles.fieldStack}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                New master password
              </label>
              <input
                type="password"
                value={masterChangeValues.next}
                onChange={(event) =>
                  setMasterChangeValues((prev: any) => ({
                    ...prev,
                    next: event.target.value,
                  }))
                }
                className={styles.inputControl}
              />
            </div>
            <div className={styles.fieldStack}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                Confirm new master password
              </label>
              <input
                type="password"
                value={masterChangeValues.confirm}
                onChange={(event) =>
                  setMasterChangeValues((prev: any) => ({
                    ...prev,
                    confirm: event.target.value,
                  }))
                }
                className={styles.inputControl}
              />
            </div>
            {masterChangeError ? (
              <p className={`text-danger ${styles.errorText}`}>{masterChangeError}</p>
            ) : null}
            <div className={styles.actionsRow}>
              <button
                onClick={() => setMasterChangeOpen(false)}
                className={styles.secondaryButton}
              >
                Cancel
              </button>
              <button
                onClick={submitMasterChange}
                disabled={masterChangeBusy}
                className={styles.primaryButton}
              >
                {masterChangeBusy
                  ? "Saving..."
                  : masterChangeMode === "set"
                    ? "Set password"
                    : "Reset password"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {keyPassphraseModal ? (
        <div onClick={() => setKeyPassphraseModal(null)} className={styles.modalOverlay}>
          <div onClick={(event) => event.stopPropagation()} className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Change key passphrase</h3>
            <div className={styles.fieldStack}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>Master password</label>
              <input
                type="password"
                value={keyPassphraseValues.master}
                onChange={(event) =>
                  setKeyPassphraseValues((prev: any) => ({
                    ...prev,
                    master: event.target.value,
                  }))
                }
                className={styles.inputControl}
              />
            </div>
            <div className={styles.fieldStack}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>New passphrase</label>
              <input
                type="password"
                value={keyPassphraseValues.next}
                onChange={(event) =>
                  setKeyPassphraseValues((prev: any) => ({
                    ...prev,
                    next: event.target.value,
                  }))
                }
                className={styles.inputControl}
              />
            </div>
            <div className={styles.fieldStack}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                Confirm new passphrase
              </label>
              <input
                type="password"
                value={keyPassphraseValues.confirm}
                onChange={(event) =>
                  setKeyPassphraseValues((prev: any) => ({
                    ...prev,
                    confirm: event.target.value,
                  }))
                }
                className={styles.inputControl}
              />
            </div>
            {keyPassphraseError ? (
              <p className={`text-danger ${styles.errorText}`}>{keyPassphraseError}</p>
            ) : null}
            <div className={styles.actionsRow}>
              <button
                onClick={() => setKeyPassphraseModal(null)}
                className={styles.secondaryButton}
              >
                Cancel
              </button>
              <button
                onClick={submitKeyPassphraseChange}
                disabled={keyPassphraseBusy}
                className={styles.primaryButton}
              >
                {keyPassphraseBusy ? "Saving..." : "Change passphrase"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {vaultValueModal ? (
        <div onClick={() => setVaultValueModal(null)} className={styles.modalOverlay}>
          <div
            onClick={(event) => event.stopPropagation()}
            className={`${styles.modalCard} ${styles.modalCardWide}`}
          >
            <h3 className={styles.modalTitle}>
              {vaultValueModal.mode === "show"
                ? `Reveal ${vaultValueModal.block.key}`
                : `Change ${vaultValueModal.block.key}`}
            </h3>
            <div className={styles.fieldStack}>
              <label className={`text-body-tertiary ${styles.fieldLabel}`}>Master password</label>
              <input
                type="password"
                value={vaultValueInputs.master}
                onChange={(event) =>
                  setVaultValueInputs((prev: any) => ({
                    ...prev,
                    master: event.target.value,
                  }))
                }
                className={styles.inputControl}
              />
            </div>
            {vaultValueModal.mode === "change" ? (
              <>
                <div className={styles.fieldStack}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>New value</label>
                  <textarea
                    value={vaultValueInputs.next}
                    onChange={(event) =>
                      setVaultValueInputs((prev: any) => ({
                        ...prev,
                        next: event.target.value,
                      }))
                    }
                    rows={4}
                    className={styles.textareaControl}
                  />
                </div>
                <div className={styles.fieldStack}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                    Confirm new value
                  </label>
                  <textarea
                    value={vaultValueInputs.confirm}
                    onChange={(event) =>
                      setVaultValueInputs((prev: any) => ({
                        ...prev,
                        confirm: event.target.value,
                      }))
                    }
                    rows={4}
                    className={styles.textareaControl}
                  />
                </div>
              </>
            ) : null}
            {vaultValueModal.mode === "show" && vaultValueModal.plaintext ? (
              <div className={styles.fieldStack}>
                <label className={`text-body-tertiary ${styles.fieldLabel}`}>Plaintext</label>
                <textarea
                  readOnly
                  value={vaultValueModal.plaintext}
                  rows={4}
                  className={`${styles.textareaControl} ${styles.textareaReadonly}`}
                />
              </div>
            ) : null}
            {vaultValueModal.error ? (
              <p className={`text-danger ${styles.errorText}`}>{vaultValueModal.error}</p>
            ) : null}
            <div className={styles.actionsRow}>
              <button
                onClick={() => setVaultValueModal(null)}
                className={styles.secondaryButton}
              >
                Close
              </button>
              <button
                onClick={submitVaultValue}
                disabled={vaultValueModal.loading}
                className={styles.primaryButton}
              >
                {vaultValueModal.loading
                  ? "Working..."
                  : vaultValueModal.mode === "show"
                    ? "Reveal"
                    : "Encrypt & replace"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
