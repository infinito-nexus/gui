"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";

import { isTerminalStatus, statusColors } from "../lib/deployment_status";
import {
  LiveDeploymentControls,
  LiveDeploymentFinalStatus,
  LiveDeploymentHeader,
  LiveDeploymentLatencyProbe,
} from "./LiveDeploymentChrome";
import styles from "./LiveDeploymentView.module.css";
import { useLiveDeploymentTerminal } from "./useLiveDeploymentTerminal";
import {
  buildLiveDeploymentStatusStyle,
  buildLiveDeploymentTerminalStyle,
  decodeLogLine,
  LIVE_LOG_MAX_DELAY_MS,
  LIVE_LOG_MAX_RENDER_METRICS,
  parseLogRenderMetric,
  parseSseFrame,
  resolveStreamBaseUrl,
  type LiveDeploymentViewProps,
  type LogLatencyViolation,
  type LogRenderMetric,
  type ParsedSseEvent,
  type StatusPayload,
} from "./liveDeploymentViewShared";

export default function LiveDeploymentView({
  baseUrl,
  streamBaseUrl,
  jobId: externalJobId,
  autoConnect = false,
  compact = false,
  fill = false,
  hideControls = false,
  connectRequestKey,
  cancelRequestKey,
  onStatusChange,
  onConnectedChange,
  onCancelingChange,
  onErrorChange,
  onJobIdSync,
}: LiveDeploymentViewProps) {
  const Wrapper = compact ? "div" : "section";
  const wrapperClassName = [compact ? "" : styles.wrapperPanel, fill ? styles.wrapperFill : ""]
    .filter(Boolean)
    .join(" ");

  const [jobId, setJobId] = useState(externalJobId ?? "");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [renderMetrics, setRenderMetrics] = useState<LogRenderMetric[]>([]);

  const lastAutoJobRef = useRef<string | null>(null);
  const lastConnectRequestRef = useRef<number | undefined>(connectRequestKey);
  const lastCancelRequestRef = useRef<number | undefined>(cancelRequestKey);
  const renderMetricIdRef = useRef(0);
  const pendingLinesRef = useRef<string[]>([]);
  const attachedJobRef = useRef<string | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const receivedLogLineCountRef = useRef(0);
  const observedCountRef = useRef(0);
  const maxObservedDelayMsRef = useRef(0);
  const latencyViolationRef = useRef<LogLatencyViolation | null>(null);
  const openEventCountRef = useRef(0);
  const statusEventCountRef = useRef(0);
  const errorEventCountRef = useRef(0);
  const lastStatusRef = useRef("");

  const termRef = useRef<XTermTerminal | null>(null);
  const fitRef = useRef<XTermFitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streamAbortRef = useRef<{ abort: () => void } | null>(null);
  const streamTokenRef = useRef(0);

  const syncProbeSnapshot = useCallback(() => {
    const probe = probeRef.current;
    if (!probe) {
      return;
    }
    probe.dataset.latencyOk = latencyViolationRef.current ? "false" : "true";
    probe.dataset.receivedLineCount = String(receivedLogLineCountRef.current);
    probe.dataset.maxDelayMs = String(maxObservedDelayMsRef.current);
    probe.dataset.observedCount = String(observedCountRef.current);
    probe.dataset.openEventCount = String(openEventCountRef.current);
    probe.dataset.statusEventCount = String(statusEventCountRef.current);
    probe.dataset.errorEventCount = String(errorEventCountRef.current);
    probe.dataset.lastStatus = lastStatusRef.current;
    probe.dataset.violationDelayMs = latencyViolationRef.current
      ? String(latencyViolationRef.current.delayMs)
      : "";
    probe.dataset.violationLine = latencyViolationRef.current?.line ?? "";
  }, []);

  const recordRenderedLines = useCallback(
    (lines: string[], renderedAtMs: number) => {
      const nextMetrics: LogRenderMetric[] = [];
      lines.forEach((line) => {
        const metric = parseLogRenderMetric(line, renderedAtMs);
        if (!metric) {
          return;
        }
        nextMetrics.push({
          ...metric,
          id: renderMetricIdRef.current++,
        });
      });
      if (nextMetrics.length === 0) {
        return;
      }
      observedCountRef.current += nextMetrics.length;
      maxObservedDelayMsRef.current = nextMetrics.reduce(
        (currentMax, metric) => Math.max(currentMax, metric.delayMs),
        maxObservedDelayMsRef.current
      );
      setRenderMetrics((prev) =>
        prev.concat(nextMetrics).slice(-LIVE_LOG_MAX_RENDER_METRICS)
      );
      if (!latencyViolationRef.current) {
        const firstViolation = nextMetrics.find(
          (metric) => metric.delayMs > LIVE_LOG_MAX_DELAY_MS
        );
        if (firstViolation) {
          latencyViolationRef.current = {
            delayMs: firstViolation.delayMs,
            line: firstViolation.line,
            renderedAtMs: firstViolation.renderedAtMs,
            rxUnixMs: firstViolation.rxUnixMs,
          };
        }
      }
      syncProbeSnapshot();
    },
    [syncProbeSnapshot]
  );

  const writeTerminalBanner = useCallback(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    term.reset();
    if (attachedJobRef.current) {
      term.writeln("\u001b[1mAttaching to job\u001b[0m " + attachedJobRef.current);
      return;
    }
    term.writeln("\u001b[1mLive deployment logs\u001b[0m");
    term.writeln("Attach to a job ID to stream output.");
  }, []);

  const flushPendingLines = useCallback(() => {
    const term = termRef.current;
    if (!term || pendingLinesRef.current.length === 0) {
      return;
    }
    const pendingLines = pendingLinesRef.current.splice(0);
    const renderedAtMs = Date.now();
    pendingLines.forEach((line) => {
      term.writeln(line);
    });
    recordRenderedLines(pendingLines, renderedAtMs);
  }, [recordRenderedLines]);

  useLiveDeploymentTerminal({
    compact,
    fill,
    hideControls,
    containerRef,
    termRef,
    fitRef,
    flushPendingLines,
    writeTerminalBanner,
  });

  useEffect(() => () => streamAbortRef.current?.abort(), []);
  useEffect(() => syncProbeSnapshot(), [syncProbeSnapshot]);

  const statusStyles = useMemo(() => statusColors(status?.status), [status]);
  const resolvedStreamBaseUrl = useMemo(() => resolveStreamBaseUrl(baseUrl, streamBaseUrl), [baseUrl, streamBaseUrl]);
  const statusStyle = buildLiveDeploymentStatusStyle(statusStyles);
  const terminalStyle = buildLiveDeploymentTerminalStyle({
    compact,
    fill,
    hideControls,
  });

  const writeLines = useCallback(
    (text: string) => {
      const lines = String(text ?? "").split("\n");
      const sanitizedLines = lines.map((line) => line.replace(/\r/g, ""));
      const nonEmptyLines = sanitizedLines.filter(
        (line) => line.trim().length > 0
      );
      if (nonEmptyLines.length > 0) {
        receivedLogLineCountRef.current += nonEmptyLines.length;
        syncProbeSnapshot();
      }
      const term = termRef.current;
      if (!term) {
        pendingLinesRef.current.push(...sanitizedLines);
        return;
      }
      const renderedAtMs = Date.now();
      sanitizedLines.forEach((line) => {
        term.writeln(line);
      });
      recordRenderedLines(sanitizedLines, renderedAtMs);
    },
    [recordRenderedLines, syncProbeSnapshot]
  );

  useEffect(() => {
    if (typeof externalJobId !== "string") {
      return;
    }
    setJobId((prev) => (prev === externalJobId ? prev : externalJobId));
  }, [externalJobId]);

  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  useEffect(() => {
    onCancelingChange?.(canceling);
  }, [canceling, onCancelingChange]);

  useEffect(() => {
    onErrorChange?.(error);
  }, [error, onErrorChange]);

  useEffect(() => {
    onJobIdSync?.(jobId);
  }, [jobId, onJobIdSync]);

  const connectTo = useCallback(
    (rawId: string) => {
      const trimmed = rawId.trim();
      if (!trimmed) {
        return;
      }
      setError(null);
      setStatus(null);
      setConnected(true);
      setJobId(trimmed);
      receivedLogLineCountRef.current = 0;
      observedCountRef.current = 0;
      maxObservedDelayMsRef.current = 0;
      latencyViolationRef.current = null;
      openEventCountRef.current = 0;
      statusEventCountRef.current = 0;
      errorEventCountRef.current = 0;
      lastStatusRef.current = "";
      setRenderMetrics([]);
      renderMetricIdRef.current = 0;
      pendingLinesRef.current = [];
      attachedJobRef.current = trimmed;
      syncProbeSnapshot();

      streamAbortRef.current?.abort();
      writeTerminalBanner();

      const streamToken = streamTokenRef.current + 1;
      streamTokenRef.current = streamToken;
      let streamHandle: { abort: () => void } | null = null;
      const closeStream = () => {
        streamHandle?.abort();
        if (streamAbortRef.current === streamHandle) {
          streamAbortRef.current = null;
        }
      };
      const handleStreamFailure = (message: string) => {
        if (streamTokenRef.current !== streamToken) {
          return;
        }
        errorEventCountRef.current += 1;
        syncProbeSnapshot();
        setError(message);
        setConnected(false);
        closeStream();
      };

      const applyStatusPayload = (rawData: string, terminal = false) => {
        try {
          const payload = JSON.parse(rawData) as StatusPayload;
          lastStatusRef.current = String(payload?.status || "");
          setStatus(payload);
          onStatusChange?.(payload);
        } catch {
          lastStatusRef.current = "";
          setStatus(null);
          onStatusChange?.(null);
        }
        if (terminal) {
          setConnected(false);
          writeLines("\u001b[1mDeployment finished\u001b[0m");
        }
        syncProbeSnapshot();
      };

      const handleStreamEvent = (parsed: ParsedSseEvent) => {
        if (streamTokenRef.current !== streamToken) {
          return false;
        }

        if (parsed.event === "log") {
          writeLines(decodeLogLine(parsed.data));
          return false;
        }

        if (parsed.event === "status") {
          statusEventCountRef.current += 1;
          applyStatusPayload(parsed.data);
          return false;
        }

        if (parsed.event === "done") {
          applyStatusPayload(parsed.data, true);
          return true;
        }

        if (parsed.event === "error") {
          handleStreamFailure("Connection lost");
          return true;
        }

        return false;
      };

      const es = new EventSource(
        `${resolvedStreamBaseUrl}/api/deployments/${trimmed}/logs`
      );
      streamHandle = {
        abort: () => {
          es.close();
        },
      };
      streamAbortRef.current = streamHandle;

      es.onopen = () => {
        if (streamTokenRef.current !== streamToken) {
          closeStream();
          return;
        }
        openEventCountRef.current += 1;
        syncProbeSnapshot();
      };

      es.addEventListener("log", (event) => {
        const parsed = parseSseFrame(`event: log\ndata: ${(event as MessageEvent).data}`);
        if (parsed) {
          handleStreamEvent(parsed);
        }
      });

      es.addEventListener("status", (event) => {
        const parsed = parseSseFrame(
          `event: status\ndata: ${(event as MessageEvent).data}`
        );
        if (parsed) {
          handleStreamEvent(parsed);
        }
      });

      es.addEventListener("done", (event) => {
        const parsed = parseSseFrame(
          `event: done\ndata: ${(event as MessageEvent).data}`
        );
        if (!parsed) {
          return;
        }
        if (handleStreamEvent(parsed)) {
          closeStream();
        }
      });

      es.onerror = () => {
        handleStreamFailure("Connection lost");
      };
    },
    [
      onStatusChange,
      resolvedStreamBaseUrl,
      syncProbeSnapshot,
      writeLines,
      writeTerminalBanner,
    ]
  );

  const connect = () => {
    connectTo(jobId);
  };

  useEffect(() => {
    if (!autoConnect) {
      return;
    }
    const trimmed = String(externalJobId ?? "").trim();
    if (!trimmed || lastAutoJobRef.current === trimmed) {
      return;
    }
    lastAutoJobRef.current = trimmed;
    connectTo(trimmed);
  }, [autoConnect, connectTo, externalJobId]);

  useEffect(() => {
    if (typeof connectRequestKey !== "number") {
      return;
    }
    if (lastConnectRequestRef.current === connectRequestKey) {
      return;
    }
    lastConnectRequestRef.current = connectRequestKey;
    connectTo(String(externalJobId || jobId).trim());
  }, [connectRequestKey, connectTo, externalJobId, jobId]);

  const cancel = useCallback(
    async (rawJobId?: string) => {
      const targetJobId = String(rawJobId ?? jobId).trim();
      if (!targetJobId || isTerminalStatus(status?.status)) {
        return;
      }
      setCanceling(true);
      setError(null);
      try {
        const res = await fetch(`${baseUrl}/api/deployments/${targetJobId}/cancel`, {
          method: "POST",
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
      } catch (err: any) {
        setError(err?.message ?? "Cancel failed");
      } finally {
        setCanceling(false);
      }
    },
    [baseUrl, jobId, status?.status]
  );

  useEffect(() => {
    if (typeof cancelRequestKey !== "number") {
      return;
    }
    if (lastCancelRequestRef.current === cancelRequestKey) {
      return;
    }
    lastCancelRequestRef.current = cancelRequestKey;
    void cancel(jobId);
  }, [cancel, cancelRequestKey, jobId]);

  return (
    <Wrapper className={wrapperClassName}>
      <LiveDeploymentHeader
        compact={compact}
        status={status}
        statusStyle={statusStyle}
      />

      {!hideControls ? (
        <LiveDeploymentControls
          jobId={jobId}
          connected={connected}
          canceling={canceling}
          status={status}
          onConnect={connect}
          onCancel={() => {
            void cancel();
          }}
          onJobIdChange={setJobId}
        />
      ) : null}

      {error ? <div className={`text-danger ${styles.error}`}>{error}</div> : null}

      <div className={styles.terminalWrap} style={terminalStyle}>
        <div className={styles.terminalContainer} ref={containerRef} />
      </div>

      <LiveDeploymentLatencyProbe
        probeRef={probeRef}
        renderMetrics={renderMetrics}
      />

      <LiveDeploymentFinalStatus status={status} statusStyle={statusStyle} />
    </Wrapper>
  );
}
