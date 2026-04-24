"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import {
  isTerminalStatus,
  statusColors,
  statusLabel,
} from "../lib/deployment_status";
import styles from "./LiveDeploymentView.module.css";

type StatusPayload = {
  job_id: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  timestamp?: string | null;
};

type LogRenderMetric = {
  id: number;
  delayMs: number;
  line: string;
  renderedAtMs: number;
  rxUnixMs: number;
};

type LogLatencyViolation = {
  delayMs: number;
  line: string;
  renderedAtMs: number;
  rxUnixMs: number;
};

type LogPayload = {
  type?: string;
  line?: string;
};

const MAX_RENDER_METRICS = 200;
const RX_PREFIX_PATTERN = /^\[RX:(\d{10,})\]\s?(.*)$/;

type ParsedSseEvent = {
  event: string;
  data: string;
};

function parseSseFrame(frame: string): ParsedSseEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  frame.split("\n").forEach((line) => {
    if (!line || line.startsWith(":")) {
      return;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      event = value || "message";
      return;
    }
    if (field === "data") {
      dataLines.push(value);
    }
  });

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

function parseLogRenderMetric(
  line: string,
  renderedAtMs: number
): Omit<LogRenderMetric, "id"> | null {
  const match = RX_PREFIX_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  const rxUnixMs = Number(match[1]);
  if (!Number.isFinite(rxUnixMs)) {
    return null;
  }
  return {
    delayMs: Math.max(0, renderedAtMs - rxUnixMs),
    line: line.trim(),
    renderedAtMs,
    rxUnixMs,
  };
}

function decodeLogLine(rawData: string): string {
  try {
    const payload = JSON.parse(rawData) as LogPayload;
    if (typeof payload?.line === "string" && payload.line.trim()) {
      return payload.line;
    }
  } catch {
    // Backwards-compatible fallback for older plain-text log frames.
  }
  return rawData;
}

function resolveStreamBaseUrl(baseUrl: string, streamBaseUrl?: string): string {
  const explicit = String(streamBaseUrl || "").trim();
  if (explicit) {
    return explicit;
  }
  const configured = String(process.env.NEXT_PUBLIC_API_STREAM_BASE_URL || "").trim();
  return configured || baseUrl;
}

type LiveDeploymentViewProps = {
  baseUrl: string;
  streamBaseUrl?: string;
  jobId?: string;
  autoConnect?: boolean;
  compact?: boolean;
  fill?: boolean;
  hideControls?: boolean;
  connectRequestKey?: number;
  cancelRequestKey?: number;
  onStatusChange?: (status: StatusPayload | null) => void;
  onConnectedChange?: (connected: boolean) => void;
  onCancelingChange?: (canceling: boolean) => void;
  onErrorChange?: (error: string | null) => void;
  onJobIdSync?: (jobId: string) => void;
};

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
  const wrapperClassName = [
    compact ? "" : styles.wrapperPanel,
    fill ? styles.wrapperFill : "",
  ]
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
        prev.concat(nextMetrics).slice(-MAX_RENDER_METRICS)
      );
      if (!latencyViolationRef.current) {
        const firstViolation = nextMetrics.find(
          (metric) => metric.delayMs > 30_000
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

  useEffect(() => {
    let disposed = false;
    let onResize: (() => void) | null = null;
    let onSchemeChange: (() => void) | null = null;
    let mediaQuery: MediaQueryList | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const readCssVar = (name: string, fallback: string) => {
      if (typeof window === "undefined") return fallback;
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return value || fallback;
    };

    const buildTheme = () => ({
      background: readCssVar("--deployer-terminal-bg", "#0b0f19"),
      foreground: readCssVar("--deployer-terminal-text", "#e2e8f0"),
      cursor: readCssVar("--deployer-accent", "#38bdf8"),
    });

    const setupTerminal = async () => {
      if (!containerRef.current) return;
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 12,
        theme: buildTheme(),
        convertEol: true,
        cursorBlink: true,
        scrollback: 2000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;
      writeTerminalBanner();
      flushPendingLines();

      onResize = () => fit.fit();
      window.addEventListener("resize", onResize);
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        resizeObserver = new ResizeObserver(() => fit.fit());
        resizeObserver.observe(containerRef.current);
      }

      if (typeof window !== "undefined") {
        mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        onSchemeChange = () => {
          const nextTheme = buildTheme();
          term.options.theme = nextTheme;
          term.refresh(0, Math.max(0, term.rows - 1));
        };
        const legacyMediaQuery = mediaQuery as MediaQueryList & {
          addListener?: (listener: () => void) => void;
          removeListener?: (listener: () => void) => void;
        };
        if (legacyMediaQuery.addEventListener) {
          legacyMediaQuery.addEventListener("change", onSchemeChange);
        } else if (legacyMediaQuery.addListener) {
          legacyMediaQuery.addListener(onSchemeChange);
        }
      }
    };

    setupTerminal().catch((err) => {
      console.error("Failed to initialize xterm", err);
    });

    return () => {
      disposed = true;
      if (onResize) window.removeEventListener("resize", onResize);
      if (mediaQuery && onSchemeChange) {
        const legacyMediaQuery = mediaQuery as MediaQueryList & {
          addListener?: (listener: () => void) => void;
          removeListener?: (listener: () => void) => void;
        };
        if (legacyMediaQuery.removeEventListener) {
          legacyMediaQuery.removeEventListener("change", onSchemeChange);
        } else if (legacyMediaQuery.removeListener) {
          legacyMediaQuery.removeListener(onSchemeChange);
        }
      }
      resizeObserver?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [flushPendingLines, writeTerminalBanner]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    syncProbeSnapshot();
  }, [syncProbeSnapshot]);

  const statusStyles = useMemo(() => statusColors(status?.status), [status]);
  const resolvedStreamBaseUrl = useMemo(
    () => resolveStreamBaseUrl(baseUrl, streamBaseUrl),
    [baseUrl, streamBaseUrl]
  );
  const statusStyle = {
    "--live-status-bg": statusStyles.bg,
    "--live-status-fg": statusStyles.fg,
    "--live-status-border": statusStyles.border,
  } as CSSProperties;
  const terminalStyle = {
    "--terminal-top": hideControls ? "0px" : `${compact ? 12 : 16}px`,
    "--terminal-radius": compact ? "0px" : "18px",
    "--terminal-height": fill ? "100%" : "320px",
    "--terminal-flex": fill ? "1" : "initial",
    "--terminal-min-height": fill ? "220px" : "initial",
  } as CSSProperties;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      fitRef.current?.fit();
    });
  }, [fill, compact, hideControls]);

  const writeLines = useCallback((text: string) => {
    const lines = String(text ?? "").split("\n");
    const sanitizedLines = lines.map((line) => line.replace(/\r/g, ""));
    const nonEmptyLines = sanitizedLines.filter((line) => line.trim().length > 0);
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
  }, [recordRenderedLines, syncProbeSnapshot]);

  useEffect(() => {
    if (typeof externalJobId !== "string") return;
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

  const connectTo = useCallback((rawId: string) => {
    const trimmed = rawId.trim();
    if (!trimmed) return;
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
        const payload = JSON.parse(rawData);
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

    es.addEventListener("log", (evt) => {
      const parsed = parseSseFrame(`event: log\ndata: ${(evt as MessageEvent).data}`);
      if (!parsed) {
        return;
      }
      void handleStreamEvent(parsed);
    });

    es.addEventListener("status", (evt) => {
      const parsed = parseSseFrame(
        `event: status\ndata: ${(evt as MessageEvent).data}`
      );
      if (!parsed) {
        return;
      }
      void handleStreamEvent(parsed);
    });

    es.addEventListener("done", (evt) => {
      const parsed = parseSseFrame(`event: done\ndata: ${(evt as MessageEvent).data}`);
      if (!parsed) {
        return;
      }
      const terminal = handleStreamEvent(parsed);
      if (terminal) {
        closeStream();
      }
    });

    es.onerror = () => {
      handleStreamFailure("Connection lost");
    };
  }, [
    onStatusChange,
    resolvedStreamBaseUrl,
    syncProbeSnapshot,
    writeLines,
    writeTerminalBanner,
  ]);

  const connect = () => {
    connectTo(jobId);
  };

  useEffect(() => {
    if (!autoConnect) return;
    const trimmed = String(externalJobId ?? "").trim();
    if (!trimmed) return;
    if (lastAutoJobRef.current === trimmed) return;
    lastAutoJobRef.current = trimmed;
    connectTo(trimmed);
  }, [autoConnect, connectTo, externalJobId]);

  useEffect(() => {
    if (typeof connectRequestKey !== "number") return;
    if (lastConnectRequestRef.current === connectRequestKey) return;
    lastConnectRequestRef.current = connectRequestKey;
    const targetJobId = String(externalJobId || jobId).trim();
    connectTo(targetJobId);
  }, [connectRequestKey, connectTo, externalJobId, jobId]);

  const cancel = useCallback(async (rawJobId?: string) => {
    const targetJobId = String(rawJobId ?? jobId).trim();
    if (!targetJobId || isTerminalStatus(status?.status)) return;
    setCanceling(true);
    setError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/deployments/${targetJobId}/cancel`,
        { method: "POST" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setError(err?.message ?? "Cancel failed");
    } finally {
      setCanceling(false);
    }
  }, [baseUrl, jobId, status?.status]);

  useEffect(() => {
    if (typeof cancelRequestKey !== "number") return;
    if (lastCancelRequestRef.current === cancelRequestKey) return;
    lastCancelRequestRef.current = cancelRequestKey;
    void cancel(jobId);
  }, [cancel, cancelRequestKey, jobId, status?.status]);

  return (
    <Wrapper className={wrapperClassName}>
      {!compact ? (
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
      ) : null}

      {!hideControls ? (
        <div className={styles.controls}>
          <input
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="Job ID"
            className={styles.jobInput}
          />
          <button
            onClick={connect}
            disabled={!jobId.trim() || connected}
            className={`${styles.connectButton} ${
              connected ? styles.connectDisabled : styles.connectEnabled
            }`}
          >
            {connected ? "Connected" : "Connect"}
          </button>
          <button
            onClick={() => {
              void cancel();
            }}
            disabled={!jobId.trim() || canceling || isTerminalStatus(status?.status)}
            className={`${styles.cancelButton} ${
              !jobId.trim() || canceling || isTerminalStatus(status?.status)
                ? styles.cancelDisabled
                : styles.cancelEnabled
            }`}
          >
            {canceling ? "Canceling..." : "Cancel"}
          </button>
        </div>
      ) : null}

      {error ? <div className={`text-danger ${styles.error}`}>{error}</div> : null}

      <div className={styles.terminalWrap} style={terminalStyle}>
        <div className={styles.terminalContainer} ref={containerRef} />
      </div>

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

      {status?.status && isTerminalStatus(status.status) ? (
        <div className={styles.finalStatus} style={statusStyle}>
          Final status: {statusLabel(status.status)}
          {status.exit_code !== null && status.exit_code !== undefined
            ? ` (exit ${status.exit_code})`
            : ""}
        </div>
      ) : null}
    </Wrapper>
  );
}
