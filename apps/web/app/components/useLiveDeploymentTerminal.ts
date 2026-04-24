"use client";

import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";

type LiveDeploymentTerminalOptions = {
  compact: boolean;
  fill: boolean;
  hideControls: boolean;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  termRef: MutableRefObject<XTermTerminal | null>;
  fitRef: MutableRefObject<XTermFitAddon | null>;
  flushPendingLines: () => void;
  writeTerminalBanner: () => void;
};

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

export function useLiveDeploymentTerminal({
  compact,
  fill,
  hideControls,
  containerRef,
  termRef,
  fitRef,
  flushPendingLines,
  writeTerminalBanner,
}: LiveDeploymentTerminalOptions) {
  useEffect(() => {
    let disposed = false;
    let onResize: (() => void) | null = null;
    let onSchemeChange: (() => void) | null = null;
    let mediaQuery: MediaQueryList | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const readCssVar = (name: string, fallback: string) => {
      if (typeof window === "undefined") {
        return fallback;
      }
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
      if (!containerRef.current) {
        return;
      }
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) {
        return;
      }

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
          term.options.theme = buildTheme();
          term.refresh(0, Math.max(0, term.rows - 1));
        };
        const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
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
      if (onResize) {
        window.removeEventListener("resize", onResize);
      }
      if (mediaQuery && onSchemeChange) {
        const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
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
  }, [containerRef, fitRef, flushPendingLines, termRef, writeTerminalBanner]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      fitRef.current?.fit();
    });
  }, [compact, fill, hideControls, fitRef]);
}
