"use client";

import type { CSSProperties } from "react";
import WorkspacePanelSecurityModals from "./SecurityModals";
import styles from "./Overlays.module.css";

export default function WorkspacePanelOverlays(props: any) {
  const {
    contextMenu,
    setContextMenu,
    createFile,
    createDirectory,
    renameFile,
    downloadFile,
    deleteFile,
    openHistoryForPath,
    openDiffCurrentForPath,
    openRestoreForPath,
    setMasterChangeOpen,
    setMasterChangeMode,
    setMasterChangeError,
    setKeyPassphraseModal,
    setKeyPassphraseError,
    editorMenu,
    setEditorMenu,
    openVaultValueModal,
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
    masterChangeMode,
    masterChangeValues,
    setMasterChangeValues,
    masterChangeError,
    submitMasterChange,
    masterChangeBusy,
    keyPassphraseModal,
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

  const menuPositionStyle = (x: number, y: number) => {
    const top =
      typeof window !== "undefined" ? Math.min(y, window.innerHeight - 120) : y;
    const left =
      typeof window !== "undefined" ? Math.min(x, window.innerWidth - 180) : x;
    return {
      "--menu-top": `${top}px`,
      "--menu-left": `${left}px`,
    } as CSSProperties;
  };

  return (
    <>
      {contextMenu ? (
        <div
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className={`${styles.contextMenu} ${styles.contextMenuPrimary}`}
          style={menuPositionStyle(contextMenu.x, contextMenu.y)}
        >
          <button
            onClick={() => {
              const base =
                contextMenu.path && contextMenu.isDir
                  ? contextMenu.path
                  : contextMenu.path
                  ? contextMenu.path.split("/").slice(0, -1).join("/")
                  : "";
              setContextMenu(null);
              createFile(base);
            }}
            className={styles.contextButton}
          >
            New file…
          </button>
          <button
            onClick={() => {
              const base =
                contextMenu.path && contextMenu.isDir
                  ? contextMenu.path
                  : contextMenu.path
                  ? contextMenu.path.split("/").slice(0, -1).join("/")
                  : "";
              setContextMenu(null);
              createDirectory(base);
            }}
            className={styles.contextButton}
          >
            New folder…
          </button>
          {contextMenu.path ? <div className={styles.separator} /> : null}
          {contextMenu.path ? (
            <button
              onClick={() => {
                const path = contextMenu.path;
                if (!path) return;
                setContextMenu(null);
                openHistoryForPath(path, contextMenu.isDir);
              }}
              className={styles.contextButton}
            >
              History
            </button>
          ) : null}
          {contextMenu.path ? (
            <button
              onClick={() => {
                const path = contextMenu.path;
                if (!path) return;
                setContextMenu(null);
                openDiffCurrentForPath(path, contextMenu.isDir);
              }}
              className={styles.contextButton}
            >
              Diff vs current
            </button>
          ) : null}
          {contextMenu.path ? (
            <button
              onClick={() => {
                const path = contextMenu.path;
                if (!path) return;
                setContextMenu(null);
                openRestoreForPath(path, contextMenu.isDir);
              }}
              className={styles.contextButton}
            >
              Restore this
            </button>
          ) : null}
          {contextMenu.path ? <div className={styles.separator} /> : null}
          {contextMenu.path ? (
            <button
              onClick={() => {
                const path = contextMenu.path;
                if (!path) return;
                setContextMenu(null);
                renameFile(path, contextMenu.isDir);
              }}
              className={styles.contextButton}
            >
              Rename{contextMenu.isDir ? " folder" : ""}
            </button>
          ) : null}
          {contextMenu.path && !contextMenu.isDir ? (
            <button
              onClick={() => {
                const path = contextMenu.path;
                if (!path) return;
                setContextMenu(null);
                downloadFile(path);
              }}
              className={styles.contextButton}
            >
              Download file
            </button>
          ) : null}
          {contextMenu.path ? (
            <button
              onClick={() => {
                const path = contextMenu.path;
                if (!path) return;
                setContextMenu(null);
                deleteFile(path, contextMenu.isDir);
              }}
              className={`${styles.contextButton} ${styles.contextButtonDanger}`}
            >
              Delete{contextMenu.isDir ? " folder" : ""}
            </button>
          ) : null}
          {contextMenu.path
            ? (() => {
                const isVault = contextMenu.path === "secrets/credentials.kdbx";
                const keyAlias =
                  contextMenu.path.startsWith("secrets/keys/") &&
                  !contextMenu.path.endsWith(".pub")
                    ? contextMenu.path.split("/").pop() || ""
                    : "";
                if (!isVault && !keyAlias) return null;
                return (
                  <>
                    <div className={styles.separator} />
                    {isVault ? (
                      <button
                        onClick={() => {
                          setContextMenu(null);
                          setMasterChangeMode("reset");
                          setMasterChangeOpen(true);
                          setMasterChangeError(null);
                        }}
                        className={styles.contextButton}
                      >
                        Change master password…
                      </button>
                    ) : null}
                    {keyAlias ? (
                      <button
                        onClick={() => {
                          setContextMenu(null);
                          setKeyPassphraseModal({ alias: keyAlias });
                          setKeyPassphraseError(null);
                        }}
                        className={styles.contextButton}
                      >
                        Change key passphrase…
                      </button>
                    ) : null}
                  </>
                );
              })()
            : null}
        </div>
      ) : null}
      {editorMenu ? (
        <div
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className={`${styles.contextMenu} ${styles.contextMenuEditor}`}
          style={menuPositionStyle(editorMenu.x, editorMenu.y)}
        >
          <button
            onClick={() => openVaultValueModal("show", editorMenu.block)}
            className={styles.contextButton}
          >
            Show plaintext…
          </button>
          <button
            onClick={() => openVaultValueModal("change", editorMenu.block)}
            className={styles.contextButton}
          >
            Change value…
          </button>
        </div>
      ) : null}
      <WorkspacePanelSecurityModals
        kdbxPromptOpen={kdbxPromptOpen}
        handleKdbxSubmit={handleKdbxSubmit}
        setKdbxPromptOpen={setKdbxPromptOpen}
        setEditorLoading={setEditorLoading}
        vaultPromptOpen={vaultPromptOpen}
        vaultPromptConfirm={vaultPromptConfirm}
        handleVaultPromptSubmit={handleVaultPromptSubmit}
        setVaultPromptOpen={setVaultPromptOpen}
        setVaultPromptMode={setVaultPromptMode}
        setPendingCredentials={setPendingCredentials}
        masterChangeOpen={masterChangeOpen}
        setMasterChangeOpen={setMasterChangeOpen}
        masterChangeMode={masterChangeMode}
        masterChangeValues={masterChangeValues}
        setMasterChangeValues={setMasterChangeValues}
        masterChangeError={masterChangeError}
        submitMasterChange={submitMasterChange}
        masterChangeBusy={masterChangeBusy}
        keyPassphraseModal={keyPassphraseModal}
        setKeyPassphraseModal={setKeyPassphraseModal}
        keyPassphraseValues={keyPassphraseValues}
        setKeyPassphraseValues={setKeyPassphraseValues}
        keyPassphraseError={keyPassphraseError}
        submitKeyPassphraseChange={submitKeyPassphraseChange}
        keyPassphraseBusy={keyPassphraseBusy}
        vaultValueModal={vaultValueModal}
        setVaultValueModal={setVaultValueModal}
        vaultValueInputs={vaultValueInputs}
        setVaultValueInputs={setVaultValueInputs}
        submitVaultValue={submitVaultValue}
      />
    </>
  );
}
