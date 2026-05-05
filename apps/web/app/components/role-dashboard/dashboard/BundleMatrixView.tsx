import type { CSSProperties } from "react";
import EnableDropdown from "../EnableDropdown";
import type { Bundle } from "../types";
import styles from "../../RoleDashboard.module.css";

type BundleSelectionState = {
  enabled: boolean;
  selectedCount: number;
  totalCount: number;
};

type RoleDashboardBundleMatrixViewProps = {
  matrixAliases: string[];
  matrixColumnStyleByAlias: Record<string, CSSProperties>;
  serverMetaByAlias?: Record<string, { logoEmoji?: string | null; color?: string | null }>;
  paginatedBundles: Bundle[];
  bundleRoleCountById: Record<string, number>;
  bundleStateByAlias: Record<string, Record<string, BundleSelectionState>>;
  canToggleAliasBundle: (alias: string) => boolean;
  onEnableBundleForAlias: (bundle: Bundle, alias: string) => void;
  onDisableBundleForAlias: (bundle: Bundle, alias: string) => void;
};

export default function RoleDashboardBundleMatrixView({
  matrixAliases,
  matrixColumnStyleByAlias,
  serverMetaByAlias,
  paginatedBundles,
  bundleRoleCountById,
  bundleStateByAlias,
  canToggleAliasBundle,
  onEnableBundleForAlias,
  onDisableBundleForAlias,
}: RoleDashboardBundleMatrixViewProps) {
  if (matrixAliases.length === 0) {
    return (
      <div className={`text-body-secondary ${styles.matrixEmpty}`}>
        Add at least one device to use bundle matrix selection.
      </div>
    );
  }

  return (
    <div className={styles.matrixContainer}>
      <table className={styles.matrixTable}>
        <thead>
          <tr>
            <th>Bundle</th>
            {matrixAliases.map((alias) => (
              <th
                key={alias}
                className={styles.matrixAliasColumnHead}
                style={matrixColumnStyleByAlias[alias]}
              >
                <span className={styles.matrixAliasHead}>
                  <span aria-hidden="true">{serverMetaByAlias?.[alias]?.logoEmoji || "💻"}</span>
                  <span className={styles.matrixAliasName} title={alias}>
                    {alias}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedBundles.map((bundle) => (
            <tr key={bundle.id}>
              <th className={styles.matrixRoleCell}>
                <div className={styles.matrixRoleInner}>
                  <span className={styles.matrixBundleIcon} aria-hidden="true">
                    <i className={String(bundle.logo_class || "fa-solid fa-layer-group")} />
                  </span>
                  <div className={styles.matrixRoleText}>
                    <span className={styles.matrixRoleName}>{bundle.title}</span>
                    <span className={styles.matrixRoleId}>
                      {(bundle.deploy_target || "bundle").trim() || "bundle"} ·{" "}
                      {bundleRoleCountById[bundle.id] || 0} apps
                    </span>
                  </div>
                </div>
              </th>
              {matrixAliases.map((alias) => {
                const bundleState = bundleStateByAlias[alias]?.[bundle.id];
                const totalCount = bundleState?.totalCount ?? bundleRoleCountById[bundle.id] ?? 0;
                const selectedCount = bundleState?.selectedCount ?? 0;
                const enabled = Boolean(bundleState?.enabled);
                const selectable = canToggleAliasBundle(alias);
                const partiallyEnabled =
                  totalCount > 0 && selectedCount > 0 && selectedCount < totalCount;
                const partialTooltip = `Partially enabled on "${alias}": ${selectedCount}/${totalCount} apps active. Click to enable full bundle.`;
                return (
                  <td
                    key={`${alias}:${bundle.id}`}
                    className={styles.matrixAliasColumnCell}
                    style={matrixColumnStyleByAlias[alias]}
                  >
                    <div className={styles.matrixCellActions}>
                      {partiallyEnabled ? (
                        <button
                          type="button"
                          className={styles.matrixPartialButton}
                          title={partialTooltip}
                          disabled={!selectable}
                          onClick={() => onEnableBundleForAlias(bundle, alias)}
                        >
                          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                          <span>Partial</span>
                        </button>
                      ) : (
                        <EnableDropdown
                          enabled={enabled}
                          disabled={!selectable || totalCount === 0}
                          compact
                          showPlanField={false}
                          pricingModel="bundle"
                          plans={[{ id: "community", label: "Community" }]}
                          selectedPlanId="community"
                          appCount={Math.max(1, totalCount)}
                          contextLabel={`device "${alias}" for bundle "${bundle.title}"`}
                          onEnable={() => onEnableBundleForAlias(bundle, alias)}
                          onDisable={() => onDisableBundleForAlias(bundle, alias)}
                        />
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
