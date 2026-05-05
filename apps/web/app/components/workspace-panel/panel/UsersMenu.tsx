"use client";

import styles from "./Cards.module.css";

export default function WorkspacePanelUsersMenu(props: any) {
  const {
    workspaceId,
    usersMenuOpen,
    setUsersMenuOpen,
    setSecretsMenuOpen,
    setWorkspaceMenuOpen,
    usersImportMenuOpen,
    setUsersImportMenuOpen,
    usersExportMenuOpen,
    setUsersExportMenuOpen,
    onUsersAction,
  } = props;

  return (
    <div className={styles.menuWrap}>
      <button
        type="button"
        onClick={() => {
          setUsersMenuOpen((prev: boolean) => !prev);
          setSecretsMenuOpen(false);
          setWorkspaceMenuOpen(false);
          setUsersImportMenuOpen(false);
          setUsersExportMenuOpen(false);
        }}
        disabled={!workspaceId}
        className={styles.menuTrigger}
      >
        <i className="fa-solid fa-users" aria-hidden="true" />
        <span>Users</span>
        <i
          className={`fa-solid ${usersMenuOpen ? "fa-chevron-up" : "fa-chevron-down"}`}
          aria-hidden="true"
        />
      </button>
      {usersMenuOpen ? (
        <div className={styles.menuPanel}>
          <ul className={styles.menuList}>
            <li>
              <button
                type="button"
                onClick={() => {
                  setUsersMenuOpen(false);
                  setUsersImportMenuOpen(false);
                  setUsersExportMenuOpen(false);
                  onUsersAction?.("overview");
                }}
                disabled={!workspaceId}
                className={styles.menuItem}
              >
                <span className={styles.menuItemLabel}>
                  <i className="fa-solid fa-table-list" aria-hidden="true" />
                  Overview
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setUsersMenuOpen(false);
                  setUsersImportMenuOpen(false);
                  setUsersExportMenuOpen(false);
                  onUsersAction?.("add");
                }}
                disabled={!workspaceId}
                className={styles.menuItem}
              >
                <span className={styles.menuItemLabel}>
                  <i className="fa-solid fa-user-plus" aria-hidden="true" />
                  Add
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setUsersImportMenuOpen((prev: boolean) => !prev);
                  setUsersExportMenuOpen(false);
                }}
                disabled={!workspaceId}
                className={styles.menuItem}
              >
                <span className={styles.menuItemLabel}>
                  <i className="fa-solid fa-file-arrow-up" aria-hidden="true" />
                  Import
                </span>
                <i
                  className={`fa-solid ${
                    usersImportMenuOpen ? "fa-chevron-up" : "fa-chevron-down"
                  }`}
                  aria-hidden="true"
                />
              </button>
              {usersImportMenuOpen ? (
                <div className={styles.submenu}>
                  <button
                    type="button"
                    onClick={() => {
                      setUsersMenuOpen(false);
                      setUsersImportMenuOpen(false);
                      setUsersExportMenuOpen(false);
                      onUsersAction?.("import-csv");
                    }}
                    className={styles.submenuItem}
                  >
                    <i className="fa-solid fa-file-csv" aria-hidden="true" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsersMenuOpen(false);
                      setUsersImportMenuOpen(false);
                      setUsersExportMenuOpen(false);
                      onUsersAction?.("import-yaml");
                    }}
                    className={styles.submenuItem}
                  >
                    <i className="fa-solid fa-file-code" aria-hidden="true" />
                    YAML
                  </button>
                </div>
              ) : null}
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setUsersExportMenuOpen((prev: boolean) => !prev);
                  setUsersImportMenuOpen(false);
                }}
                disabled={!workspaceId}
                className={styles.menuItem}
              >
                <span className={styles.menuItemLabel}>
                  <i className="fa-solid fa-file-export" aria-hidden="true" />
                  Export
                </span>
                <i
                  className={`fa-solid ${
                    usersExportMenuOpen ? "fa-chevron-up" : "fa-chevron-down"
                  }`}
                  aria-hidden="true"
                />
              </button>
              {usersExportMenuOpen ? (
                <div className={styles.submenu}>
                  <button
                    type="button"
                    onClick={() => {
                      setUsersMenuOpen(false);
                      setUsersImportMenuOpen(false);
                      setUsersExportMenuOpen(false);
                      onUsersAction?.("export-csv");
                    }}
                    className={styles.submenuItem}
                  >
                    <i className="fa-solid fa-file-csv" aria-hidden="true" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsersMenuOpen(false);
                      setUsersImportMenuOpen(false);
                      setUsersExportMenuOpen(false);
                      onUsersAction?.("export-yaml");
                    }}
                    className={styles.submenuItem}
                  >
                    <i className="fa-solid fa-file-code" aria-hidden="true" />
                    YAML
                  </button>
                </div>
              ) : null}
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
