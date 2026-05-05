"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { quickLinksForRole, toEmbedUrl } from "../helpers";
import styles from "../styles";
import type { Role } from "../types";

type RoleQuickLinksProps = {
  role: Role;
  onOpenVideo: (url: string, title: string) => void;
  maxVisible?: number;
  adaptiveOverflow?: boolean;
};

export default function RoleQuickLinks({
  role,
  onOpenVideo,
  maxVisible,
  adaptiveOverflow = false,
}: RoleQuickLinksProps) {
  const quickLinks = quickLinksForRole(role);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [adaptiveLimit, setAdaptiveLimit] = useState<number | null>(null);

  useEffect(() => {
    if (!adaptiveOverflow) {
      setAdaptiveLimit(null);
      return;
    }
    const row = rowRef.current;
    if (!row) return;

    const SLOT_WIDTH = 28;
    const SLOT_GAP = 6;
    const OVERFLOW_WIDTH = 28;

    const measure = () => {
      const rowWidth = Math.max(0, row.clientWidth);
      if (rowWidth <= 0) {
        setAdaptiveLimit(0);
        return;
      }
      const total = quickLinks.length;
      if (total <= 0) {
        setAdaptiveLimit(0);
        return;
      }
      const totalWidth = total * SLOT_WIDTH + Math.max(0, total - 1) * SLOT_GAP;
      if (totalWidth <= rowWidth) {
        setAdaptiveLimit(total);
        return;
      }
      let visible = 0;
      for (let idx = 0; idx < total; idx += 1) {
        const nextVisible = idx + 1;
        const nextWidth =
          nextVisible * SLOT_WIDTH + nextVisible * SLOT_GAP + OVERFLOW_WIDTH;
        if (nextWidth <= rowWidth) {
          visible = nextVisible;
        } else {
          break;
        }
      }
      setAdaptiveLimit(visible);
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    return () => observer.disconnect();
  }, [adaptiveOverflow, quickLinks.length]);

  const staticLimit = Number.isFinite(maxVisible)
    ? Math.max(0, Number(maxVisible))
    : quickLinks.length;
  const computedLimit = useMemo(() => {
    if (adaptiveLimit === null) return staticLimit;
    return Math.min(staticLimit, adaptiveLimit);
  }, [adaptiveLimit, staticLimit]);
  const visible = quickLinks.slice(0, computedLimit);
  const hiddenCount = Math.max(0, quickLinks.length - visible.length);
  if (quickLinks.length === 0) return null;

  return (
    <div ref={rowRef} className={styles.quickLinksInline}>
      {visible.map((link) =>
        link.type === "video" ? (
          <button
            key={link.key}
            onClick={() =>
              onOpenVideo(toEmbedUrl(link.url || ""), `${role.display_name} video`)
            }
            title={link.label}
            aria-label={link.label}
            className={`${styles.quickLinkControl} ${styles.quickLinkButton}`}
          >
            <i className={`${link.iconClass} ${styles.quickLinkIcon}`} aria-hidden="true" />
          </button>
        ) : (
          <a
            key={link.key}
            href={link.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            title={link.label}
            aria-label={link.label}
            className={`${styles.quickLinkControl} ${styles.quickLinkAnchor}`}
          >
            <i className={`${link.iconClass} ${styles.quickLinkIcon}`} aria-hidden="true" />
          </a>
        )
      )}
      {hiddenCount > 0 ? (
        <span
          className={styles.quickLinkOverflow}
          title={`+${hiddenCount} more`}
          aria-label={`${hiddenCount} more links`}
        >
          ...
        </span>
      ) : null}
    </div>
  );
}
