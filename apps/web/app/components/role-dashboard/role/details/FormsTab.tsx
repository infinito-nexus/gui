"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parse as yamlParse } from "yaml";
import {
  patchAppConfigField,
  readAppConfig,
} from "../../../../lib/app-config-api";
import styles from "../../styles";
import type { FormField, Role } from "../../types";

type Props = {
  role: Role;
  workspaceId: string | null;
  alias: string | null;
};

type RowState = {
  value: unknown;
  hasOverride: boolean;
  pending: boolean;
  error: string | null;
};

const PATCH_DEBOUNCE_MS = 300;

function getAtPath(root: unknown, path: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function fieldKey(path: string[]): string {
  return path.join("/");
}

function parseInventoryFragment(yamlContent: string, roleId: string): unknown {
  if (!yamlContent.trim()) return null;
  let parsed: unknown;
  try {
    parsed = yamlParse(yamlContent);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  // Backend's _dump_yaml_fragment returns the role section directly.
  // We accept the deeper applications.<role> shape too as a fallback.
  const apps = (parsed as { applications?: Record<string, unknown> }).applications;
  if (apps && typeof apps === "object" && roleId in apps) {
    return apps[roleId];
  }
  return parsed;
}

function inputForType(
  field: FormField,
  state: RowState,
  pending: boolean,
  onChange: (next: unknown) => void,
): JSX.Element {
  const common = {
    disabled: pending,
    className: `form-control ${styles.formsTabRowInput}`,
  };
  switch (field.type) {
    case "boolean":
      return (
        <label>
          <input
            type="checkbox"
            checked={Boolean(state.value)}
            disabled={pending}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>{state.value ? "true" : "false"}</span>
        </label>
      );
    case "integer":
    case "float":
      return (
        <input
          {...common}
          type="number"
          step={field.type === "integer" ? 1 : "any"}
          value={String(state.value ?? "")}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
              return;
            }
            const parsed = field.type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
            onChange(Number.isNaN(parsed) ? raw : parsed);
          }}
        />
      );
    case "password":
      return (
        <input
          {...common}
          type="password"
          autoComplete="new-password"
          value={String(state.value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "text":
      return (
        <textarea
          {...common}
          rows={3}
          value={String(state.value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "list":
      return (
        <input
          {...common}
          value={Array.isArray(state.value) ? (state.value as unknown[]).join(", ") : ""}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="comma, separated, list"
        />
      );
    case "mapping":
      return (
        <span className={styles.formsTabHint}>
          Nested mappings render their leaves as separate rows.
        </span>
      );
    case "string":
    default:
      if (field.enum && field.enum.length > 0) {
        return (
          <select
            {...common}
            value={String(state.value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.enum.map((opt) => (
              <option key={String(opt)} value={String(opt)}>
                {String(opt)}
              </option>
            ))}
          </select>
        );
      }
      return (
        <input
          {...common}
          type="text"
          value={String(state.value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export default function RoleDetailsFormsTab({ role, workspaceId, alias }: Props) {
  const fields: FormField[] = useMemo(
    () => (role.form_fields ?? []).filter((f) => f.type !== "mapping"),
    [role.form_fields],
  );

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Initialise state with role defaults; refine with inventory.
  useEffect(() => {
    const initial: Record<string, RowState> = {};
    for (const field of fields) {
      initial[fieldKey(field.path)] = {
        value: field.default ?? null,
        hasOverride: false,
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
        const inventory = parseInventoryFragment(res.content, role.id);
        if (!inventory) return;
        setRows((prev) => {
          const next = { ...prev };
          for (const field of fields) {
            const override = getAtPath(inventory, field.path);
            if (override !== undefined) {
              next[fieldKey(field.path)] = {
                value: override,
                hasOverride: true,
                pending: false,
                error: null,
              };
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(`Failed to load inventory overrides: ${(err as Error).message}`);
      });
    return () => {
      alive = false;
      Object.values(debounceRef.current).forEach((t) => clearTimeout(t));
      debounceRef.current = {};
    };
  }, [fields, workspaceId, role.id, alias]);

  const persist = useCallback(
    async (field: FormField, value: unknown) => {
      const key = fieldKey(field.path);
      if (!workspaceId) {
        setRows((prev) => ({
          ...prev,
          [key]: { ...prev[key], pending: false, hasOverride: true },
        }));
        return;
      }
      try {
        await patchAppConfigField({
          workspaceId,
          roleId: role.id,
          alias,
          path: field.path,
          value,
        });
        setRows((prev) => ({
          ...prev,
          [key]: {
            ...prev[key],
            value,
            hasOverride: true,
            pending: false,
            error: null,
          },
        }));
        setLastSyncedAt(Date.now());
      } catch (err) {
        setRows((prev) => ({
          ...prev,
          [key]: { ...prev[key], pending: false, error: (err as Error).message },
        }));
      }
    },
    [workspaceId, role.id, alias],
  );

  const handleChange = useCallback(
    (field: FormField, next: unknown) => {
      const key = fieldKey(field.path);
      setRows((prev) => ({
        ...prev,
        [key]: { ...prev[key], value: next, pending: true, error: null },
      }));
      const existing = debounceRef.current[key];
      if (existing) clearTimeout(existing);
      debounceRef.current[key] = setTimeout(() => {
        void persist(field, next);
      }, PATCH_DEBOUNCE_MS);
    },
    [persist],
  );

  const handleReset = useCallback(
    async (field: FormField) => {
      const key = fieldKey(field.path);
      const existing = debounceRef.current[key];
      if (existing) clearTimeout(existing);
      setRows((prev) => ({
        ...prev,
        [key]: { ...prev[key], pending: true, error: null },
      }));
      if (!workspaceId) {
        setRows((prev) => ({
          ...prev,
          [key]: {
            value: field.default ?? null,
            hasOverride: false,
            pending: false,
            error: null,
          },
        }));
        return;
      }
      try {
        await patchAppConfigField({
          workspaceId,
          roleId: role.id,
          alias,
          path: field.path,
          delete: true,
        });
        setRows((prev) => ({
          ...prev,
          [key]: {
            value: field.default ?? null,
            hasOverride: false,
            pending: false,
            error: null,
          },
        }));
        setLastSyncedAt(Date.now());
      } catch (err) {
        setRows((prev) => ({
          ...prev,
          [key]: { ...prev[key], pending: false, error: (err as Error).message },
        }));
      }
    },
    [workspaceId, role.id, alias],
  );

  if (fields.length === 0) {
    return (
      <div className={styles.formsEmpty}>
        This app has no user-configurable fields. Internal app-config (image,
        ports, dependencies) is managed by the role itself.
      </div>
    );
  }

  return (
    <div className={styles.formsTabBody}>
      {loadError ? (
        <div className={`text-warning ${styles.formsTabHint}`}>{loadError}</div>
      ) : null}
      {fields.map((field) => {
        const key = fieldKey(field.path);
        const state = rows[key] ?? {
          value: field.default ?? null,
          hasOverride: false,
          pending: false,
          error: null,
        };
        return (
          <div key={key} className={styles.formsTabRow}>
            <div className={styles.formsTabRowLabel}>
              <span className={styles.formsTabRowName}>{field.label}</span>
              {field.description ? (
                <span className={styles.formsTabRowDescription}>
                  {field.description}
                </span>
              ) : null}
              <span
                className={`${styles.formsTabRowIndicator} ${
                  state.hasOverride
                    ? styles.formsTabRowIndicatorSet
                    : styles.formsTabRowIndicatorDefault
                }`}
              >
                {state.hasOverride ? "set" : "default"}
              </span>
            </div>
            <div>
              {inputForType(field, state, state.pending, (next) =>
                handleChange(field, next),
              )}
              {state.error ? (
                <span className={`text-danger ${styles.formsTabHint}`}>
                  {state.error}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className={styles.formsTabRowReset}
              onClick={() => handleReset(field)}
              disabled={!state.hasOverride || state.pending}
            >
              Reset to default
            </button>
          </div>
        );
      })}
      {lastSyncedAt ? (
        <div className={styles.formsTabFooter}>
          synced {Math.max(0, Math.round((Date.now() - lastSyncedAt) / 1000))}s ago
        </div>
      ) : null}
    </div>
  );
}
