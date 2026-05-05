"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import BundleAppList from "./AppList";
import BundleDetailsModal from "./DetailsModal";
import EnableDropdown from "../EnableDropdown";
import styles from "../styles";
import type { Bundle, Role } from "./types";
import type { BundleEntry, BundleState } from "./types";
import { buildBundleEntries } from "./entries";
import { bundleLogo } from "./visuals";
import {
  LOOP_SEGMENT_INDICES,
  buildLaneRandomDurations,
  buildLanes,
  type ColumnVariant,
} from "../lane-utils";
import useDeselectionFlash from "../useDeselectionFlash";
import useLoopingLaneScroller from "../useLoopingLaneScroller";

type BundleColumnViewProps = {
  bundles: Bundle[];
  iconSize: number;
  variant: ColumnVariant;
  laneCount: number;
  laneSize: number;
  animationRunning: boolean;
  activeAlias: string;
  bundleStates: Record<string, BundleState>;
  roleById: Record<string, Role>;
  roleServerCountByRole?: Record<string, number>;
  onOpenRoleDetails?: (role: Role) => void;
  onEnableBundle: (bundle: Bundle) => void;
  onDisableBundle: (bundle: Bundle) => void;
};

export default function BundleColumnView({
  bundles,
  iconSize,
  variant,
  laneCount,
  laneSize,
  animationRunning,
  activeAlias,
  bundleStates,
  roleById,
  roleServerCountByRole,
  onOpenRoleDetails,
  onEnableBundle,
  onDisableBundle,
}: BundleColumnViewProps) {
  const { flashingIds, clearDeselectionFlash, triggerDeselectionFlash } =
    useDeselectionFlash(3000);
  const [activeBundleDetailsId, setActiveBundleDetailsId] = useState<string | null>(null);

  const entries = useMemo<BundleEntry[]>(
    () =>
      buildBundleEntries(
        bundles,
        bundleStates,
        roleById,
        roleServerCountByRole
      ),
    [bundles, bundleStates, roleById, roleServerCountByRole]
  );

  const lanes = useMemo(() => buildLanes(entries, laneCount), [entries, laneCount]);
  const activeBundleDetails = useMemo(
    () => entries.find((entry) => entry.bundle.id === activeBundleDetailsId) || null,
    [entries, activeBundleDetailsId]
  );

  const safeLaneCount = Math.max(1, lanes.length);
  const safeLaneSize = Math.max(
    variant === "row" ? 110 : 160,
    Math.floor(Number(laneSize) || 0)
  );
  const rootStyle = {
    "--column-lane-count": safeLaneCount,
    "--column-lane-size": `${safeLaneSize}px`,
    "--column-row-card-width": `${Math.max(420, Math.round(safeLaneSize * 2))}px`,
    "--column-column-card-min-height": `${Math.max(260, Math.round(safeLaneSize * 2))}px`,
  } as CSSProperties;

  const laneRandomPerItemSeconds = useMemo(
    () => buildLaneRandomDurations(lanes.length),
    [lanes.length]
  );

  const {
    hoveredLaneIndex,
    draggingLaneIndex,
    setLaneViewportRef,
    handleLaneWheel,
    handleLanePointerDown,
    handleLanePointerMove,
    handleLanePointerUp,
    handleLanePointerCancel,
    handleLaneScroll,
    handleLaneMouseEnter,
    handleLaneMouseLeave,
    alignLaneViewportsToMiddleSegment,
  } = useLoopingLaneScroller({ variant });

  const renderBundleRoleList = (
    entry: BundleEntry,
    pageSize: number,
    compact = false
  ) => (
    <BundleAppList
      bundleId={`${variant}:${entry.bundle.id}`}
      rows={entry.roleRows}
      pageSize={pageSize}
      compact={compact}
      onOpenRoleDetails={onOpenRoleDetails}
    />
  );

  useEffect(
    () => alignLaneViewportsToMiddleSegment(lanes.length),
    [alignLaneViewportsToMiddleSegment, lanes.length, variant]
  );

  useEffect(() => {
    if (!activeBundleDetailsId) return;
    const exists = entries.some((entry) => entry.bundle.id === activeBundleDetailsId);
    if (!exists) setActiveBundleDetailsId(null);
  }, [entries, activeBundleDetailsId]);

  if (entries.length === 0) {
    return (
      <div className={styles.columnRoot} style={rootStyle}>
        <div className={`text-body-secondary ${styles.columnEmpty}`}>No bundles match the filters.</div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`${styles.columnRoot} ${
          variant === "row" ? styles.columnRootRow : styles.columnRootColumn
        }`}
        style={rootStyle}
      >
        <div
          className={`${styles.columnLanes} ${
            variant === "row" ? styles.columnLanesRow : styles.columnLanesColumn
          }`}
        >
          {lanes.map((laneEntries, laneIndex) => {
            const basePerItemSeconds = laneRandomPerItemSeconds[laneIndex] ?? 17;
            const itemsPerLoop = Math.max(1, laneEntries.length);
            const duration = Number((basePerItemSeconds * itemsPerLoop).toFixed(2));
            const laneStyle = {
              "--column-scroll-duration": `${duration}s`,
            } as CSSProperties;
            const lanePaused = !animationRunning || hoveredLaneIndex === laneIndex;
            return (
              <div
                key={`lane-${laneIndex}`}
                className={`${styles.columnLane} ${
                  variant === "row" ? styles.columnLaneRow : styles.columnLaneColumn
                }`}
              >
                <div
                  ref={setLaneViewportRef(laneIndex)}
                  className={`${styles.columnViewport} ${styles.columnViewportInteractive} ${
                    draggingLaneIndex === laneIndex ? styles.columnViewportDragging : ""
                  }`}
                  onMouseEnter={handleLaneMouseEnter(laneIndex)}
                  onMouseLeave={handleLaneMouseLeave(laneIndex)}
                  onWheel={handleLaneWheel(laneIndex)}
                  onPointerDown={handleLanePointerDown(laneIndex)}
                  onPointerMove={handleLanePointerMove(laneIndex)}
                  onPointerUp={handleLanePointerUp(laneIndex)}
                  onPointerCancel={handleLanePointerCancel(laneIndex)}
                  onScroll={handleLaneScroll(laneIndex)}
                >
                  <div
                    className={`${styles.columnTrack} ${
                      variant === "row"
                        ? styles.columnTrackHorizontal
                        : styles.columnTrackVertical
                    } ${lanePaused ? styles.columnTrackPaused : ""}`}
                    style={laneStyle}
                  >
                    {LOOP_SEGMENT_INDICES.map((segmentIndex) => (
                      <div
                        key={`lane-${laneIndex}-segment-${segmentIndex}`}
                        className={`${styles.columnTrackSegment} ${
                          variant === "row"
                            ? styles.columnTrackSegmentRow
                            : styles.columnTrackSegmentColumn
                        }`}
                      >
                        {laneEntries.map((entry, cardIndex) => {
                          const { bundle, roleIds, state } = entry;
                          const isDeselectionFlashing = flashingIds.has(bundle.id);

                          return (
                            <article
                              key={`${laneIndex}-${segmentIndex}-${cardIndex}-${bundle.id}`}
                              className={`${styles.cardBase} ${styles.columnCard} ${
                                variant === "row" ? styles.columnCardRow : styles.columnCardColumn
                              } ${state.enabled ? styles.cardSelected : styles.cardDefault} ${
                                isDeselectionFlashing ? styles.cardDeselectedFlash : ""
                              }`}
                            >
                              <div
                                className={`${styles.columnCardLayout} ${
                                  variant === "row"
                                    ? styles.columnCardLayoutRow
                                    : styles.columnCardLayoutColumn
                                }`}
                              >
                                {variant === "row" ? (
                                  <div className={`${styles.columnRowShell} ${styles.bundleRowShell}`}>
                                    <div
                                      className={`${styles.columnRowVisualPane} ${styles.bundleRowVisualPane}`}
                                    >
                                      <div
                                        className={`${styles.columnLogoFrame} ${styles.bundleRowLogoFrame}`}
                                      >
                                        {bundleLogo(bundle, Math.max(60, iconSize + 2), styles)}
                                      </div>
                                      <div
                                        className={`${styles.columnLinksRow} ${styles.bundleRowLinksRow}`}
                                      >
                                        {renderBundleRoleList(entry, 2, true)}
                                      </div>
                                    </div>
                                    <div
                                      className={`${styles.columnRowContentPane} ${styles.bundleRowContentPane}`}
                                    >
                                      <h3 className={styles.columnRoleName} title={bundle.title}>
                                        {bundle.title}
                                      </h3>
                                      <p
                                        className={`text-body-secondary ${styles.bundleRowDescription}`}
                                        title={bundle.description || "No description provided."}
                                      >
                                        {bundle.description || "No description provided."}
                                      </p>
                                      <div className={styles.columnPricePanel}>
                                        <span className={styles.columnPriceValue}>
                                          {entry.totalPriceLabel}
                                        </span>
                                        <span
                                          className={`${styles.columnPriceCaption} ${styles.bundlePerMonthCaption}`}
                                        >
                                          per month
                                        </span>
                                      </div>
                                      <div className={styles.bundleRowContentSpacer} aria-hidden="true" />
                                      <div className={styles.columnActionRow}>
                                        <EnableDropdown
                                          enabled={state.enabled}
                                          compact
                                          showPlanField={false}
                                          pricingModel="bundle"
                                          plans={[{ id: "community", label: "Community" }]}
                                          selectedPlanId="community"
                                          appCount={Math.max(1, roleIds.length)}
                                          contextLabel={`device "${activeAlias}" for bundle "${bundle.title}"`}
                                          onOpenDetails={() =>
                                            setActiveBundleDetailsId(bundle.id)
                                          }
                                          onEnable={() => {
                                            clearDeselectionFlash(bundle.id);
                                            onEnableBundle(bundle);
                                          }}
                                          onDisable={() => {
                                            if (!state.enabled) return;
                                            onDisableBundle(bundle);
                                            triggerDeselectionFlash(bundle.id);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className={styles.columnVerticalShell}>
                                    <header className={styles.columnVerticalHeader}>
                                      <h3 className={styles.columnRoleName} title={bundle.title}>
                                        {bundle.title}
                                      </h3>
                                    </header>
                                    <div className={styles.columnLogoFrame}>
                                      {bundleLogo(
                                        bundle,
                                        Math.max(92, iconSize + 28),
                                        styles,
                                        styles.logoRootColumnVertical
                                      )}
                                    </div>
                                    <div className={styles.columnBadgeRow}>
                                      <p
                                        className={`text-body-secondary ${styles.bundleInlineDescription}`}
                                        title={bundle.description || "No description provided."}
                                      >
                                        {bundle.description || "No description provided."}
                                      </p>
                                    </div>
                                    <div className={styles.columnPricePanel}>
                                      <span className={styles.columnPriceValue}>
                                        {entry.totalPriceLabel}
                                      </span>
                                      <span
                                        className={`${styles.columnPriceCaption} ${styles.bundlePerMonthCaption}`}
                                      >
                                        per month
                                      </span>
                                    </div>
                                    <div className={styles.columnLinksRow}>
                                      {renderBundleRoleList(entry, 3)}
                                    </div>
                                    <div className={styles.columnActionRow}>
                                      <EnableDropdown
                                        enabled={state.enabled}
                                        compact
                                        showPlanField={false}
                                        pricingModel="bundle"
                                        plans={[{ id: "community", label: "Community" }]}
                                        selectedPlanId="community"
                                        appCount={Math.max(1, roleIds.length)}
                                        contextLabel={`device "${activeAlias}" for bundle "${bundle.title}"`}
                                        onOpenDetails={() =>
                                          setActiveBundleDetailsId(bundle.id)
                                        }
                                        onEnable={() => {
                                          clearDeselectionFlash(bundle.id);
                                          onEnableBundle(bundle);
                                        }}
                                        onDisable={() => {
                                          if (!state.enabled) return;
                                          onDisableBundle(bundle);
                                          triggerDeselectionFlash(bundle.id);
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
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
      <BundleDetailsModal
        bundle={activeBundleDetails?.bundle || null}
        roleRows={activeBundleDetails?.roleRows || []}
        totalPriceLabel={activeBundleDetails?.totalPriceLabel || "€0.00"}
        appsCaption={
          activeBundleDetails
            ? `${activeBundleDetails.state.selectedCount}/${activeBundleDetails.state.totalCount}`
            : "0/0"
        }
        onOpenRoleDetails={onOpenRoleDetails}
        onClose={() => setActiveBundleDetailsId(null)}
      />
    </>
  );
}
