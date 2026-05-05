import type { ChangeEvent, RefObject } from "react";
import styles from "../workspace/Panel.module.css";
import type { WorkspaceUser } from "./users-utils";

type Props = {
  open: boolean;
  usersGroupVarsPath: string;
  usersLoading: boolean;
  usersSaving: boolean;
  usersDraft: WorkspaceUser[];
  usersSelection: Record<string, boolean>;
  selectedUsersCount: number;
  usersError: string | null;
  usersStatus: string | null;
  usersImportInputRef: RefObject<HTMLInputElement>;
  onSetUsersSelectionAll: (checked: boolean) => void;
  onDeleteSelectedUsers: () => void;
  onSaveWorkspaceUsers: () => void;
  onCloseUsersEditor: () => void;
  onStartCreateUserEditor: () => void;
  onToggleUserSelection: (username: string, checked: boolean) => void;
  onStartEditUserEditor: (username: string) => void;
  onRemoveUserDraft: (username: string) => void;
  onHandleUsersImportSelect: (event: ChangeEvent<HTMLInputElement>) => void;
};

export default function UsersOverviewPanel({
  open,
  usersGroupVarsPath,
  usersLoading,
  usersSaving,
  usersDraft,
  usersSelection,
  selectedUsersCount,
  usersError,
  usersStatus,
  usersImportInputRef,
  onSetUsersSelectionAll,
  onDeleteSelectedUsers,
  onSaveWorkspaceUsers,
  onCloseUsersEditor,
  onStartCreateUserEditor,
  onToggleUserSelection,
  onStartEditUserEditor,
  onRemoveUserDraft,
  onHandleUsersImportSelect,
}: Props) {
  if (!open) return null;

  return (
    <div className={styles.usersEditorHost}>
      <div className={styles.usersEditorTopbar}>
        <span className={`text-body-secondary ${styles.usersHint}`}>
          Users overview from <code>{usersGroupVarsPath}</code>
        </span>
        <div className={styles.usersToolbar}>
          <button
            type="button"
            onClick={() => onSetUsersSelectionAll(true)}
            disabled={usersLoading || usersDraft.length === 0}
            className={styles.usersSecondaryButton}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onSetUsersSelectionAll(false)}
            disabled={usersLoading || usersDraft.length === 0}
            className={styles.usersSecondaryButton}
          >
            Deselect all
          </button>
          <button
            type="button"
            onClick={onDeleteSelectedUsers}
            disabled={usersLoading || usersSaving || selectedUsersCount === 0}
            className={styles.usersDeleteButton}
          >
            Delete selected ({selectedUsersCount})
          </button>
          <button
            type="button"
            onClick={onSaveWorkspaceUsers}
            disabled={usersLoading || usersSaving}
            className={styles.usersPrimaryButton}
          >
            {usersSaving ? "Saving..." : "Save users"}
          </button>
          <button
            type="button"
            onClick={onCloseUsersEditor}
            disabled={usersSaving}
            className={styles.usersSecondaryButton}
          >
            Close overview
          </button>
        </div>
      </div>

      {usersLoading ? (
        <p className={`text-body-secondary ${styles.usersHint}`}>Loading users...</p>
      ) : (
        <div className={styles.usersWorkspace}>
          <section className={styles.usersOverview}>
            <div className={styles.usersSectionHeader}>
              <h4 className={styles.usersSectionTitle}>Overview</h4>
              <button
                type="button"
                onClick={onStartCreateUserEditor}
                disabled={usersSaving}
                className={styles.usersSecondaryButton}
              >
                New
              </button>
            </div>
            <div className={styles.usersTableWrap}>
              {usersDraft.length === 0 ? (
                <p className={`text-body-secondary ${styles.usersHint}`}>No users added.</p>
              ) : (
                <table className={styles.usersTable}>
                  <thead>
                    <tr>
                      <th />
                      <th>Username</th>
                      <th>Firstname</th>
                      <th>Lastname</th>
                      <th>Email</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersDraft.map((user) => (
                      <tr key={user.username}>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(usersSelection[user.username])}
                            onChange={(event) =>
                              onToggleUserSelection(user.username, event.target.checked)
                            }
                          />
                        </td>
                        <td>{user.username}</td>
                        <td>{user.firstname}</td>
                        <td>{user.lastname}</td>
                        <td>{user.email || "-"}</td>
                        <td>
                          <div className={styles.usersListActions}>
                            <button
                              type="button"
                              onClick={() => onStartEditUserEditor(user.username)}
                              disabled={usersSaving}
                              className={styles.usersSecondaryButton}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveUserDraft(user.username)}
                              disabled={usersSaving}
                              className={styles.usersDeleteButton}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      {usersError ? (
        <p className={`text-danger ${styles.usersMessage}`}>{usersError}</p>
      ) : null}
      {usersStatus ? (
        <p className={`text-success ${styles.usersMessage}`}>{usersStatus}</p>
      ) : null}
      <input
        ref={usersImportInputRef}
        type="file"
        accept=".csv,.yaml,.yml,text/csv,application/x-yaml,text/yaml"
        onChange={onHandleUsersImportSelect}
        className={styles.usersHiddenInput}
      />
    </div>
  );
}
