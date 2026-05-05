import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import styles from "../../RoleDashboard.module.css";
import type { Role } from "../types";

type RoleDashboardConfigEditorModalProps = {
  editingRole: Role;
  editorAlias: string;
  editorPath: string;
  editorContent: string;
  editorBusy: boolean;
  editorError: string | null;
  editorStatus: string | null;
  canImportDefaults: boolean;
  canSave: boolean;
  onClose: () => void;
  onEditorContentChange: (value: string) => void;
  onImportDefaults: () => void;
  onSave: () => void;
};

export default function RoleDashboardConfigEditorModal({
  editingRole,
  editorAlias,
  editorPath,
  editorContent,
  editorBusy,
  editorError,
  editorStatus,
  canImportDefaults,
  canSave,
  onClose,
  onEditorContentChange,
  onImportDefaults,
  onSave,
}: RoleDashboardConfigEditorModalProps) {
  const editorExtensions = useMemo(() => [yamlLang()], []);

  return (
    <div onClick={onClose} className={styles.configEditorOverlay}>
      <div onClick={(event) => event.stopPropagation()} className={styles.configEditorCard}>
        <div className={styles.configEditorHeader}>
          <div>
            <h3 className={styles.configEditorTitle}>Edit app config: {editingRole.display_name}</h3>
            <p className={`text-body-secondary ${styles.configEditorMeta}`}>
              {editorAlias ? `Alias: ${editorAlias} · ` : ""}
              {editorPath || "host_vars file"}
            </p>
          </div>
        </div>
        <div className={styles.configEditorSurface}>
          <CodeMirror
            value={editorContent}
            height="100%"
            editable={!editorBusy}
            extensions={editorExtensions}
            onChange={onEditorContentChange}
            className={styles.configEditorCodeMirror}
          />
        </div>
        {editorError ? (
          <p className={`text-danger ${styles.configEditorMessage}`}>{editorError}</p>
        ) : null}
        {editorStatus ? (
          <p className={`text-success ${styles.configEditorMessage}`}>{editorStatus}</p>
        ) : null}
        <div className={styles.configEditorActions}>
          <button
            onClick={onImportDefaults}
            disabled={editorBusy || !canImportDefaults}
            className={styles.modeActionButton}
          >
            {editorBusy ? "Working..." : "Import defaults"}
          </button>
          <button onClick={onClose} className={styles.modeActionButton}>
            Close
          </button>
          <button
            onClick={onSave}
            disabled={editorBusy || !canSave}
            className={`${styles.modeActionButton} ${styles.modeActionButtonPrimary}`}
          >
            {editorBusy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
