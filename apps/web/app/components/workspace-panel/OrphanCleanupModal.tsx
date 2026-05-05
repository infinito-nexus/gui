import styles from "../workspace/Panel.module.css";
import type { OrphanCleanupItem } from "./types";

type Props = {
  open: boolean;
  loading: boolean;
  busy: boolean;
  items: OrphanCleanupItem[];
  selected: Record<string, boolean>;
  error: string | null;
  status: string | null;
  onClose: () => void;
  onRescan: () => void;
  onDeleteSelected: () => void;
  onSetSelectionAll: (checked: boolean) => void;
  onToggleSelection: (path: string, checked: boolean) => void;
};

export default function OrphanCleanupModal({
  open,
  loading,
  busy,
  items,
  selected,
  error,
  status,
  onClose,
  onRescan,
  onDeleteSelected,
  onSetSelectionAll,
  onToggleSelection,
}: Props) {
  if (!open) return null;

  return (
    <div
      onClick={() => {
        if (busy || loading) return;
        onClose();
      }}
      className={styles.cleanupOverlay}
    >
      <div onClick={(event) => event.stopPropagation()} className={styles.cleanupModal}>
        <div className={styles.cleanupHeader}>
          <h3 className={styles.cleanupTitle}>Inventory cleanup</h3>
          <button
            type="button"
            onClick={() => {
              if (busy || loading) return;
              onClose();
            }}
            className={styles.cleanupCloseButton}
          >
            Close
          </button>
        </div>
        <p className={`text-body-secondary ${styles.cleanupHint}`}>
          This scans for orphan `host_vars` and SSH key files that are not referenced by
          `inventory.yml`. Deleting removes them permanently.
        </p>
        {loading ? (
          <p className={`text-body-secondary ${styles.cleanupHint}`}>
            Scanning workspace files...
          </p>
        ) : items.length === 0 ? (
          <p className={`text-body-secondary ${styles.cleanupHint}`}>
            No orphan files found.
          </p>
        ) : (
          <>
            <div className={styles.cleanupToolbar}>
              <button
                type="button"
                onClick={() => onSetSelectionAll(true)}
                className={styles.cleanupActionButton}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onSetSelectionAll(false)}
                className={styles.cleanupActionButton}
              >
                Deselect all
              </button>
            </div>
            <div className={styles.cleanupList}>
              {items.map((item) => (
                <label key={item.path} className={styles.cleanupItem}>
                  <input
                    type="checkbox"
                    checked={Boolean(selected[item.path])}
                    onChange={(event) =>
                      onToggleSelection(item.path, event.target.checked)
                    }
                  />
                  <span className={styles.cleanupItemMeta}>
                    <strong>{item.alias}</strong>
                    <code>{item.path}</code>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {error ? <p className={`text-danger ${styles.cleanupMessage}`}>{error}</p> : null}
        {status ? (
          <p className={`text-success ${styles.cleanupMessage}`}>{status}</p>
        ) : null}
        <div className={styles.cleanupFooter}>
          <button
            type="button"
            onClick={onRescan}
            disabled={busy || loading}
            className={styles.cleanupActionButton}
          >
            Rescan
          </button>
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={busy || loading}
            className={styles.cleanupDeleteButton}
          >
            {busy ? "Deleting..." : "Delete selected"}
          </button>
        </div>
      </div>
    </div>
  );
}
