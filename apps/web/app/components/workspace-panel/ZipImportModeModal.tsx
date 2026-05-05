import styles from "../workspace/Panel.module.css";
import type { ZipImportMode, ZipImportPreviewFile } from "./types";

type Props = {
  open: boolean;
  fileName: string;
  busy: boolean;
  previewBusy: boolean;
  items: ZipImportPreviewFile[];
  modeByPath: Record<string, ZipImportMode>;
  applyToAll: boolean;
  allMode: ZipImportMode;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onToggleApplyToAll: (checked: boolean) => void;
  onSetAllMode: (mode: ZipImportMode) => void;
  onSetModeForPath: (path: string, mode: ZipImportMode) => void;
};

export default function ZipImportModeModal({
  open,
  fileName,
  busy,
  previewBusy,
  items,
  modeByPath,
  applyToAll,
  allMode,
  error,
  onClose,
  onConfirm,
  onToggleApplyToAll,
  onSetAllMode,
  onSetModeForPath,
}: Props) {
  if (!open) return null;

  const modalBusy = busy || previewBusy;
  const fileLabel = fileName || "workspace.zip";

  return (
    <div
      onClick={() => {
        if (modalBusy) return;
        onClose();
      }}
      className={styles.zipImportOverlay}
    >
      <div onClick={(event) => event.stopPropagation()} className={styles.zipImportModal}>
        <div className={styles.zipImportHeader}>
          <h3 className={styles.zipImportTitle}>ZIP import strategy</h3>
          <button
            type="button"
            onClick={() => {
              if (modalBusy) return;
              onClose();
            }}
            className={styles.cleanupCloseButton}
          >
            Close
          </button>
        </div>

        <p className={`text-body-secondary ${styles.zipImportHint}`}>
          Selected file: <code>{fileLabel}</code>
        </p>
        <p className={`text-body-secondary ${styles.zipImportHint}`}>
          Choose <strong>override</strong> or <strong>merge</strong> per file. Merge is
          supported for YAML/JSON mapping files.
        </p>

        <div className={styles.zipImportToolbar}>
          <label className={styles.zipImportApplyAllLabel}>
            <input
              type="checkbox"
              checked={applyToAll}
              disabled={modalBusy || items.length === 0}
              onChange={(event) => onToggleApplyToAll(event.target.checked)}
            />
            Apply action to all files
          </label>
          <div className={styles.zipImportModeGroup}>
            <label className={styles.zipImportModeLabel}>
              <input
                type="radio"
                name="zip-import-all-mode"
                checked={allMode === "override"}
                disabled={modalBusy || items.length === 0}
                onChange={() => onSetAllMode("override")}
              />
              Override
            </label>
            <label className={styles.zipImportModeLabel}>
              <input
                type="radio"
                name="zip-import-all-mode"
                checked={allMode === "merge"}
                disabled={modalBusy || items.length === 0}
                onChange={() => onSetAllMode("merge")}
              />
              Merge
            </label>
          </div>
        </div>

        {previewBusy ? (
          <p className={`text-body-secondary ${styles.zipImportHint}`}>
            Inspecting ZIP contents...
          </p>
        ) : items.length === 0 ? (
          <p className={`text-body-secondary ${styles.zipImportHint}`}>
            ZIP contains no importable files.
          </p>
        ) : (
          <div className={styles.zipImportTableWrap}>
            <table className={styles.zipImportTable}>
              <thead>
                <tr>
                  <th>File</th>
                  <th>State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const mode = modeByPath[item.path] || "override";
                  const radioName = `zip-import-${item.path}`;
                  return (
                    <tr key={item.path}>
                      <td>
                        <code className={styles.zipImportPath}>{item.path}</code>
                      </td>
                      <td>
                        <span
                          className={
                            item.exists
                              ? styles.zipImportStateExists
                              : styles.zipImportStateNew
                          }
                        >
                          {item.exists ? "exists" : "new"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.zipImportModeGroup}>
                          <label className={styles.zipImportModeLabel}>
                            <input
                              type="radio"
                              name={radioName}
                              checked={mode === "override"}
                              disabled={modalBusy || applyToAll}
                              onChange={() =>
                                onSetModeForPath(item.path, "override")
                              }
                            />
                            Override
                          </label>
                          <label className={styles.zipImportModeLabel}>
                            <input
                              type="radio"
                              name={radioName}
                              checked={mode === "merge"}
                              disabled={modalBusy || applyToAll}
                              onChange={() => onSetModeForPath(item.path, "merge")}
                            />
                            Merge
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error ? <p className={`text-danger ${styles.cleanupMessage}`}>{error}</p> : null}

        <div className={styles.zipImportFooter}>
          <button
            type="button"
            onClick={() => {
              if (modalBusy) return;
              onClose();
            }}
            disabled={modalBusy}
            className={styles.cleanupActionButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={modalBusy || items.length === 0}
            className={styles.cleanupDeleteButton}
          >
            {busy ? "Importing..." : "Import now"}
          </button>
        </div>
      </div>
    </div>
  );
}
