import styles from "../workspace/Panel.module.css";
import type {
  HistoryOpenIntent,
  WorkspaceHistoryCommit,
  WorkspaceHistoryFileChange,
} from "./types";

type Props = {
  open: boolean;
  restoreBusy: boolean;
  historyLoading: boolean;
  historyDiffLoading: boolean;
  historyError: string | null;
  historyStatus: string | null;
  historyScopePath: string | null;
  historyScopeIsDir: boolean;
  historyOpenIntent: HistoryOpenIntent;
  historyAgainstCurrent: boolean;
  historyCommits: WorkspaceHistoryCommit[];
  historySelectedSha: string | null;
  historySelectedCommit: WorkspaceHistoryCommit | null;
  historyDisplayedFiles: WorkspaceHistoryFileChange[];
  historyDiff: string;
  onClose: () => void;
  onSetAgainstCurrent: (value: boolean) => void;
  onRefresh: () => void;
  onRestorePath: () => void;
  onRestoreWorkspace: () => void;
  onSelectCommit: (sha: string) => void;
};

export default function HistoryModal({
  open,
  restoreBusy,
  historyLoading,
  historyDiffLoading,
  historyError,
  historyStatus,
  historyScopePath,
  historyScopeIsDir,
  historyOpenIntent,
  historyAgainstCurrent,
  historyCommits,
  historySelectedSha,
  historySelectedCommit,
  historyDisplayedFiles,
  historyDiff,
  onClose,
  onSetAgainstCurrent,
  onRefresh,
  onRestorePath,
  onRestoreWorkspace,
  onSelectCommit,
}: Props) {
  if (!open) return null;

  return (
    <div
      className={styles.historyOverlay}
      onClick={() => {
        if (restoreBusy) return;
        onClose();
      }}
    >
      <div className={styles.historyModal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.historyHeader}>
          <div>
            <h3 className={styles.historyTitle}>Workspace History</h3>
            <p className={`text-body-secondary ${styles.historyHint}`}>
              {historyScopePath
                ? `Scope: ${historyScopePath}${historyScopeIsDir ? " (recursive)" : ""}`
                : "Scope: entire workspace"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restoreBusy}
            className={styles.historyActionButton}
          >
            Close
          </button>
        </div>

        <div className={styles.historyToolbar}>
          <button
            type="button"
            onClick={() => onSetAgainstCurrent(false)}
            className={`${styles.historyActionButton} ${
              !historyAgainstCurrent ? styles.historyActionButtonActive : ""
            }`}
          >
            Commit diff
          </button>
          <button
            type="button"
            onClick={() => onSetAgainstCurrent(true)}
            className={`${styles.historyActionButton} ${
              historyAgainstCurrent ? styles.historyActionButtonActive : ""
            }`}
          >
            Diff vs current
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={historyLoading}
            className={styles.historyActionButton}
          >
            {historyLoading ? "Refreshing..." : "Refresh"}
          </button>
          {historyScopePath ? (
            <button
              type="button"
              onClick={onRestorePath}
              disabled={!historySelectedSha || restoreBusy}
              className={styles.historyDangerButton}
            >
              {restoreBusy && historyOpenIntent === "restore"
                ? "Restoring..."
                : "Restore this"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRestoreWorkspace}
            disabled={!historySelectedSha || restoreBusy}
            className={styles.historyDangerButton}
          >
            {restoreBusy ? "Restoring..." : "Restore workspace"}
          </button>
        </div>

        {historyError ? (
          <p className={`text-danger ${styles.historyMessage}`}>{historyError}</p>
        ) : null}
        {historyStatus ? (
          <p className={`text-success ${styles.historyMessage}`}>{historyStatus}</p>
        ) : null}

        <div className={styles.historyBody}>
          <aside className={styles.historyCommitColumn}>
            {historyLoading ? (
              <p className={`text-body-secondary ${styles.historyHint}`}>
                Loading commits...
              </p>
            ) : historyCommits.length === 0 ? (
              <p className={`text-body-secondary ${styles.historyHint}`}>
                No commits found for this scope.
              </p>
            ) : (
              <div className={styles.historyCommitList}>
                {historyCommits.map((entry) => (
                  <button
                    key={entry.sha}
                    type="button"
                    onClick={() => onSelectCommit(entry.sha)}
                    className={`${styles.historyCommitButton} ${
                      historySelectedSha === entry.sha
                        ? styles.historyCommitButtonActive
                        : ""
                    }`}
                  >
                    <span className={styles.historyCommitSummary}>{entry.summary}</span>
                    <span className={styles.historyCommitMeta}>
                      {entry.sha.slice(0, 12)}
                      {entry.created_at
                        ? ` • ${new Date(entry.created_at).toLocaleString()}`
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className={styles.historyDiffColumn}>
            {historySelectedCommit ? (
              <>
                <div className={styles.historySelectedMeta}>
                  <strong>{historySelectedCommit.summary}</strong>
                  <span className={`text-body-secondary ${styles.historyHint}`}>
                    {historySelectedCommit.sha}
                  </span>
                </div>
                {historyDisplayedFiles.length > 0 ? (
                  <ul className={styles.historyFileList}>
                    {historyDisplayedFiles.map((file, index) => (
                      <li key={`${file.status}:${file.path}:${index}`}>
                        <code>{file.status}</code>{" "}
                        {file.old_path ? `${file.old_path} -> ${file.path}` : file.path}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`text-body-secondary ${styles.historyHint}`}>
                    No file-level changes in this view.
                  </p>
                )}
                <div className={styles.historyDiffWrap}>
                  {historyDiffLoading ? (
                    <p className={`text-body-secondary ${styles.historyHint}`}>
                      Loading diff...
                    </p>
                  ) : historyDiff ? (
                    <pre className={styles.historyDiffText}>{historyDiff}</pre>
                  ) : (
                    <p className={`text-body-secondary ${styles.historyHint}`}>
                      No diff output available.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className={`text-body-secondary ${styles.historyHint}`}>
                Select a commit to inspect details.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
