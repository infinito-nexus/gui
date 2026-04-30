"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parse as yamlParse } from "yaml";
import {
  patchAppConfigField,
  readAppConfig,
} from "../../lib/app-config-api";
import styles from "./styles";
import type { Role, ServiceLink } from "./types";

type Props = {
  role: Role;
  workspaceId: string | null;
  alias: string | null;
};

type RowState = {
  enabled: boolean;
  pending: boolean;
  error: string | null;
};

// Walks a parsed YAML mapping looking for
//   applications.<role-id>.services.<service-key>.enabled
// and returns a flat map of service-key -> bool. Falls back to
// `null` when a key is not overridden so the caller can use the
// role's default.
function extractServiceOverrides(
  yamlContent: string,
  roleId: string,
): Record<string, boolean> {
  if (!yamlContent.trim()) return {};
  let parsed: unknown;
  try {
    parsed = yamlParse(yamlContent);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  // The host_vars endpoint returns the role's section directly
  // (i.e. just applications.<role>.{...}) — see _dump_yaml_fragment.
  const services = (root as { services?: unknown }).services;
  if (!services || typeof services !== "object") {
    // Try the deeper shape too in case the API ever returns the
    // full host_vars file.
    const apps = (root as { applications?: Record<string, unknown> }).applications;
    if (apps && typeof apps === "object") {
      const node = apps[roleId];
      if (node && typeof node === "object") {
        return extractServiceOverrides(JSON.stringify(node), roleId);
      }
    }
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(services as Record<string, unknown>)) {
    if (value && typeof value === "object" && "enabled" in (value as object)) {
      const enabled = (value as Record<string, unknown>).enabled;
      if (typeof enabled === "boolean") {
        out[key] = enabled;
      }
    }
  }
  return out;
}

export default function RoleDetailsServicesTab({ role, workspaceId, alias }: Props) {
  const links: ServiceLink[] = useMemo(
    () => role.services_links ?? [],
    [role.services_links],
  );
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initialise from defaults; then refine with inventory overrides
  // when workspace context is known.
  useEffect(() => {
    const initial: Record<string, RowState> = {};
    for (const link of links) {
      initial[link.key] = {
        enabled: link.default_enabled,
        pending: false,
        error: null,
      };
    }
    setRows(initial);
    if (!workspaceId) return;
    let alive = true;
    setLoadError(null);
    readAppConfig(workspaceId, role.id, alias)
      .then((res) => {
        if (!alive) return;
        const overrides = extractServiceOverrides(res.content, role.id);
        setRows((prev) => {
          const next = { ...prev };
          for (const link of links) {
            if (link.key in overrides) {
              next[link.key] = {
                ...next[link.key],
                enabled: overrides[link.key],
              };
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(`Failed to load overrides: ${(err as Error).message}`);
      });
    return () => {
      alive = false;
    };
  }, [links, workspaceId, role.id, alias]);

  const toggle = useCallback(
    async (link: ServiceLink) => {
      const current = rows[link.key];
      if (!current || current.pending) return;
      const next = !current.enabled;
      setRows((prev) => ({
        ...prev,
        [link.key]: { enabled: next, pending: true, error: null },
      }));
      if (!workspaceId) {
        // No workspace context — local-only toggle (e.g. unauthenticated
        // anonymous browse). Surface visually but cannot persist.
        setRows((prev) => ({
          ...prev,
          [link.key]: { enabled: next, pending: false, error: null },
        }));
        return;
      }
      try {
        await patchAppConfigField({
          workspaceId,
          roleId: role.id,
          alias,
          path: ["services", link.key, "enabled"],
          value: next,
        });
        setRows((prev) => ({
          ...prev,
          [link.key]: { enabled: next, pending: false, error: null },
        }));
      } catch (err) {
        setRows((prev) => ({
          ...prev,
          [link.key]: {
            enabled: current.enabled,
            pending: false,
            error: (err as Error).message,
          },
        }));
      }
    },
    [rows, workspaceId, role.id, alias],
  );

  if (links.length === 0) {
    return (
      <div className={styles.formsEmpty}>
        This app has no integrated services.
      </div>
    );
  }

  return (
    <div className={styles.servicesTabBody}>
      {loadError ? (
        <div className={`text-warning ${styles.formsTabHint}`}>{loadError}</div>
      ) : null}
      <ul className={styles.servicesTabList}>
        {links.map((link) => {
          const row = rows[link.key];
          const checked = Boolean(row?.enabled);
          const pending = Boolean(row?.pending);
          return (
            <li key={link.key} className={styles.servicesTabRow}>
              <div className={styles.servicesTabRowMeta}>
                <span className={styles.servicesTabRowLabel}>
                  {link.key
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (m) => m.toUpperCase())}
                </span>
                {link.shared ? (
                  <span className={styles.servicesTabRowBadge}>shared</span>
                ) : null}
              </div>
              <label className={styles.servicesTabRowToggle}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending}
                  onChange={() => toggle(link)}
                />
                <span>{checked ? "Enabled" : "Disabled"}</span>
              </label>
              {row?.error ? (
                <span className={`text-danger ${styles.formsTabHint}`}>
                  {row.error}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
