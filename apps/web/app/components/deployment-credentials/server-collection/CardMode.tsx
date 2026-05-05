import type { CSSProperties } from "react";
import CountryFlagSelectPlugin from "../CountryFlagSelectPlugin";

export function renderServerCardMode(ctx: any) {
  const {
    styles,
    isCustomerMode,
    gridStyle,
    paginatedServers,
    viewConfig,
    aliasDrafts,
    getValidationState,
    getStatusIndicator,
    getVisualState,
    getTintStyle,
    normalizeDeviceColor,
    onPatchServer,
    openEmojiAlias,
    setOpenEmojiAlias,
    Picker,
    data,
    onAliasTyping,
    commitAlias,
    emitCredentialBlur,
    patchPort,
    onPortFieldBlur,
    openPrimaryDomainMenuFor,
    commitPrimaryDomain,
    renderActionCell,
    onOpenDetailSearch,
    actionMenuOverlay,
    bulkMenuOverlay,
    statusPopoverOverlay,
    primaryDomainMenuOverlay,
    detailModal,
  } = ctx;

  if (isCustomerMode) {
    return (
      <div className={styles.cardGrid} style={gridStyle}>
        {paginatedServers.map((server: any) => {
          const dense = viewConfig.dense;
          const aliasValue = aliasDrafts[server.alias] ?? server.alias;
          const validation = getValidationState(server);
          const tintStyle = getTintStyle(server.color, true);
          const cardStyle = {
            "--server-card-padding": dense ? "12px" : "16px",
            "--server-card-gap": dense ? "10px" : "12px",
            "--server-fields-gap": dense ? "8px" : "10px",
            "--server-input-padding": dense ? "6px 8px" : "8px 10px",
            "--server-input-font": dense ? "12px" : "13px",
            ...(tintStyle ?? {}),
          } as CSSProperties;
          return (
            <div
              key={server.alias}
              data-server-card
              className={`${styles.serverCard} ${styles.cardDefault} ${
                tintStyle ? styles.cardTinted : ""
              }`}
              style={cardStyle}
            >
              <div className={styles.fieldGrid}>
                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>Identity</label>
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
                      className={`${styles.fieldInput} ${styles.identityAliasInput} ${
                        validation.aliasError ? styles.inputError : ""
                      }`}
                    />
                  </div>
                  {validation.aliasError ? (
                    <p className="text-danger">{validation.aliasError}</p>
                  ) : null}
                </div>
                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                    Server type
                  </label>
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
                </div>
                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                    Storage (GB)
                  </label>
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
                    className={styles.fieldInput}
                  />
                </div>
                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                    Location
                  </label>
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
                </div>
              </div>
              {onOpenDetailSearch ? (
                <div className={styles.cardFooter}>
                  <button
                    type="button"
                    onClick={() => onOpenDetailSearch(server.alias)}
                    className={`${styles.actionButtonSecondary} ${styles.customerCompareButton}`}
                  >
                    <i className="fa-solid fa-scale-balanced" aria-hidden="true" />
                    <span>Compare</span>
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className={styles.cardGrid} style={gridStyle}>
        {paginatedServers.map((server: any) => {
          const dense = viewConfig.dense;
          const validation = getValidationState(server);
          const indicator = getStatusIndicator(validation, ctx.testResults[server.alias]);
          const visual = getVisualState(validation, indicator);
          const tintStyle = getTintStyle(
            server.color,
            visual.cardClass !== styles.cardStateDanger
          );

          const cardStyle = {
            "--server-card-padding": dense ? "12px" : "16px",
            "--server-card-gap": dense ? "10px" : "12px",
            "--server-fields-gap": dense ? "8px" : "10px",
            "--server-input-padding": dense ? "6px 8px" : "8px 10px",
            "--server-input-font": dense ? "12px" : "13px",
            ...(tintStyle ?? {}),
          } as CSSProperties;

          return (
            <div
              key={server.alias}
              data-server-card
              className={`${styles.serverCard} ${styles.cardDefault} ${visual.cardClass} ${
                tintStyle ? styles.cardTinted : ""
              }`}
              style={cardStyle}
            >
              <div className={styles.fieldGrid}>
                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>Identity</label>
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
                      value={aliasDrafts[server.alias] ?? server.alias}
                      onChange={(event) => onAliasTyping(server, event.target.value)}
                      onBlur={() => commitAlias(server)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitAlias(server);
                        }
                      }}
                      placeholder="device"
                      className={`${styles.fieldInput} ${styles.identityAliasInput} ${
                        validation.aliasError ? styles.inputError : ""
                      }`}
                    />
                  </div>
                  {validation.aliasError ? (
                    <p className="text-danger">{validation.aliasError}</p>
                  ) : null}
                </div>

                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>Host</label>
                  <input
                    value={server.host}
                    onChange={(event) => onPatchServer(server.alias, { host: event.target.value })}
                    onBlur={(event) =>
                      emitCredentialBlur(
                        { ...server, host: event.currentTarget.value },
                        "host"
                      )
                    }
                    placeholder="example.com"
                    className={`${styles.fieldInput} ${
                      validation.hostMissing ? styles.inputError : ""
                    }`}
                  />
                  {validation.hostMissing ? <p className="text-danger">Host is required.</p> : null}
                </div>

                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>Port</label>
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
                    className={`${styles.fieldInput} ${
                      validation.portError ? styles.inputError : ""
                    }`}
                  />
                  {validation.portError ? <p className="text-danger">{validation.portError}</p> : null}
                </div>

                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>User</label>
                  <input
                    value={server.user}
                    onChange={(event) => onPatchServer(server.alias, { user: event.target.value })}
                    onBlur={(event) =>
                      emitCredentialBlur(
                        { ...server, user: event.currentTarget.value },
                        "user"
                      )
                    }
                    placeholder="root"
                    className={`${styles.fieldInput} ${
                      validation.userMissing ? styles.inputError : ""
                    }`}
                  />
                  {validation.userMissing ? <p className="text-danger">User is required.</p> : null}
                </div>

                <div className={styles.fieldWrap}>
                  <label className={`text-body-tertiary ${styles.fieldLabel}`}>
                    Primary domain
                  </label>
                  <div className={styles.primaryDomainInputRow}>
                    <input
                      value={server.primaryDomain || ""}
                      onChange={(event) =>
                        onPatchServer(server.alias, { primaryDomain: event.target.value })
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
                      className={`${styles.fieldInput} ${
                        styles.primaryDomainDropdownTrigger
                      } ${validation.primaryDomainError ? styles.inputError : ""}`}
                    />
                  </div>
                  {validation.primaryDomainError ? (
                    <p className="text-danger">{validation.primaryDomainError}</p>
                  ) : null}
                </div>
              </div>

              <div className={styles.statusCard}>
                <div className={styles.statusHeadline}>
                  <span
                    className={`${styles.statusDot} ${ctx.statusDotClass(indicator.tone)}`}
                    aria-hidden="true"
                  />
                  <span>{indicator.label}</span>
                </div>
                <div className={styles.statusSummary}>{indicator.tooltip}</div>
              </div>

              <div className={styles.cardFooter}>{renderActionCell(server)}</div>
            </div>
          );
        })}
      </div>
      {actionMenuOverlay}
      {bulkMenuOverlay}
      {statusPopoverOverlay}
      {primaryDomainMenuOverlay}
      {detailModal}
    </>
  );
}
