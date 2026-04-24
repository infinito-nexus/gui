"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import styles from "./DeploymentLogs.module.css";

type StatusPayload = {
  job_id: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  timestamp?: string | null;
};

const MAX_LINES = 1000;

const ANSI_COLORS: Record<number, string> = {
  30: "#111827",
  31: "#dc2626",
  32: "#16a34a",
  33: "#d97706",
  34: "#2563eb",
  35: "#7c3aed",
  36: "#0d9488",
  37: "#e5e7eb",
  90: "#6b7280",
  91: "#ef4444",
  92: "#22c55e",
  93: "#f59e0b",
  94: "#3b82f6",
  95: "#a855f7",
  96: "#14b8a6",
  97: "#f9fafb",
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "#111827",
  41: "#b91c1c",
  42: "#15803d",
  43: "#b45309",
  44: "#1d4ed8",
  45: "#6d28d9",
  46: "#0f766e",
  47: "#f3f4f6",
  100: "#374151",
  101: "#ef4444",
  102: "#22c55e",
  103: "#f59e0b",
  104: "#3b82f6",
  105: "#a855f7",
  106: "#14b8a6",
  107: "#ffffff",
};

function maskSecretsLine(line: string): string {
  let out = line;
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "********"
  );
  out = out.replace(
    /((?:password|passwd|secret|token|apikey|api_key|access_key|private_key)\s*[:=]\s*)([^\s]+)/gi,
    "$1********"
  );
  out = out.replace(/(sshpass\s+-p\s+)([^\s]+)/gi, "$1********");
  out = out.replace(/(--password\s+)([^\s]+)/gi, "$1********");
  out = out.replace(/(--token\s+)([^\s]+)/gi, "$1********");
  return out;
}

type AnsiSegment = {
  text: string;
  style: CSSProperties;
};

function parseAnsi(text: string): AnsiSegment[] {
  const cleaned = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, (match) =>
    match.endsWith("m") ? match : ""
  );

  const segments: AnsiSegment[] = [];
  let style: CSSProperties = {};
  const pattern = /\x1b\[[0-9;]*m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: cleaned.slice(lastIndex, match.index),
        style: { ...style },
      });
    }

    const codes = match[0]
      .slice(2, -1)
      .split(";")
      .filter(Boolean)
      .map((v) => Number(v));

    if (codes.length === 0) {
      style = {};
    } else {
      for (const code of codes) {
        if (code === 0) {
          style = {};
        } else if (code === 1) {
          style = { ...style, fontWeight: 700 };
        } else if (code === 22) {
          const { fontWeight, ...rest } = style;
          style = { ...rest };
        } else if (code === 39) {
          const { color, ...rest } = style;
          style = { ...rest };
        } else if (code === 49) {
          const { backgroundColor, ...rest } = style;
          style = { ...rest };
        } else if (ANSI_COLORS[code]) {
          style = { ...style, color: ANSI_COLORS[code] };
        } else if (ANSI_BG_COLORS[code]) {
          style = { ...style, backgroundColor: ANSI_BG_COLORS[code] };
        }
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    segments.push({
      text: cleaned.slice(lastIndex),
      style: { ...style },
    });
  }

  return segments;
}

function AnsiLine({ line }: { line: string }) {
  const segments = useMemo(() => parseAnsi(line), [line]);
  return (
    <div className={styles.ansiLine}>
      {segments.map((seg, idx) => (
        <span key={idx} style={seg.style}>
          {seg.text}
        </span>
      ))}
    </div>
  );
}

function resolveStreamBaseUrl(baseUrl: string, streamBaseUrl?: string): string {
  const explicit = String(streamBaseUrl || "").trim();
  if (explicit) {
    return explicit;
  }
  const configured = String(process.env.NEXT_PUBLIC_API_STREAM_BASE_URL || "").trim();
  return configured || baseUrl;
}

export default function DeploymentLogs({
  baseUrl,
  streamBaseUrl,
}: {
  baseUrl: string;
  streamBaseUrl?: string;
}) {
  const [jobId, setJobId] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const resolvedStreamBaseUrl = useMemo(
    () => resolveStreamBaseUrl(baseUrl, streamBaseUrl),
    [baseUrl, streamBaseUrl]
  );

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "auto" });
  }, [lines.length]);

  const connect = () => {
    const trimmed = jobId.trim();
    if (!trimmed) return;

    if (esRef.current) {
      esRef.current.close();
    }

    setLines([]);
    setError(null);
    setStatus(null);
    setConnected(true);

    const es = new EventSource(
      `${resolvedStreamBaseUrl}/api/deployments/${trimmed}/logs`
    );
    esRef.current = es;

    es.addEventListener("log", (evt) => {
      const payload = (evt as MessageEvent).data ?? "";
      const entries = String(payload)
        .split("\n")
        .map(maskSecretsLine);
      setLines((prev) => {
        const next = prev.concat(entries);
        if (next.length > MAX_LINES) {
          return next.slice(-MAX_LINES);
        }
        return next;
      });
    });

    es.addEventListener("status", (evt) => {
      try {
        setStatus(JSON.parse((evt as MessageEvent).data));
      } catch {
        setStatus(null);
      }
    });

    es.addEventListener("done", (evt) => {
      try {
        setStatus(JSON.parse((evt as MessageEvent).data));
      } catch {
        setStatus(null);
      }
      setConnected(false);
      es.close();
    });

    es.onerror = () => {
      setError("connection lost");
      setConnected(false);
    };
  };

  const disconnect = () => {
    if (esRef.current) {
      esRef.current.close();
    }
    setConnected(false);
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Live Logs (SSE)</h2>

      <div className={styles.controls}>
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="Job ID (e.g. a1b2c3d4e5f6)"
          className={styles.input}
        />
        <button
          onClick={connect}
          disabled={!jobId.trim() || connected}
          className={`${styles.button} ${styles.connectButton} ${
            connected ? styles.connectDisabled : styles.connectEnabled
          }`}
        >
          {connected ? "Connected" : "Connect"}
        </button>
        <button
          onClick={disconnect}
          disabled={!connected}
          className={`${styles.button} ${styles.disconnectButton} ${
            connected ? styles.disconnectEnabled : styles.disconnectDisabled
          }`}
        >
          Disconnect
        </button>
      </div>

      <div className={`text-body-secondary ${styles.status}`}>
        Status: <strong>{status?.status ?? "—"}</strong>
        {status?.exit_code !== undefined && status?.exit_code !== null ? (
          <span> · exit {status.exit_code}</span>
        ) : null}
        {error ? <span className="text-danger"> · {error}</span> : null}
      </div>

      <div className={styles.logBox}>
        {lines.length === 0 ? (
          <div className="text-body-tertiary">No log output yet.</div>
        ) : (
          lines.map((line, idx) => <AnsiLine key={idx} line={line} />)
        )}
        <div ref={tailRef} />
      </div>
    </section>
  );
}
