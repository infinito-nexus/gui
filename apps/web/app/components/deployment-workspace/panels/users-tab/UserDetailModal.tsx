"use client";

import YAML from "yaml";
import styles from "../../../DeploymentWorkspace.module.css";
import type { UserRow } from "./users-tab-utils";

type Props = {
  row: UserRow;
  onClose: () => void;
  onChange: (patch: Partial<UserRow>) => void;
};

export default function UserDetailModal({ row, onClose, onChange }: Props) {
  return (
    <div className={styles.usersTabModalOverlay} onClick={onClose}>
      <div
        className={styles.usersTabModalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.usersTabModalHeader}>
          <h4 className={styles.usersTabModalTitle}>User: {row.username}</h4>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.smallButtonEnabled}`}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className={styles.usersTabModalBody}>
          <label className={styles.usersTabModalField}>
            <span>Password</span>
            <input
              type="password"
              className="form-control"
              value={row.password ?? ""}
              autoComplete="new-password"
              onChange={(e) => onChange({ password: e.target.value })}
            />
          </label>
          <div className={styles.usersTabModalRow}>
            <label className={styles.usersTabModalField}>
              <span>UID</span>
              <input
                type="number"
                className="form-control"
                value={row.uid ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ uid: v === "" ? undefined : Number(v) });
                }}
              />
            </label>
            <label className={styles.usersTabModalField}>
              <span>GID</span>
              <input
                type="number"
                className="form-control"
                value={row.gid ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ gid: v === "" ? undefined : Number(v) });
                }}
              />
            </label>
          </div>
          <label className={styles.usersTabModalField}>
            <span>Roles (comma-separated)</span>
            <input
              type="text"
              className="form-control"
              value={(row.roles ?? []).join(", ")}
              onChange={(e) =>
                onChange({
                  roles: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="admin, devops"
            />
          </label>
          <label className={styles.usersTabModalField}>
            <span>Authorized keys (one per line)</span>
            <textarea
              className="form-control"
              rows={4}
              value={(row.authorized_keys ?? []).join("\n")}
              onChange={(e) =>
                onChange({
                  authorized_keys: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className={styles.usersTabModalField}>
            <span>Description</span>
            <input
              type="text"
              className="form-control"
              value={row.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </label>
          <label className={styles.usersTabModalCheckbox}>
            <input
              type="checkbox"
              checked={Boolean(row.reserved)}
              onChange={(e) => onChange({ reserved: e.target.checked })}
            />
            <span>Reserved (system user)</span>
          </label>
          {row.tokens ? (
            <div className={styles.usersTabModalField}>
              <span>Tokens (read-only YAML)</span>
              <pre className={styles.usersTabModalTokens}>
                {YAML.stringify(row.tokens)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
