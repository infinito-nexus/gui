"use client";

import styles from "./WorkspacePanelHeader.module.css";
import type { WorkspaceListEntry } from "./types";

type WorkspacePanelHeaderProps = {
  compact: boolean;
  userId: string | null;
  workspaceId: string | null;
  inventoryReady: boolean;
  workspaceList: WorkspaceListEntry[];
  workspaceError: string | null;
  inventorySyncError: string | null;
  workspaceLoading?: boolean;
  deletingWorkspaceId?: string | null;
  onCreateWorkspace: () => void;
  onSelectWorkspace: (id: string) => void;
  onDeleteWorkspace?: (id: string) => void;
};

export default function WorkspacePanelHeader({
  compact,
  userId,
  workspaceId,
  inventoryReady,
  workspaceList,
  workspaceError,
  inventorySyncError,
  workspaceLoading = false,
  deletingWorkspaceId = null,
  onCreateWorkspace,
  onSelectWorkspace,
  onDeleteWorkspace,
}: WorkspacePanelHeaderProps) {
  const workspaceSummary = (
    <div
      className={`text-body-secondary ${styles.topRight}`}
      data-workspace-id={workspaceId || "creating"}
    >
      Workspace: <strong>{workspaceId ? workspaceId : "creating..."}</strong>
      <br />
      Inventory: <strong>{inventoryReady ? "ready" : "not generated"}</strong>
    </div>
  );

  return (
    <>
      {!compact ? (
        <div className={styles.topRow}>
          <div className={styles.topLeft}>
            <h2 className={`text-body ${styles.title}`}>Inventory</h2>
            <p className={`text-body-secondary ${styles.subtitle}`}>
              Step-by-step: select roles → edit files → generate credentials → export
              ZIP or deploy.
            </p>
          </div>
          {workspaceSummary}
        </div>
      ) : null}

      {compact ? (
        <div className={styles.topRow}>
          <div className={styles.topLeft}>
            <h2 className={`text-body ${styles.title}`}>Inventory</h2>
          </div>
          {workspaceSummary}
        </div>
      ) : null}

      {userId ? (
        <div className={styles.workspaceCard}>
          <div className={styles.workspaceCardHeader}>
            <div>
              <h3 className={styles.workspaceTitle}>Workspaces</h3>
              <p className={`text-body-secondary ${styles.workspaceHint}`}>
                Signed in as {userId}
              </p>
            </div>
            <button
              onClick={onCreateWorkspace}
              className={styles.newWorkspaceButton}
              disabled={workspaceLoading}
            >
              {workspaceLoading ? "Creating..." : "New workspace"}
            </button>
          </div>
          <div className={styles.workspaceList}>
            {workspaceList.length === 0 ? (
              <div className={`text-body-secondary ${styles.emptyState}`}>
                No workspaces yet. Create one to get started.
              </div>
            ) : (
              workspaceList.map((entry) => (
                <div
                  key={entry.id}
                  className={`${styles.workspaceItemRow} ${
                    entry.id === workspaceId ? styles.workspaceItemRowActive : ""
                  }`}
                >
                  <button
                    onClick={() => onSelectWorkspace(entry.id)}
                    className={`${styles.workspaceItem} ${
                      entry.id === workspaceId ? styles.workspaceItemActive : ""
                    }`}
                  >
                    <span className={styles.workspaceItemMain}>
                      <span>{entry.name || entry.id}</span>
                      <span className={styles.workspaceState}>
                        {(entry.state || "draft").toLowerCase()}
                      </span>
                    </span>
                    <span className={styles.workspaceTimestamp}>
                      {(() => {
                        const ts = entry.last_modified_at || entry.last_used || null;
                        if (!ts) return "new";
                        const parsed = new Date(ts);
                        return Number.isNaN(parsed.getTime())
                          ? "new"
                          : parsed.toLocaleString();
                      })()}
                    </span>
                  </button>
                  {onDeleteWorkspace ? (
                    <button
                      type="button"
                      className={styles.deleteWorkspaceButton}
                      onClick={() => onDeleteWorkspace(entry.id)}
                      disabled={deletingWorkspaceId === entry.id}
                      title="Delete workspace"
                    >
                      {deletingWorkspaceId === entry.id ? "Deleting..." : "Delete"}
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {workspaceError ? (
        <div className={`text-danger ${styles.errorTop}`}>{workspaceError}</div>
      ) : null}
      {inventorySyncError ? (
        <div className={`text-danger ${styles.errorBottom}`}>{inventorySyncError}</div>
      ) : null}
    </>
  );
}
