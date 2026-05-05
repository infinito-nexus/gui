import type { CSSProperties } from "react";
import type { Bundle } from "./types";

type BundleLogoStyleMap = Record<string, string | undefined>;

function bundleIconClass(bundle: Bundle): string {
  const raw = String(bundle.logo_class || "").trim();
  return raw || "fa-solid fa-layer-group";
}

export function bundleLogo(
  bundle: Bundle,
  size: number,
  styleMap: BundleLogoStyleMap,
  className?: string
) {
  const logoSizeStyle = {
    "--role-logo-size": `${size}px`,
    "--role-logo-meta-size": `${Math.max(20, Math.floor(size * 0.82))}px`,
    "--role-logo-initial-size": `${Math.max(14, Math.floor(size * 0.32))}px`,
  } as CSSProperties;

  const logoRootClass = styleMap.logoRoot || "";
  const logoMetaIconClass = styleMap.logoMetaIcon || "";
  const rootClassName = className ? `${logoRootClass} ${className}` : logoRootClass;

  return (
    <div className={rootClassName} style={logoSizeStyle}>
      <i className={`${bundleIconClass(bundle)} ${logoMetaIconClass}`} aria-hidden="true" />
    </div>
  );
}

export function targetStatusStyle(target: string): CSSProperties {
  const normalized = String(target || "").trim().toLowerCase();
  if (normalized === "server") {
    return {
      "--status-bg": "var(--bs-info-bg-subtle)",
      "--status-fg": "var(--bs-info-text-emphasis)",
      "--status-border": "var(--bs-info-border-subtle)",
    } as CSSProperties;
  }
  if (normalized === "workstation") {
    return {
      "--status-bg": "var(--bs-success-bg-subtle)",
      "--status-fg": "var(--bs-success-text-emphasis)",
      "--status-border": "var(--bs-success-border-subtle)",
    } as CSSProperties;
  }
  return {
    "--status-bg": "var(--bs-secondary-bg-subtle)",
    "--status-fg": "var(--bs-secondary-text-emphasis)",
    "--status-border": "var(--bs-secondary-border-subtle)",
  } as CSSProperties;
}
