"use client";

import type { Dispatch, SetStateAction } from "react";
import styles from "../styles.module.css";
import type { OverlayMenu, StatusIndicator } from "./View.types";
import type { ServerState } from "../types";

type BuildServerCollectionCellsProps = {
  actionMenu: OverlayMenu | null;
  setActionMenu: Dispatch<SetStateAction<OverlayMenu | null>>;
  openDetailModal: (alias: string) => void;
  openActionMenuFor: (
    alias: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) => void;
  openStatusPopoverFor: (
    alias: string,
    indicator: StatusIndicator,
    event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>
  ) => void;
  closeStatusPopoverFor: (alias: string) => void;
  statusDotClass: (tone: StatusIndicator["tone"]) => string;
};

export function buildServerCollectionCells({
  actionMenu,
  setActionMenu,
  openDetailModal,
  openActionMenuFor,
  openStatusPopoverFor,
  closeStatusPopoverFor,
  statusDotClass,
}: BuildServerCollectionCellsProps) {
  const renderStatusCell = (server: ServerState, indicator: StatusIndicator) => (
    <div className={styles.listStatusCell}>
      <button
        type="button"
        className={styles.statusDotButton}
        onMouseEnter={(event) => openStatusPopoverFor(server.alias, indicator, event)}
        onMouseLeave={() => closeStatusPopoverFor(server.alias)}
        onFocus={(event) => openStatusPopoverFor(server.alias, indicator, event)}
        onBlur={() => closeStatusPopoverFor(server.alias)}
        aria-label={`Status: ${indicator.label}`}
      >
        <span
          className={`${styles.statusDot} ${statusDotClass(indicator.tone)}`}
          aria-hidden="true"
        />
      </button>
    </div>
  );

  const renderActionCell = (server: ServerState) => (
    <div className={styles.rowActions}>
      <button
        type="button"
        onClick={() => openDetailModal(server.alias)}
        className={styles.detailInfoButton}
      >
        <i className="fa-solid fa-circle-info" aria-hidden="true" />
        <span>Detail</span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          if (actionMenu?.alias === server.alias) {
            setActionMenu(null);
          } else {
            openActionMenuFor(server.alias, event);
          }
        }}
        className={styles.actionMenuTrigger}
      >
        <span>Action</span>
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
    </div>
  );

  return {
    renderStatusCell,
    renderActionCell,
  };
}
