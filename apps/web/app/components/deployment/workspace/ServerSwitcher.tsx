"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import styles from "./ServerSwitcher.module.css";
import { hexToRgba } from "../../deployment-credentials/device-visuals";
import type { ServerState } from "../../deployment-credentials/types";

type ServerSwitcherProps = {
  currentAlias: string;
  servers: ServerState[];
  onSelect: (alias: string) => void;
  onCreate: (aliasHint?: string) => void;
  onOpenServerTab: () => void;
};

export default function DeploymentWorkspaceServerSwitcher({
  currentAlias,
  servers,
  onSelect,
  onCreate,
  onOpenServerTab,
}: ServerSwitcherProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const currentDevice = useMemo(
    () => servers.find((server) => server.alias === currentAlias) ?? null,
    [currentAlias, servers]
  );

  const close = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  const handleSelect = (alias: string) => {
    onSelect(alias);
    close();
  };

  const handleCreate = () => {
    onCreate();
    onOpenServerTab();
    close();
  };

  const buildStyle = (server: ServerState, active: boolean): CSSProperties => {
    const border = hexToRgba(server.color, active ? 0.92 : 0.6);
    const background = hexToRgba(server.color, active ? 0.34 : 0.18);
    return {
      ...(border ? { borderColor: border } : {}),
      ...(background ? { backgroundColor: background } : {}),
    };
  };
  const triggerStyle = currentDevice ? buildStyle(currentDevice, true) : undefined;

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const details = detailsRef.current;
      const target = event.target as Node | null;
      if (!details || !details.open || !target) return;
      if (!details.contains(target)) close();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const details = detailsRef.current;
      if (!details?.open) return;
      close();
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <details ref={detailsRef} className={styles.switcher}>
      <summary className={styles.trigger} style={triggerStyle}>
        <span className={styles.aliasWithEmoji}>
          <span aria-hidden="true">{currentDevice?.logoEmoji || "💻"}</span>
          <span>{currentAlias || "none"}</span>
        </span>
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </summary>
      <div className={styles.menu}>
        {servers.length === 0 ? (
          <div className={`text-body-secondary ${styles.empty}`}>No devices yet.</div>
        ) : (
          servers.map((server) => (
            <button
              type="button"
              key={server.alias}
              onClick={() => handleSelect(server.alias)}
              className={`${styles.serverButton} ${
                currentAlias === server.alias ? styles.serverButtonActive : ""
              }`}
              style={buildStyle(server, currentAlias === server.alias)}
            >
              <span className={styles.aliasWithEmoji}>
                <span aria-hidden="true">{server.logoEmoji || "💻"}</span>
                <span>{server.alias}</span>
              </span>
            </button>
          ))
        )}
        <button type="button" onClick={handleCreate} className={styles.newButton}>
          <i className="fa-solid fa-plus" aria-hidden="true" />
          <span>New device</span>
        </button>
      </div>
    </details>
  );
}
