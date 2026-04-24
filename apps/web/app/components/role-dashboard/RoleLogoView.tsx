"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { SIMPLEICON_CDN } from "./constants";
import { simpleIconCandidates } from "./helpers";
import styles from "./styles";
import type { Role } from "./types";

export default function RoleLogoView({
  role,
  size,
  className,
}: {
  role: Role;
  size: number;
  className?: string;
}) {
  const simpleIconUrls = useMemo(() => {
    const candidates = simpleIconCandidates(role.display_name, role.id);
    const urls = candidates.map((slug) => `${SIMPLEICON_CDN}/${slug}`);
    if (role.logo?.source === "simpleicons" && role.logo.url) {
      return [role.logo.url, ...urls.filter((url) => url !== role.logo?.url)];
    }
    return Array.from(new Set(urls));
  }, [role.display_name, role.id, role.logo?.source, role.logo?.url]);

  const [simpleIconSrc, setSimpleIconSrc] = useState<string | null>(null);
  const [simpleIconVisible, setSimpleIconVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    setSimpleIconSrc(null);
    setSimpleIconVisible(false);

    const tryLoad = (index: number) => {
      if (cancelled) return;
      if (index >= simpleIconUrls.length) return;
      const probe = new Image();
      probe.onload = () => {
        if (cancelled) return;
        setSimpleIconSrc(simpleIconUrls[index]);
        raf = window.requestAnimationFrame(() => {
          if (!cancelled) {
            setSimpleIconVisible(true);
          }
        });
      };
      probe.onerror = () => {
        if (!cancelled) {
          tryLoad(index + 1);
        }
      };
      probe.src = simpleIconUrls[index];
    };

    if (simpleIconUrls.length > 0) {
      tryLoad(0);
    }

    return () => {
      cancelled = true;
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [simpleIconUrls, role.id]);

  const fallbackMode: "meta" | "default" = useMemo(() => {
    if (role.logo?.css_class) return "meta";
    return "default";
  }, [role.logo?.css_class]);

  const logoSizeStyle = {
    "--role-logo-size": `${size}px`,
    "--role-logo-meta-size": `${Math.max(20, Math.floor(size * 0.82))}px`,
    "--role-logo-initial-size": `${Math.max(14, Math.floor(size * 0.32))}px`,
  } as CSSProperties;

  const rootClassName = className ? `${styles.logoRoot} ${className}` : styles.logoRoot;

  return (
    <div className={rootClassName} style={logoSizeStyle}>
      <div
        className={`${styles.logoFallbackLayer} ${
          simpleIconVisible ? styles.logoLayerHidden : styles.logoLayerVisible
        }`}
      >
        {fallbackMode === "meta" && role.logo?.css_class ? (
          <i
            className={`${role.logo.css_class} ${styles.logoMetaIcon}`}
            aria-hidden="true"
          />
        ) : null}
        {fallbackMode === "default" ? (
          <i className={`fa-solid fa-cube ${styles.logoMetaIcon}`} aria-hidden="true" />
        ) : null}
      </div>

      {simpleIconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={simpleIconSrc}
          alt={role.display_name}
          onError={() => {
            setSimpleIconVisible(false);
            setSimpleIconSrc(null);
          }}
          className={`${styles.logoImage} ${styles.logoSimpleIconLayer} ${
            simpleIconVisible ? styles.logoLayerVisible : styles.logoLayerHidden
          }`}
        />
      ) : null}
    </div>
  );
}
