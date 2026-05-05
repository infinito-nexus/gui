"use client";

import { createPortal } from "react-dom";
import type { Dispatch, SetStateAction } from "react";
import styles from "../styles.module.css";
import type {
  OverlayMenu,
  PrimaryDomainMenu,
  StatusPopover,
} from "./View.types";
import type { ServerState } from "../types";

type RenderServerCollectionOverlaysProps = {
  actionMenu: OverlayMenu | null;
  setActionMenu: Dispatch<SetStateAction<OverlayMenu | null>>;
  bulkMenu: { top: number; left: number } | null;
  selectedCount: number;
  runBulkAction: (mode: "delete" | "purge") => void;
  statusPopover: StatusPopover | null;
  primaryDomainMenu: PrimaryDomainMenu | null;
  setPrimaryDomainMenu: Dispatch<SetStateAction<PrimaryDomainMenu | null>>;
  activePrimaryDomainServer: ServerState | null;
  activePrimaryDomainOptions: string[];
  selectPrimaryDomainFromMenu: (server: ServerState, domain: string) => void;
  onRequestDelete: (aliases: string[]) => void;
  onRequestPurge: (aliases: string[]) => void;
  onRequestAddPrimaryDomain?: (request?: {
    alias?: string;
    value?: string;
    kind?: "local" | "fqdn" | "subdomain";
    parentFqdn?: string;
    subLabel?: string;
    reason?: "missing" | "unknown";
  }) => void;
};

export function renderServerCollectionOverlays({
  actionMenu,
  setActionMenu,
  bulkMenu,
  selectedCount,
  runBulkAction,
  statusPopover,
  primaryDomainMenu,
  setPrimaryDomainMenu,
  activePrimaryDomainServer,
  activePrimaryDomainOptions,
  selectPrimaryDomainFromMenu,
  onRequestDelete,
  onRequestPurge,
  onRequestAddPrimaryDomain,
}: RenderServerCollectionOverlaysProps) {
  const actionMenuOverlay =
    actionMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.actionOverlayMenu}
            style={{ top: actionMenu.top, left: actionMenu.left }}
            role="menu"
          >
            <button
              type="button"
              className={styles.actionDropdownItem}
              onClick={() => {
                onRequestDelete([actionMenu.alias]);
                setActionMenu(null);
              }}
            >
              <i className="fa-solid fa-trash" aria-hidden="true" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              className={`${styles.actionDropdownItem} ${styles.actionDropdownDanger}`}
              onClick={() => {
                onRequestPurge([actionMenu.alias]);
                setActionMenu(null);
              }}
            >
              <i className="fa-solid fa-broom" aria-hidden="true" />
              <span>Purge</span>
            </button>
          </div>,
          document.body
        )
      : null;

  const bulkMenuOverlay =
    bulkMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.bulkOverlayMenu}
            style={{ top: bulkMenu.top, left: bulkMenu.left }}
            role="menu"
          >
            <button
              type="button"
              className={styles.actionDropdownItem}
              disabled={selectedCount === 0}
              onClick={() => runBulkAction("delete")}
            >
              <i className="fa-solid fa-trash" aria-hidden="true" />
              <span>Delete selected</span>
            </button>
            <button
              type="button"
              className={`${styles.actionDropdownItem} ${styles.actionDropdownDanger}`}
              disabled={selectedCount === 0}
              onClick={() => runBulkAction("purge")}
            >
              <i className="fa-solid fa-broom" aria-hidden="true" />
              <span>Purge selected</span>
            </button>
          </div>,
          document.body
        )
      : null;

  const statusPopoverOverlay =
    statusPopover && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.statusPopoverOverlay}
            style={{ top: statusPopover.top, left: statusPopover.left }}
            role="tooltip"
          >
            <strong>{statusPopover.label}</strong>
            <span>{statusPopover.tooltip}</span>
          </div>,
          document.body
        )
      : null;

  const primaryDomainMenuOverlay =
    primaryDomainMenu && activePrimaryDomainServer && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.primaryDomainDropdown}
            style={{
              top: primaryDomainMenu.top,
              left: primaryDomainMenu.left,
              width: primaryDomainMenu.width,
            }}
            role="listbox"
          >
            <div className={styles.primaryDomainDropdownList}>
              {activePrimaryDomainOptions.length === 0 ? (
                <span className={styles.primaryDomainDropdownEmpty}>No matching domains.</span>
              ) : (
                activePrimaryDomainOptions.map((domain) => (
                  <button
                    key={domain}
                    type="button"
                    className={styles.primaryDomainDropdownItem}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      selectPrimaryDomainFromMenu(activePrimaryDomainServer, domain)
                    }
                  >
                    {domain}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className={styles.primaryDomainDropdownAdd}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setPrimaryDomainMenu(null);
                const typed = String(activePrimaryDomainServer.primaryDomain || "")
                  .trim()
                  .toLowerCase();
                onRequestAddPrimaryDomain?.({
                  alias: activePrimaryDomainServer.alias,
                  value: typed,
                  kind: typed && !typed.includes(".") ? "local" : "fqdn",
                  reason: typed ? "unknown" : "missing",
                });
              }}
            >
              <i className="fa-solid fa-plus" aria-hidden="true" />
              <span>Add new</span>
            </button>
          </div>,
          document.body
        )
      : null;

  return {
    actionMenuOverlay,
    bulkMenuOverlay,
    statusPopoverOverlay,
    primaryDomainMenuOverlay,
  };
}
