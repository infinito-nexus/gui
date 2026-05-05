import type { CSSProperties, MutableRefObject } from "react";

import { isTerminalStatus, statusLabel } from "../../lib/deployment_status";
import styles from "./View.module.css";
import type {
  LogRenderMetric,
  StatusPayload,
} from "../liveDeploymentViewShared";

type LiveDeploymentHeaderProps = {
  compact: boolean;
  status: StatusPayload | null;
  statusStyle: CSSProperties;
};

export function LiveDeploymentHeader({
  compact,
  status,
  statusStyle,
}: LiveDeploymentHeaderProps) {
  if (compact) {
    return null;
  }

  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <h2 className={`text-body ${styles.title}`}>Live Deployment View</h2>
        <p className={`text-body-secondary ${styles.subtitle}`}>
          Docker-like terminal output via SSE, with real-time status updates.
        </p>
      </div>
      <div className={`text-body-secondary ${styles.headerRight}`}>
        Status:{" "}
        <span className={styles.statusBadge} style={statusStyle}>
          {statusLabel(status?.status)}
        </span>
      </div>
    </div>
  );
}

type LiveDeploymentControlsProps = {
  jobId: string;
  connected: boolean;
  canceling: boolean;
  status: StatusPayload | null;
  onConnect: () => void;
  onCancel: () => void;
  onJobIdChange: (nextJobId: string) => void;
};

export function LiveDeploymentControls({
  jobId,
  connected,
  canceling,
  status,
  onConnect,
  onCancel,
  onJobIdChange,
}: LiveDeploymentControlsProps) {
  const cancelDisabled =
    !jobId.trim() || canceling || isTerminalStatus(status?.status);

  return (
    <div className={styles.controls}>
      <input
        value={jobId}
        onChange={(event) => onJobIdChange(event.target.value)}
        placeholder="Job ID"
        className={styles.jobInput}
      />
      <button
        onClick={onConnect}
        disabled={!jobId.trim() || connected}
        className={`${styles.connectButton} ${
          connected ? styles.connectDisabled : styles.connectEnabled
        }`}
      >
        {connected ? "Connected" : "Connect"}
      </button>
      <button
        onClick={onCancel}
        disabled={cancelDisabled}
        className={`${styles.cancelButton} ${
          cancelDisabled ? styles.cancelDisabled : styles.cancelEnabled
        }`}
      >
        {canceling ? "Canceling..." : "Cancel"}
      </button>
    </div>
  );
}

type LiveDeploymentLatencyProbeProps = {
  probeRef: MutableRefObject<HTMLDivElement | null>;
  renderMetrics: LogRenderMetric[];
};

export function LiveDeploymentLatencyProbe({
  probeRef,
  renderMetrics,
}: LiveDeploymentLatencyProbeProps) {
  return (
    <div
      ref={probeRef}
      hidden
      aria-hidden="true"
      data-testid="live-log-latency-probe"
    >
      {renderMetrics.map((metric) => (
        <div
          key={metric.id}
          data-testid="live-log-latency-sample"
          data-delay-ms={String(metric.delayMs)}
          data-rendered-at-ms={String(metric.renderedAtMs)}
          data-rx-unix-ms={String(metric.rxUnixMs)}
        >
          {metric.line}
        </div>
      ))}
    </div>
  );
}

type LiveDeploymentFinalStatusProps = {
  status: StatusPayload | null;
  statusStyle: CSSProperties;
};

export function LiveDeploymentFinalStatus({
  status,
  statusStyle,
}: LiveDeploymentFinalStatusProps) {
  if (!status?.status || !isTerminalStatus(status.status)) {
    return null;
  }

  return (
    <div className={styles.finalStatus} style={statusStyle}>
      Final status: {statusLabel(status.status)}
      {status.exit_code !== null && status.exit_code !== undefined
        ? ` (exit ${status.exit_code})`
        : ""}
    </div>
  );
}
