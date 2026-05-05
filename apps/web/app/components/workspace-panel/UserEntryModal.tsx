import type { Dispatch, SetStateAction } from "react";
import styles from "../workspace/Panel.module.css";
import { asTrimmed } from "./users-utils";
import type { WorkspaceUserForm } from "./users-utils";

type Props = {
  open: boolean;
  usersSaving: boolean;
  usersEditorMode: "create" | "edit";
  editingUsername: string | null;
  userForm: WorkspaceUserForm;
  setUserForm: Dispatch<SetStateAction<WorkspaceUserForm>>;
  onClose: () => void;
  onApply: () => void;
};

export default function UserEntryModal({
  open,
  usersSaving,
  usersEditorMode,
  editingUsername,
  userForm,
  setUserForm,
  onClose,
  onApply,
}: Props) {
  if (!open) return null;

  return (
    <div className={styles.usersOverlay} onClick={onClose}>
      <div className={styles.usersModal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.usersHeader}>
          <h3 className={styles.usersTitle}>
            {usersEditorMode === "edit" && editingUsername
              ? `Edit user: ${editingUsername}`
              : "Add user"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={usersSaving}
            className={styles.usersSecondaryButton}
          >
            Close
          </button>
        </div>

        <div className={styles.usersFormGrid}>
          <label className={styles.usersField}>
            <span>Username* (a-z0-9)</span>
            <input
              value={userForm.username}
              onChange={(event) =>
                setUserForm((prev) => ({
                  ...prev,
                  username: asTrimmed(event.target.value).toLowerCase(),
                }))
              }
              className={styles.usersInput}
              placeholder="admin"
            />
          </label>
          <label className={styles.usersField}>
            <span>Firstname*</span>
            <input
              value={userForm.firstname}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, firstname: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="Admin"
            />
          </label>
          <label className={styles.usersField}>
            <span>Lastname*</span>
            <input
              value={userForm.lastname}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, lastname: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="User"
            />
          </label>
          <label className={styles.usersField}>
            <span>Email (optional)</span>
            <input
              value={userForm.email}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, email: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="admin@example.org"
            />
          </label>
          <label className={styles.usersField}>
            <span>Password (optional)</span>
            <input
              value={userForm.password}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, password: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="{{ 42 | strong_password }}"
            />
          </label>
          <label className={styles.usersField}>
            <span>Reserved (optional)</span>
            <select
              value={userForm.reserved}
              onChange={(event) =>
                setUserForm((prev) => ({
                  ...prev,
                  reserved: event.target.value as "" | "true" | "false",
                }))
              }
              className={styles.usersInput}
            >
              <option value="">not set</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <label className={styles.usersField}>
            <span>UID (optional)</span>
            <input
              value={userForm.uid}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, uid: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="1028"
            />
          </label>
          <label className={styles.usersField}>
            <span>GID (optional)</span>
            <input
              value={userForm.gid}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, gid: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="1028"
            />
          </label>
          <label className={styles.usersField}>
            <span>Roles (optional)</span>
            <input
              value={userForm.roles}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, roles: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="role-a,role-b"
            />
          </label>
          <label className={`${styles.usersField} ${styles.usersFieldWide}`}>
            <span>Authorized keys (optional, one per line)</span>
            <textarea
              rows={2}
              value={userForm.authorized_keys}
              onChange={(event) =>
                setUserForm((prev) => ({
                  ...prev,
                  authorized_keys: event.target.value,
                }))
              }
              className={styles.usersTextArea}
            />
          </label>
          <label className={`${styles.usersField} ${styles.usersFieldWide}`}>
            <span>Tokens (optional YAML/JSON object)</span>
            <textarea
              rows={2}
              value={userForm.tokens}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, tokens: event.target.value }))
              }
              className={styles.usersTextArea}
            />
          </label>
          <label className={`${styles.usersField} ${styles.usersFieldWide}`}>
            <span>Description (optional)</span>
            <input
              value={userForm.description}
              onChange={(event) =>
                setUserForm((prev) => ({ ...prev, description: event.target.value }))
              }
              className={styles.usersInput}
              placeholder="Generic reserved username"
            />
          </label>
        </div>

        <div className={styles.usersFooter}>
          <button
            type="button"
            onClick={onClose}
            disabled={usersSaving}
            className={styles.usersSecondaryButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={usersSaving}
            className={styles.usersPrimaryButton}
          >
            {usersEditorMode === "edit" ? "Apply changes" : "Add user"}
          </button>
        </div>
      </div>
    </div>
  );
}
