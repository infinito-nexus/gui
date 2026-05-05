"use client";

import { useCallback } from "react";
import styles from "./styles.module.css";
import type { StatusIndicator, ValidationState } from "./server-collection/View.types";
import {
  getValidationState as buildValidationState,
  hasFormIssues,
} from "./server-collection/View.utils";
import type { ServerState } from "./types";

type UseServerCollectionValidationProps = {
  aliasCounts: Record<string, number>;
  aliasDrafts: Record<string, string>;
  passwordConfirmDrafts: Record<string, string>;
  primaryDomainByLower: Map<string, string>;
};

export function useServerCollectionValidation({
  aliasCounts,
  aliasDrafts,
  passwordConfirmDrafts,
  primaryDomainByLower,
}: UseServerCollectionValidationProps) {
  const getValidationState = useCallback(
    (
      server: ServerState,
      options?: { enforcePasswordConfirm?: boolean }
    ): ValidationState => {
      const aliasDraft = String(aliasDrafts[server.alias] ?? server.alias).trim();
      const passwordConfirmDraft = String(passwordConfirmDrafts[server.alias] ?? "");
      return buildValidationState(server, {
        aliasDraft,
        aliasCounts,
        primaryDomainByLower,
        passwordConfirmDraft,
        enforcePasswordConfirm: Boolean(options?.enforcePasswordConfirm),
      });
    },
    [aliasDrafts, aliasCounts, passwordConfirmDrafts, primaryDomainByLower]
  );

  const getVisualState = useCallback(
    (validation: ValidationState, indicator: StatusIndicator) => {
      if (validation.credentialsMissing || hasFormIssues(validation)) {
        return {
          cardClass: styles.cardStateDanger,
          rowClass: styles.rowStateDanger,
        };
      }
      if (indicator.tone === "green") {
        return {
          cardClass: styles.cardStateSuccess,
          rowClass: styles.rowStateSuccess,
        };
      }
      return {
        cardClass: styles.cardStateWarning,
        rowClass: styles.rowStateWarning,
      };
    },
    []
  );

  const statusDotClass = useCallback((tone: StatusIndicator["tone"]) => {
    if (tone === "green") return styles.statusDotGreen;
    if (tone === "yellow") return styles.statusDotYellow;
    return styles.statusDotOrange;
  }, []);

  return {
    getValidationState,
    getVisualState,
    statusDotClass,
  };
}
