import styles from "../../RoleDashboard.module.css";

type RoleDashboardPaginationProps = {
  isLaneAnimatedView: boolean;
  laneAnimatedItemCount: number;
  columnAnimationRunning: boolean;
  currentPage: number;
  pageCount: number;
  onToggleAnimation: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export default function RoleDashboardPagination({
  isLaneAnimatedView,
  laneAnimatedItemCount,
  columnAnimationRunning,
  currentPage,
  pageCount,
  onToggleAnimation,
  onPrev,
  onNext,
}: RoleDashboardPaginationProps) {
  return (
    <div className={`text-body-secondary ${styles.pagination}`}>
      <button
        type="button"
        onClick={onPrev}
        disabled={isLaneAnimatedView ? laneAnimatedItemCount <= 1 : currentPage <= 1}
        className={`${styles.pageButton} ${
          isLaneAnimatedView
            ? laneAnimatedItemCount <= 1
              ? styles.pageButtonDisabled
              : `${styles.pageButtonEnabled} ${styles.columnTransportButton}`
            : currentPage <= 1
              ? styles.pageButtonDisabled
              : styles.pageButtonEnabled
        }`}
        aria-label={isLaneAnimatedView ? "Skip backward" : "Previous page"}
        title={isLaneAnimatedView ? "Zurückspringen" : "Previous page"}
      >
        {isLaneAnimatedView ? (
          <>
            <i className="fa-solid fa-backward-step" aria-hidden="true" />
            <span className="visually-hidden">Zurückspringen</span>
          </>
        ) : (
          "Prev"
        )}
      </button>
      {isLaneAnimatedView ? (
        <button
          type="button"
          onClick={onToggleAnimation}
          className={`${styles.pageButton} ${styles.pageButtonEnabled} ${styles.columnToggleButton}`}
          aria-label={columnAnimationRunning ? "Stop animation" : "Start animation"}
          title={columnAnimationRunning ? "Stop animation" : "Start animation"}
        >
          <i
            className={
              columnAnimationRunning
                ? "fa-solid fa-circle-stop"
                : "fa-solid fa-circle-play"
            }
            aria-hidden="true"
          />
          <span className="visually-hidden">
            {columnAnimationRunning ? "Stop" : "Start"}
          </span>
        </button>
      ) : (
        <span>
          Page {currentPage} / {pageCount}
        </span>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={isLaneAnimatedView ? laneAnimatedItemCount <= 1 : currentPage >= pageCount}
        className={`${styles.pageButton} ${
          isLaneAnimatedView
            ? laneAnimatedItemCount <= 1
              ? styles.pageButtonDisabled
              : `${styles.pageButtonEnabled} ${styles.columnTransportButton}`
            : currentPage >= pageCount
              ? styles.pageButtonDisabled
              : styles.pageButtonEnabled
        }`}
        aria-label={isLaneAnimatedView ? "Skip forward" : "Next page"}
        title={isLaneAnimatedView ? "Vorspringen" : "Next page"}
      >
        {isLaneAnimatedView ? (
          <>
            <i className="fa-solid fa-forward-step" aria-hidden="true" />
            <span className="visually-hidden">Vorspringen</span>
          </>
        ) : (
          "Next"
        )}
      </button>
    </div>
  );
}
