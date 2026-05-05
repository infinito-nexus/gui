import type { CSSProperties } from "react";

export function renderServerMotionMode(ctx: any) {
  const {
    styles,
    viewMode,
    paginatedServers,
    laneCount,
    laneSize,
    buildMotionLanes,
    MOTION_LOOP_SEGMENTS,
    getValidationState,
    getStatusIndicator,
    testResults,
    getVisualState,
    getTintStyle,
    statusDotClass,
    isCustomerMode,
    openDetailModal,
    onOpenDetailSearch,
    detailModal,
  } = ctx;

  const motionLanes = buildMotionLanes(paginatedServers, laneCount);
  const safeLaneSize = Math.max(
    viewMode === "row" ? 120 : 160,
    Math.floor(Number(laneSize) || 0)
  );
  const motionRootStyle = {
    "--motion-lane-count": Math.max(1, motionLanes.length),
    "--motion-lane-size": `${safeLaneSize}px`,
    "--motion-row-card-width": `${Math.max(420, Math.round(safeLaneSize * 2))}px`,
    "--motion-column-card-min-height": `${Math.max(
      260,
      Math.round(safeLaneSize * 1.6)
    )}px`,
  } as CSSProperties;

  if (paginatedServers.length === 0) {
    return (
      <div
        className={`${styles.motionRoot} ${
          viewMode === "row" ? styles.motionRootRow : styles.motionRootColumn
        }`}
        style={motionRootStyle}
      >
        <div className={`text-body-secondary ${styles.motionEmpty}`}>
          No devices match the filters.
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`${styles.motionRoot} ${
          viewMode === "row" ? styles.motionRootRow : styles.motionRootColumn
        }`}
        style={motionRootStyle}
      >
        <div
          className={`${styles.motionLanes} ${
            viewMode === "row" ? styles.motionLanesRow : styles.motionLanesColumn
          }`}
        >
          {motionLanes.map((laneServers: any[], laneIndex: number) => {
            const basePerItemSeconds = viewMode === "row" ? 6 : 7;
            const duration = Number(
              (Math.max(1, laneServers.length) * basePerItemSeconds + laneIndex).toFixed(2)
            );
            const laneStyle = {
              "--motion-scroll-duration": `${duration}s`,
            } as CSSProperties;
            return (
              <div
                key={`lane-${laneIndex}`}
                className={`${styles.motionLane} ${
                  viewMode === "row" ? styles.motionLaneRow : styles.motionLaneColumn
                }`}
              >
                <div className={styles.motionViewport}>
                  <div
                    className={`${styles.motionTrack} ${
                      viewMode === "row"
                        ? styles.motionTrackHorizontal
                        : styles.motionTrackVertical
                    }`}
                    style={laneStyle}
                  >
                    {MOTION_LOOP_SEGMENTS.map((segmentIndex: number) => (
                      <div
                        key={`lane-${laneIndex}-segment-${segmentIndex}`}
                        className={`${styles.motionTrackSegment} ${
                          viewMode === "row"
                            ? styles.motionTrackSegmentRow
                            : styles.motionTrackSegmentColumn
                        }`}
                      >
                        {laneServers.map((server: any, cardIndex: number) => {
                          const validation = getValidationState(server);
                          const indicator = getStatusIndicator(
                            validation,
                            testResults[server.alias]
                          );
                          const visual = getVisualState(validation, indicator);
                          const tinted = visual.cardClass !== styles.cardStateDanger;
                          const tintStyle = getTintStyle(server.color, tinted);
                          return (
                            <article
                              key={`${laneIndex}-${segmentIndex}-${cardIndex}-${server.alias}`}
                              data-server-card
                              className={`${styles.motionCard} ${
                                viewMode === "row"
                                  ? styles.motionCardRow
                                  : styles.motionCardColumn
                              } ${styles.cardDefault} ${visual.cardClass} ${
                                tintStyle ? styles.cardTinted : ""
                              }`}
                              style={tintStyle}
                            >
                              <div className={styles.motionCardHeader}>
                                <div className={styles.motionIdentity}>
                                  <span
                                    className={styles.aliasEmojiPreview}
                                    aria-hidden="true"
                                  >
                                    {server.logoEmoji || "💻"}
                                  </span>
                                  <span className={styles.motionAlias}>
                                    {server.alias || "device"}
                                  </span>
                                </div>
                                <span
                                  className={`${styles.statusDot} ${statusDotClass(
                                    indicator.tone
                                  )}`}
                                  aria-hidden="true"
                                />
                              </div>
                              <div className={styles.motionCardMeta}>
                                <span>
                                  {(server.user || "root").trim() || "root"}@
                                  {(server.host || "example.com").trim() ||
                                    "example.com"}
                                  :{(server.port || "22").trim() || "22"}
                                </span>
                                <span>
                                  {(server.primaryDomain || "localhost").trim() ||
                                    "localhost"}
                                </span>
                              </div>
                              <div className={`text-body-secondary ${styles.motionCardHint}`}>
                                {indicator.label}
                              </div>
                              <div className={styles.motionCardActions}>
                                {!isCustomerMode ? (
                                  <button
                                    type="button"
                                    onClick={() => openDetailModal(server.alias)}
                                    className={styles.actionButtonSecondary}
                                  >
                                    <i
                                      className="fa-solid fa-circle-info"
                                      aria-hidden="true"
                                    />
                                    <span>Detail</span>
                                  </button>
                                ) : null}
                                {onOpenDetailSearch ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenDetailSearch(server.alias)}
                                    className={styles.actionButtonSecondary}
                                  >
                                    <i
                                      className="fa-solid fa-scale-balanced"
                                      aria-hidden="true"
                                    />
                                    <span>Compare</span>
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!isCustomerMode ? detailModal : null}
    </>
  );
}
