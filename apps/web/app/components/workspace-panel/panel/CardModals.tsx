"use client";

import styles from "./Cards.module.css";

const matrixKey = (alias: string, role: string) => `${alias}::${role}`;

export default function WorkspacePanelCardModals(props: any) {
  const {
    vaultResetConfirmOpen,
    setVaultResetConfirmOpen,
    resetVaultPassword,
    credentialsBusy,
    vaultErrorMessage,
    vaultStatusMessage,
    scopeModalOpen,
    setScopeModalOpen,
    submitIntent,
    setSubmitIntent,
    selectionMode,
    setSelectionMode,
    selectAllCustomCells,
    deselectAllCustomCells,
    selectedCellCount,
    matrixAliases,
    matrixRoles,
    serverRolesByAlias,
    matrixSelection,
    toggleMatrixCell,
    overwriteDraft,
    setOverwriteDraft,
    credentialsError,
    credentialsStatus,
    confirmGenerate,
    canSubmitGenerate,
  } = props;

  return (
    <>
      {vaultResetConfirmOpen ? (
        <div onClick={() => setVaultResetConfirmOpen(false)} className={styles.modalOverlay}>
          <div onClick={(event) => event.stopPropagation()} className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Reset vault password</h3>
            <p className={`text-body-secondary ${styles.statusText}`}>
              Reset vault password and re-encrypt all vault values in this workspace?
            </p>
            <div className={styles.modalActions}>
              <button
                onClick={() => setVaultResetConfirmOpen(false)}
                className={styles.modalButton}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
                Cancel
              </button>
              <button
                onClick={() => {
                  resetVaultPassword();
                }}
                disabled={credentialsBusy}
                className={styles.modalButton}
              >
                <i className="fa-solid fa-check" aria-hidden="true" />
                Continue
              </button>
            </div>
            {vaultErrorMessage ? (
              <p className={`text-danger ${styles.statusText}`}>{vaultErrorMessage}</p>
            ) : null}
            {vaultStatusMessage ? (
              <p className={`text-success ${styles.statusText}`}>{vaultStatusMessage}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {scopeModalOpen ? (
        <div onClick={() => setScopeModalOpen(false)} className={styles.modalOverlay}>
          <div
            onClick={(event) => event.stopPropagation()}
            className={`${styles.modalCard} ${styles.modalCardLarge}`}
          >
            <h3 className={styles.modalTitle}>App credentials</h3>

            <div className={styles.radioGroup}>
              <span className={`text-body-tertiary ${styles.label}`}>Action</span>
              <label className={`text-body-secondary ${styles.radioLabel}`}>
                <input
                  type="radio"
                  name="credentials-action-modal"
                  checked={submitIntent === "generate"}
                  onChange={() => setSubmitIntent("generate")}
                />
                Generate
              </label>
              <label className={`text-body-secondary ${styles.radioLabel}`}>
                <input
                  type="radio"
                  name="credentials-action-modal"
                  checked={submitIntent === "regenerate"}
                  onChange={() => setSubmitIntent("regenerate")}
                />
                Regenerate
              </label>
            </div>

            <div className={styles.tabRow}>
              <button
                onClick={() => setSelectionMode("all")}
                className={`${styles.tabButton} ${
                  selectionMode === "all" ? styles.tabButtonActive : ""
                }`}
              >
                All
              </button>
              <button
                onClick={() => setSelectionMode("custom")}
                className={`${styles.tabButton} ${
                  selectionMode === "custom" ? styles.tabButtonActive : ""
                }`}
              >
                Custom
              </button>
            </div>

            {selectionMode === "all" ? (
              <p className={`text-body-secondary ${styles.statusText}`}>
                All available server-role targets will run. Regenerate recreates all of them.
              </p>
            ) : (
              <div className={styles.matrixBlock}>
                <div className={styles.matrixToolbar}>
                  <button onClick={selectAllCustomCells} className={styles.matrixActionButton}>
                    Select all
                  </button>
                  <button onClick={deselectAllCustomCells} className={styles.matrixActionButton}>
                    Deselect all
                  </button>
                  <span className={`text-body-secondary ${styles.helpSmall}`}>
                    {selectedCellCount} selected
                  </span>
                </div>
                {matrixAliases.length === 0 || matrixRoles.length === 0 ? (
                  <p className={`text-body-secondary ${styles.statusText}`}>
                    No selected roles available.
                  </p>
                ) : (
                  <div className={styles.matrixContainer}>
                    <table className={styles.matrixTable}>
                      <thead>
                        <tr>
                          <th>Role</th>
                          {matrixAliases.map((alias: string) => (
                            <th key={alias}>{alias}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixRoles.map((roleId: string) => (
                          <tr key={roleId}>
                            <th>{roleId}</th>
                            {matrixAliases.map((alias: string) => {
                              const available = (serverRolesByAlias?.[alias] ?? []).includes(
                                roleId
                              );
                              const cellId = matrixKey(alias, roleId);
                              return (
                                <td key={cellId}>
                                  {available ? (
                                    <input
                                      type="checkbox"
                                      checked={Boolean(matrixSelection[cellId])}
                                      onChange={() => toggleMatrixCell(alias, roleId)}
                                      disabled={credentialsBusy}
                                      className={styles.matrixCheckbox}
                                    />
                                  ) : (
                                    <span className={styles.matrixUnavailable}>-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {submitIntent !== "regenerate" ? (
              <label className={`text-body-secondary ${styles.checkboxLabel}`}>
                <input
                  type="checkbox"
                  checked={overwriteDraft}
                  onChange={(event) => setOverwriteDraft(event.target.checked)}
                />
                Overwrite existing credentials
              </label>
            ) : (
              <span className={`text-body-secondary ${styles.helpSmall}`}>
                Recreate always runs in overwrite mode.
              </span>
            )}

            {credentialsError ? (
              <p className={`text-danger ${styles.statusText}`}>{credentialsError}</p>
            ) : null}
            {credentialsStatus ? (
              <p className={`text-success ${styles.statusText}`}>{credentialsStatus}</p>
            ) : null}

            <div className={styles.modalActions}>
              <button onClick={() => setScopeModalOpen(false)} className={styles.modalButton}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
                Close
              </button>
              <button
                onClick={confirmGenerate}
                disabled={!canSubmitGenerate || credentialsBusy}
                className={styles.modalButton}
              >
                <i className="fa-solid fa-play" aria-hidden="true" />
                {credentialsBusy
                  ? "Working..."
                  : submitIntent === "regenerate"
                    ? "Recreate"
                    : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
