import styles from "../../RoleDashboard.module.css";
import type { Bundle } from "../types";

type RoleDashboardBundleMergePromptProps = {
  prompt: {
    bundle: Bundle;
    alias: string;
  };
  onCancel: () => void;
  onMerge: () => void;
  onOverwrite: () => void;
};

export default function RoleDashboardBundleMergePrompt({
  prompt,
  onCancel,
  onMerge,
  onOverwrite,
}: RoleDashboardBundleMergePromptProps) {
  return (
    <div onClick={onCancel} className={styles.modeConfirmOverlay}>
      <div onClick={(event) => event.stopPropagation()} className={styles.modeConfirmCard}>
        <div className={styles.modeConfirmTitleRow}>
          <i
            className={`fa-solid fa-diagram-project ${styles.modeConfirmIcon}`}
            aria-hidden="true"
          />
          <h3 className={styles.modeConfirmTitle}>Bundle deployment strategy</h3>
        </div>
        <p className={styles.modeConfirmText}>
          Server {prompt.alias} already has app selections. Choose how to apply{" "}
          {prompt.bundle.title}.
        </p>
        <div className={styles.modeConfirmActions}>
          <button onClick={onCancel} className={styles.modeActionButton}>
            <span>Cancel</span>
          </button>
          <button
            onClick={onMerge}
            className={`${styles.modeActionButton} ${styles.modeActionButtonSuccess}`}
          >
            <span>Merge</span>
          </button>
          <button
            onClick={onOverwrite}
            className={`${styles.modeActionButton} ${styles.modeActionButtonDanger}`}
          >
            <span>Overwrite</span>
          </button>
        </div>
      </div>
    </div>
  );
}
