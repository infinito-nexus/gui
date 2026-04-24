"use client";

import type { CSSProperties } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { findVaultBlock } from "./utils";
import styles from "./WorkspacePanelFileEditor.module.css";

export default function WorkspacePanelFileEditor(props: any) {
  const {
    activePath,
    activeExtension,
    isKdbx,
    editorDirty,
    editorLoading,
    saveFile,
    loadFile,
    kdbxPasswordRef,
    lockKdbx,
    setKdbxPromptOpen,
    editorValue,
    setEditorValue,
    setEditorDirty,
    setEditorStatus,
    setEditorError,
    editorExtensions,
    editorViewRef,
    setContextMenu,
    setEditorMenu,
    kdbxLoading,
    kdbxError,
    kdbxEntries,
    kdbxRevealed,
    setKdbxRevealed,
    editorError,
    editorStatus,
    openDirs,
    treeItems,
    toggleDir,
    fileOpError,
    openContextMenu,
    editorOverrideContent,
  } = props;

  return (
    <div className={styles.root}>
      <div className={`${styles.panel} ${styles.filesPanel}`}>
        <label className={`text-body-tertiary ${styles.label}`}>Files</label>
        <div className={`text-body-tertiary ${styles.helperText}`}>
          Right-click to create files or folders.
        </div>
        <div
          className={styles.treeWrap}
          onContextMenu={(event) => openContextMenu(event, null, false)}
        >
          {treeItems.length === 0 ? (
            <p className={`text-body-tertiary ${styles.emptyMessage}`}>
              No files yet. Inventory will appear once roles and host/user are set.
            </p>
          ) : (
            treeItems.map((item: any) => {
              const treeStyle = {
                "--tree-indent": `${item.depth * 12}px`,
              } as CSSProperties;
              return (
                <div
                  key={item.path}
                  onClick={() =>
                    item.isDir ? toggleDir(item.path) : loadFile(item.path)
                  }
                  onContextMenu={(event) => {
                    openContextMenu(event, item.path, item.isDir);
                  }}
                  className={`${styles.treeItem} ${
                    !item.isDir && item.path === activePath ? styles.treeItemActive : ""
                  }`}
                  style={treeStyle}
                >
                  <span className={styles.treeIcon}>
                    {item.isDir ? (openDirs.has(item.path) ? "▾" : "▸") : "•"}
                  </span>
                  <span>{item.name}</span>
                </div>
              );
            })
          )}
        </div>
        {fileOpError ? (
          <p className={`text-danger ${styles.statusMessage}`}>{fileOpError}</p>
        ) : null}
      </div>

      <div className={`${styles.panel} ${styles.editorPanel}`}>
        <label className={`text-body-tertiary ${styles.label}`}>Editor</label>
        <div className={styles.editorWrap}>
          {editorOverrideContent ? (
            editorOverrideContent
          ) : !activePath ? (
            <p className={`text-body-tertiary ${styles.emptyMessage}`}>
              Select a file from the workspace to edit it.
            </p>
          ) : (
            <>
              <div className={`text-body-secondary ${styles.toolbar}`}>
                <span>
                  {activePath} · {activeExtension.toUpperCase()}
                </span>
                <div className={styles.toolbarActions}>
                  {!isKdbx ? (
                    <button
                      onClick={saveFile}
                      disabled={!editorDirty || editorLoading}
                      className={`${styles.button} ${styles.primaryButton} ${
                        editorDirty
                          ? styles.primaryButtonEnabled
                          : styles.primaryButtonDisabled
                      }`}
                    >
                      {editorLoading ? "Saving..." : "Save"}
                    </button>
                  ) : null}
                  <button
                    onClick={() => activePath && loadFile(activePath)}
                    disabled={editorLoading}
                    className={`${styles.button} ${styles.secondaryButton}`}
                  >
                    Reload
                  </button>
                  {isKdbx ? (
                    <button
                      onClick={() =>
                        kdbxPasswordRef.current ? lockKdbx() : setKdbxPromptOpen(true)
                      }
                      className={`${styles.button} ${styles.secondaryButton}`}
                    >
                      {kdbxPasswordRef.current ? "Lock" : "Unlock"}
                    </button>
                  ) : null}
                </div>
              </div>
              {activeExtension === "markdown" ? (
                <div className={styles.editorSurface}>
                  <CodeMirror
                    value={editorValue}
                    height="100%"
                    className={styles.codeEditor}
                    onCreateEditor={(view) => {
                      editorViewRef.current = view;
                    }}
                    onChange={(value) => {
                      setEditorValue(value);
                      setEditorDirty(true);
                      setEditorStatus(null);
                      setEditorError(null);
                    }}
                  />
                </div>
              ) : isKdbx ? (
                <div className={styles.kdbxPanel}>
                  {kdbxLoading ? (
                    <p className={`text-body-tertiary ${styles.kdbxMessage}`}>
                      Loading KDBX entries...
                    </p>
                  ) : null}
                  {kdbxError ? (
                    <p className={`text-danger ${styles.kdbxMessage}`}>{kdbxError}</p>
                  ) : null}
                  {!kdbxLoading && !kdbxError && kdbxEntries.length === 0 ? (
                    <p className={`text-body-tertiary ${styles.kdbxMessage}`}>
                      Unlock credentials.kdbx to view entries.
                    </p>
                  ) : null}
                  {kdbxEntries.length > 0 ? (
                    <div className={styles.kdbxEntryList}>
                      {kdbxEntries.map((entry: any) => (
                        <div key={entry.id} className={styles.kdbxEntry}>
                          <div className={styles.kdbxEntryHeader}>
                            <strong>{entry.title}</strong>
                            <span className="text-body-tertiary">{entry.group}</span>
                          </div>
                          <div>
                            <span className="text-body-tertiary">User:</span>{" "}
                            {entry.username || "-"}
                          </div>
                          <div className={styles.passwordRow}>
                            <span className="text-body-tertiary">Password:</span>
                            <span>
                              {entry.password
                                ? kdbxRevealed[entry.id]
                                  ? entry.password
                                  : "••••••••"
                                : "-"}
                            </span>
                            {entry.password ? (
                              <button
                                onClick={() =>
                                  setKdbxRevealed((prev: any) => ({
                                    ...prev,
                                    [entry.id]: !prev[entry.id],
                                  }))
                                }
                                className={styles.revealButton}
                              >
                                {kdbxRevealed[entry.id] ? "Hide" : "Show"}
                              </button>
                            ) : null}
                          </div>
                          {entry.url ? (
                            <div>
                              <span className="text-body-tertiary">URL:</span> {entry.url}
                            </div>
                          ) : null}
                          {entry.notes ? (
                            <div>
                              <span className="text-body-tertiary">Notes:</span> {entry.notes}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.editorSurface}>
                  <CodeMirror
                    value={editorValue}
                    height="100%"
                    className={styles.codeEditor}
                    extensions={editorExtensions}
                    onCreateEditor={(view) => {
                      editorViewRef.current = view;
                    }}
                    onContextMenu={(event) => {
                      const view = editorViewRef.current;
                      if (!view) return;
                      const pos = view.posAtCoords({
                        x: event.clientX,
                        y: event.clientY,
                      });
                      if (pos == null) return;
                      const line = view.state.doc.lineAt(pos).number;
                      const lines = editorValue.split("\n");
                      const block = findVaultBlock(lines, line - 1);
                      if (!block) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu(null);
                      setEditorMenu({
                        x: event.clientX,
                        y: event.clientY,
                        block,
                      });
                    }}
                    onChange={(value) => {
                      setEditorValue(value);
                      setEditorDirty(true);
                      setEditorStatus(null);
                      setEditorError(null);
                    }}
                  />
                </div>
              )}
              {editorError ? (
                <p className={`text-danger ${styles.statusMessage}`}>{editorError}</p>
              ) : null}
              {editorStatus ? (
                <p className={`text-success ${styles.statusMessage}`}>{editorStatus}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
