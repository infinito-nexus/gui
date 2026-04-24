import type { CSSProperties } from "react";

export type StatusPayload = {
  job_id: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  timestamp?: string | null;
};

export type LogRenderMetric = {
  id: number;
  delayMs: number;
  line: string;
  renderedAtMs: number;
  rxUnixMs: number;
};

export type LogLatencyViolation = {
  delayMs: number;
  line: string;
  renderedAtMs: number;
  rxUnixMs: number;
};

type LogPayload = {
  type?: string;
  line?: string;
};

export const LIVE_LOG_MAX_RENDER_METRICS = 200;
export const LIVE_LOG_MAX_DELAY_MS = 30_000;

const RX_PREFIX_PATTERN = /^\[RX:(\d{10,})\]\s?(.*)$/;

export type ParsedSseEvent = {
  event: string;
  data: string;
};

export type LiveDeploymentViewProps = {
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

export function parseSseFrame(frame: string): ParsedSseEvent | null {
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

export function parseLogRenderMetric(
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

export function decodeLogLine(rawData: string): string {
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

export function resolveStreamBaseUrl(
  baseUrl: string,
  streamBaseUrl?: string
): string {
  const explicit = String(streamBaseUrl || "").trim();
  if (explicit) {
    return explicit;
  }
  const configured = String(
    process.env.NEXT_PUBLIC_API_STREAM_BASE_URL || ""
  ).trim();
  return configured || baseUrl;
}

export function buildLiveDeploymentStatusStyle(statusStyles: {
  bg: string;
  fg: string;
  border: string;
}): CSSProperties {
  return {
    "--live-status-bg": statusStyles.bg,
    "--live-status-fg": statusStyles.fg,
    "--live-status-border": statusStyles.border,
  } as CSSProperties;
}

export function buildLiveDeploymentTerminalStyle({
  compact,
  fill,
  hideControls,
}: {
  compact: boolean;
  fill: boolean;
  hideControls: boolean;
}): CSSProperties {
  return {
    "--terminal-top": hideControls ? "0px" : `${compact ? 12 : 16}px`,
    "--terminal-radius": compact ? "0px" : "18px",
    "--terminal-height": fill ? "100%" : "320px",
    "--terminal-flex": fill ? "1" : "initial",
    "--terminal-min-height": fill ? "220px" : "initial",
  } as CSSProperties;
}
