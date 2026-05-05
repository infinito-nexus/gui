import styles from "../workspace/Panel.module.css";

type Props = {
  open: boolean;
  saveInProgress: boolean;
  leaveGuardMessage: string | null;
  lastSaveAckAt: string | null;
  onSaveAndLeave: () => void;
  onCancel: () => void;
};

export default function LeaveGuardModal({
  open,
  saveInProgress,
  leaveGuardMessage,
  lastSaveAckAt,
  onSaveAndLeave,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className={styles.leaveGuardOverlay} onClick={onCancel}>
      <div className={styles.leaveGuardModal} onClick={(event) => event.stopPropagation()}>
        <h3 className={styles.leaveGuardTitle}>Unsaved changes</h3>
        <p className={`text-body-secondary ${styles.leaveGuardHint}`}>
          {leaveGuardMessage || "Unsaved changes detected. Save and leave?"}
        </p>
        {lastSaveAckAt ? (
          <p className={`text-body-secondary ${styles.leaveGuardHint}`}>
            Last save acknowledged at {new Date(lastSaveAckAt).toLocaleTimeString()}.
          </p>
        ) : null}
        <div className={styles.leaveGuardActions}>
          <button
            type="button"
            onClick={onSaveAndLeave}
            disabled={saveInProgress}
            className={styles.leaveGuardSaveButton}
          >
            {saveInProgress ? "Saving..." : "Save and leave"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={styles.leaveGuardCancelButton}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
