import CountryFlagSelectPlugin from "../CountryFlagSelectPlugin";

export function renderServerListMode(ctx: any) {
  const {
    styles,
    isCustomerMode,
    paginatedServers,
    getValidationState,
    aliasDrafts,
    normalizeDeviceColor,
    openEmojiAlias,
    setOpenEmojiAlias,
    Picker,
    data,
    onPatchServer,
    onAliasTyping,
    commitAlias,
    onOpenDetailSearch,
    bulkMenu,
    setBulkMenu,
    openBulkMenu,
    selectedCount,
    allVisibleSelected,
    toggleSelectAllVisible,
    getStatusIndicator,
    testResults,
    getVisualState,
    getTintStyle,
    selectedAliases,
    toggleAliasSelection,
    emitCredentialBlur,
    patchPort,
    onPortFieldBlur,
    openPrimaryDomainMenuFor,
    commitPrimaryDomain,
    renderStatusCell,
    renderActionCell,
    actionMenuOverlay,
    bulkMenuOverlay,
    statusPopoverOverlay,
    primaryDomainMenuOverlay,
    detailModal,
  } = ctx;

  if (isCustomerMode) {
    return (
      <div className={styles.listRoot} data-server-list-root>
        <div className={styles.listTableWrap} data-server-list-wrap>
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th>Alias</th>
                <th>Server type</th>
                <th>Storage (GB)</th>
                <th>Location</th>
                <th className={styles.colCompare}>Compare</th>
              </tr>
            </thead>
            <tbody>
              {paginatedServers.map((server: any) => {
                const validation = getValidationState(server);
                const aliasValue = aliasDrafts[server.alias] ?? server.alias;
                return (
                  <tr key={server.alias} className={styles.listTableRow}>
                    <td>
                      <div className={styles.fieldColumn}>
                        <div className={styles.aliasInputRow}>
                          <input
                            type="color"
                            value={normalizeDeviceColor(server.color) || "#89CFF0"}
                            onChange={(event) =>
                              onPatchServer(server.alias, { color: event.target.value })
                            }
                            className={styles.colorPickerInput}
                            aria-label="Device color"
                          />
                          <div className={styles.emojiPickerShell}>
                            <button
                              type="button"
                              className={`${styles.emojiPickerTrigger} ${
                                openEmojiAlias === server.alias
                                  ? styles.emojiPickerTriggerOpen
                                  : ""
                              }`}
                              onClick={() =>
                                setOpenEmojiAlias((prev: string | null) =>
                                  prev === server.alias ? null : server.alias
                                )
                              }
                              title="Choose device emoji"
                              aria-label="Choose device emoji"
                            >
                              <span className={styles.aliasEmojiPreview} aria-hidden="true">
                                {server.logoEmoji || "💻"}
                              </span>
                            </button>
                            {openEmojiAlias === server.alias ? (
                              <div className={styles.emojiPickerMenu}>
                                <Picker
                                  data={data}
                                  theme="dark"
                                  previewPosition="none"
                                  navPosition="bottom"
                                  searchPosition="sticky"
                                  perLine={8}
                                  maxFrequentRows={2}
                                  onEmojiSelect={(emoji: any) => {
                                    const nextEmoji = String(emoji?.native || "").trim();
                                    if (!nextEmoji) return;
                                    onPatchServer(server.alias, { logoEmoji: nextEmoji });
                                    setOpenEmojiAlias(null);
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                          <input
                            value={aliasValue}
                            onChange={(event) => onAliasTyping(server, event.target.value)}
                            onBlur={() => commitAlias(server)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitAlias(server);
                              }
                            }}
                            placeholder="device"
                            className={`${styles.inputSmall} ${
                              validation.aliasError ? styles.inputError : ""
                            }`}
                          />
                        </div>
                        {validation.aliasError ? (
                          <span className={`text-danger ${styles.aliasErrorText}`}>
                            {validation.aliasError}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <select
                        value={server.requirementServerType || "vps"}
                        onChange={(event) =>
                          onPatchServer(server.alias, {
                            requirementServerType: event.target.value,
                          })
                        }
                        className={styles.selectControl}
                      >
                        <option value="vps">VPS</option>
                        <option value="dedicated">Dedicated</option>
                        <option value="managed">Managed</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={server.requirementStorageGb || "200"}
                        onChange={(event) =>
                          onPatchServer(server.alias, {
                            requirementStorageGb: event.target.value,
                          })
                        }
                        min={20}
                        step={1}
                        inputMode="numeric"
                        placeholder="200"
                        className={styles.inputSmall}
                      />
                    </td>
                    <td>
                      <CountryFlagSelectPlugin
                        value={server.requirementLocation || "Germany"}
                        onChange={(nextLocation) =>
                          onPatchServer(server.alias, {
                            requirementLocation: nextLocation,
                          })
                        }
                        className={styles.selectControl}
                        aria-label={`Location requirement for ${server.alias}`}
                      />
                    </td>
                    <td className={styles.listCompareCell}>
                      {onOpenDetailSearch ? (
                        <button
                          type="button"
                          onClick={() => onOpenDetailSearch(server.alias)}
                          className={styles.listCompareButton}
                        >
                          <i className="fa-solid fa-scale-balanced" aria-hidden="true" />
                          <span>Compare</span>
                        </button>
                      ) : (
                        <span className="text-body-secondary">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.listRoot} data-server-list-root>
        <div className={styles.listToolbar} data-server-list-toolbar>
          <button
            type="button"
            className={styles.bulkActionTrigger}
            onClick={(event) => {
              if (bulkMenu) {
                setBulkMenu(null);
              } else {
                openBulkMenu(event);
              }
            }}
          >
            Selected ({selectedCount})
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          </button>
          <span className={`text-body-secondary ${styles.listToolbarMeta}`}>
            {selectedCount} selected
          </span>
        </div>

        <div className={styles.listTableWrap} data-server-list-wrap>
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th className={styles.colSelect}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                    aria-label="Select all visible devices"
                  />
                </th>
                <th>Identity</th>
                <th>Host</th>
                <th>Port</th>
                <th>User</th>
                <th>Primary domain</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedServers.map((server: any) => {
                const validation = getValidationState(server);
                const indicator = getStatusIndicator(validation, testResults[server.alias]);
                const visual = getVisualState(validation, indicator);
                const tintStyle = getTintStyle(
                  server.color,
                  visual.rowClass !== styles.rowStateDanger
                );
                const aliasValue = aliasDrafts[server.alias] ?? server.alias;

                return (
                  <tr
                    key={server.alias}
                    data-server-alias={server.alias}
                    className={`${styles.listTableRow} ${visual.rowClass} ${
                      tintStyle ? styles.rowTinted : ""
                    }`}
                    style={tintStyle}
                  >
                    <td className={styles.colSelect}>
                      <input
                        type="checkbox"
                        checked={selectedAliases.has(server.alias)}
                        onChange={(event) =>
                          toggleAliasSelection(server.alias, event.target.checked)
                        }
                        aria-label={`Select ${server.alias}`}
                      />
                    </td>
                    <td>
                      <div className={styles.fieldColumn}>
                        <div className={styles.aliasInputRow}>
                          <span className={styles.aliasEmojiPreview} aria-hidden="true">
                            {server.logoEmoji || "💻"}
                          </span>
                          <input
                            value={aliasValue}
                            onChange={(event) => onAliasTyping(server, event.target.value)}
                            onBlur={() => commitAlias(server)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitAlias(server);
                              }
                            }}
                            placeholder="device"
                            className={`${styles.inputSmall} ${
                              validation.aliasError ? styles.inputError : ""
                            }`}
                          />
                        </div>
                        {validation.aliasError ? (
                          <span className={`text-danger ${styles.aliasErrorText}`}>
                            {validation.aliasError}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <input
                        value={server.host}
                        onChange={(event) =>
                          onPatchServer(server.alias, { host: event.target.value })
                        }
                        onBlur={(event) =>
                          emitCredentialBlur(
                            { ...server, host: event.currentTarget.value },
                            "host"
                          )
                        }
                        placeholder="example.com"
                        className={`${styles.inputSmall} ${
                          validation.hostMissing ? styles.inputError : ""
                        }`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={server.port}
                        onChange={(event) => patchPort(server.alias, event.target.value)}
                        onBlur={() => onPortFieldBlur(server)}
                        placeholder="22"
                        min={1}
                        max={65535}
                        step={1}
                        inputMode="numeric"
                        className={`${styles.inputSmall} ${
                          validation.portError ? styles.inputError : ""
                        }`}
                      />
                    </td>
                    <td>
                      <input
                        value={server.user}
                        onChange={(event) =>
                          onPatchServer(server.alias, { user: event.target.value })
                        }
                        onBlur={(event) =>
                          emitCredentialBlur(
                            { ...server, user: event.currentTarget.value },
                            "user"
                          )
                        }
                        placeholder="root"
                        className={`${styles.inputSmall} ${
                          validation.userMissing ? styles.inputError : ""
                        }`}
                      />
                    </td>
                    <td>
                      <div className={styles.fieldColumn}>
                        <div className={styles.primaryDomainInputRow}>
                          <input
                            value={server.primaryDomain || ""}
                            onChange={(event) =>
                              onPatchServer(server.alias, {
                                primaryDomain: event.target.value,
                              })
                            }
                            onFocus={(event) =>
                              openPrimaryDomainMenuFor(server.alias, event.currentTarget)
                            }
                            onClick={(event) =>
                              openPrimaryDomainMenuFor(server.alias, event.currentTarget)
                            }
                            onBlur={(event) =>
                              commitPrimaryDomain(server, event.currentTarget.value)
                            }
                            placeholder="localhost"
                            className={`${styles.inputSmall} ${
                              styles.primaryDomainDropdownTrigger
                            } ${
                              validation.primaryDomainError ? styles.inputError : ""
                            }`}
                          />
                        </div>
                        {validation.primaryDomainError ? (
                          <span className={`text-danger ${styles.aliasErrorText}`}>
                            {validation.primaryDomainError}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{renderStatusCell(server, indicator)}</td>
                    <td>{renderActionCell(server)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {actionMenuOverlay}
      {bulkMenuOverlay}
      {statusPopoverOverlay}
      {primaryDomainMenuOverlay}
      {detailModal}
    </>
  );
}
