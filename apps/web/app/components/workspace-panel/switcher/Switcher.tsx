"use client";

import { useRef } from "react";
import styles from "./Switcher.module.css";
import type { WorkspaceListEntry } from "../types";

type WorkspaceSwitcherProps = {
  currentId: string | null;
  workspaces: WorkspaceListEntry[];
  onSelect: (id: string) => void;
  onCreate: () => void;
};

export default function WorkspaceSwitcher({
  currentId,
  workspaces,
  onSelect,
  onCreate,
}: WorkspaceSwitcherProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };
  const handleSelect = (id: string) => {
    onSelect(id);
    close();
  };
  const handleCreate = () => {
    onCreate();
    close();
  };

  return (
    <details ref={detailsRef} className={styles.switcher}>
      <summary className={styles.trigger}>
        <i className="fa-solid fa-folder-open" aria-hidden="true" />
        <span>{currentId || "Select workspace"}</span>
      </summary>
      <div className={styles.menu}>
        {workspaces.length === 0 ? (
          <div className={`text-body-secondary ${styles.empty}`}>No workspaces yet.</div>
        ) : (
          workspaces.map((workspace) => (
            <button
              key={workspace.id}
              onClick={() => handleSelect(workspace.id)}
              className={`${styles.workspaceButton} ${
                currentId === workspace.id ? styles.workspaceButtonActive : ""
              }`}
            >
              {workspace.id}
            </button>
          ))
        )}
        <button onClick={handleCreate} className={styles.newButton}>
          + New
        </button>
      </div>
    </details>
  );
}
