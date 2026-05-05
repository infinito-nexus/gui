import type { CSSProperties } from "react";

import { hexToRgba, normalizeDeviceColor, normalizeDeviceEmoji } from "../device-visuals";
import type { ConnectionResult, ServerState } from "../types";
import type { StatusIndicator, ValidationState } from "./View.types";

export const ALIAS_PATTERN = /^[a-z0-9_-]+$/;
export const MOTION_LOOP_SEGMENTS = [0, 1, 2] as const;

export function buildMotionLanes(
  servers: ServerState[],
  laneCount: number
): ServerState[][] {
  const safeLaneCount = Math.max(1, Math.floor(Number(laneCount) || 1));
  const lanes = Array.from({ length: safeLaneCount }, () => [] as ServerState[]);
  servers.forEach((server, index) => {
    lanes[index % safeLaneCount].push(server);
  });
  if (servers.length > 0) {
    lanes.forEach((lane, laneIndex) => {
      if (lane.length === 0) {
        lane.push(servers[laneIndex % servers.length]);
      }
    });
  }
  return lanes;
}

export function getAliasErrorFor(
  aliasValue: string,
  currentAlias: string,
  aliasCounts: Record<string, number>
): string | null {
  if (!aliasValue) return "Alias is required.";
  if (!ALIAS_PATTERN.test(aliasValue)) {
    return "Alias allows only a-z, 0-9, _ and -.";
  }
  const duplicateCount = aliasCounts[aliasValue] ?? 0;
  const duplicates = aliasValue === currentAlias ? duplicateCount > 1 : duplicateCount > 0;
  if (duplicates) return "Alias already exists.";
  return null;
}

export function getPortError(portValue: string): string | null {
  const value = String(portValue ?? "").trim();
  if (!value) return "Port is required.";
  if (!/^\d+$/.test(value)) return "Port must be an integer.";
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65535) return "Port must be between 1 and 65535.";
  return null;
}

export function getPrimaryDomainError(
  primaryDomainValue: string,
  primaryDomainByLower: Map<string, string>
): string | null {
  const normalized = String(primaryDomainValue || "").trim().toLowerCase();
  if (!normalized) return "Primary domain is required.";
  if (!primaryDomainByLower.has(normalized)) {
    return "Choose a domain from the list or add a new one.";
  }
  return null;
}

export function getPasswordConfirmError(
  server: ServerState,
  passwordConfirmDraft: string,
  enforcePasswordConfirm: boolean
): string | null {
  if (!enforcePasswordConfirm) return null;
  if (server.authMethod !== "password") return null;
  const password = String(server.password || "");
  if (!password) return null;
  const confirm = String(passwordConfirmDraft || "");
  if (!confirm) return "Please confirm the password.";
  if (confirm !== password) return "Passwords do not match.";
  return null;
}

export function normalizePortValue(
  value: string | number | null | undefined
): string {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isInteger(parsed)) return "";
  return String(Math.min(65535, Math.max(1, parsed)));
}

export function getColorError(colorValue: string): string | null {
  const normalized = normalizeDeviceColor(colorValue);
  if (!normalized) return "Color must be a HEX value (e.g. #87CEEB).";
  return null;
}

export function getLogoError(logoValue: string): string | null {
  const normalized = normalizeDeviceEmoji(logoValue);
  if (!normalized) return "Logo emoji is required.";
  return null;
}

export function hasCredentials(server: ServerState): boolean {
  if (server.authMethod === "private_key") {
    return Boolean(String(server.privateKey || "").trim());
  }
  return Boolean(String(server.password || "").trim());
}

export function getValidationState(
  server: ServerState,
  options: {
    aliasDraft: string;
    aliasCounts: Record<string, number>;
    primaryDomainByLower: Map<string, string>;
    passwordConfirmDraft?: string;
    enforcePasswordConfirm?: boolean;
  }
): ValidationState {
  const aliasError = getAliasErrorFor(
    String(options.aliasDraft || "").trim(),
    server.alias,
    options.aliasCounts
  );
  const passwordConfirmError = getPasswordConfirmError(
    server,
    options.passwordConfirmDraft || "",
    Boolean(options.enforcePasswordConfirm)
  );
  return {
    aliasError,
    hostMissing: !String(server.host || "").trim(),
    userMissing: !String(server.user || "").trim(),
    portError: getPortError(server.port),
    primaryDomainError: getPrimaryDomainError(
      server.primaryDomain,
      options.primaryDomainByLower
    ),
    colorError: getColorError(server.color),
    logoMissing: Boolean(getLogoError(server.logoEmoji)),
    credentialsMissing: !hasCredentials(server),
    passwordConfirmError,
  };
}

export function hasFormIssues(validation: ValidationState): boolean {
  return Boolean(
    validation.aliasError ||
      validation.hostMissing ||
      validation.userMissing ||
      validation.portError ||
      validation.primaryDomainError ||
      validation.colorError ||
      validation.logoMissing ||
      validation.passwordConfirmError
  );
}

export function getStatusIndicator(
  validation: ValidationState,
  status: ConnectionResult | undefined
): StatusIndicator {
  if (validation.credentialsMissing) {
    return {
      tone: "orange",
      label: "Missing credentials",
      tooltip:
        "No credentials configured. Set a password or private key before testing.",
      missingCredentials: true,
    };
  }

  if (hasFormIssues(validation)) {
    return {
      tone: "orange",
      label: "Invalid configuration",
      tooltip: "Fix alias, host, user, port, primary domain, color and logo fields first.",
      missingCredentials: false,
    };
  }

  if (!status) {
    return {
      tone: "yellow",
      label: "Not tested",
      tooltip: "No connection test result yet.",
      missingCredentials: false,
    };
  }

  if (status.ping_ok && status.ssh_ok) {
    return {
      tone: "green",
      label: "Reachable",
      tooltip: "Ping and SSH checks succeeded.",
      missingCredentials: false,
    };
  }

  const details: string[] = [];
  if (!status.ping_ok) {
    details.push(status.ping_error?.trim() || "Ping check failed.");
  }
  if (!status.ssh_ok) {
    details.push(status.ssh_error?.trim() || "SSH check failed.");
  }

  return {
    tone: "orange",
    label: !status.ping_ok ? "Ping failed" : "Connection failed",
    tooltip: details.join(" ") || "Connection test failed.",
    missingCredentials: false,
  };
}

export function getTintStyle(
  colorValue: string,
  tintable: boolean
): CSSProperties | undefined {
  if (!tintable) return undefined;
  const background = hexToRgba(colorValue, 0.16);
  const border = hexToRgba(colorValue, 0.58);
  const status = hexToRgba(colorValue, 0.22);
  if (!background && !border) return undefined;
  return {
    ...(background
      ? { "--device-row-bg": background, "--device-card-bg": background }
      : {}),
    ...(border
      ? {
          "--device-row-border": border,
          "--device-card-border": border,
        }
      : {}),
    ...(status ? { "--device-status-bg": status } : {}),
  } as CSSProperties;
}
