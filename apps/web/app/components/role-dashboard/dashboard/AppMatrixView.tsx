import type { CSSProperties } from "react";
import EnableDropdown from "../EnableDropdown";
import RoleLogoView from "../role/LogoView";
import type { Role } from "../types";
import styles from "../../RoleDashboard.module.css";

type RoleDashboardAppMatrixViewProps = {
  matrixAliases: string[];
  matrixColumnStyleByAlias: Record<string, CSSProperties>;
  serverMetaByAlias?: Record<string, { logoEmoji?: string | null; color?: string | null }>;
  paginatedRoles: Role[];
  selectedLookup: Record<string, Set<string>>;
  canToggleAliasRole: (alias: string) => boolean;
  rolePlanOptions: Record<string, { id: string; label: string }[]>;
  selectedPlanLookup: Record<string, Record<string, string | null>>;
  onSelectPlanByAlias: (alias: string, roleId: string, planId: string | null) => void;
  onToggleSelectedByAlias: (alias: string, roleId: string) => void;
  baseUrl?: string;
};

export default function RoleDashboardAppMatrixView({
  matrixAliases,
  matrixColumnStyleByAlias,
  serverMetaByAlias,
  paginatedRoles,
  selectedLookup,
  canToggleAliasRole,
  rolePlanOptions,
  selectedPlanLookup,
  onSelectPlanByAlias,
  onToggleSelectedByAlias,
  baseUrl,
}: RoleDashboardAppMatrixViewProps) {
  if (matrixAliases.length === 0) {
    return (
      <div className={`text-body-secondary ${styles.matrixEmpty}`}>
        Add at least one device to use matrix selection.
      </div>
    );
  }

  return (
    <div className={styles.matrixContainer}>
      <table className={styles.matrixTable}>
        <thead>
          <tr>
            <th>App</th>
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
          {paginatedRoles.map((role) => (
            <tr key={role.id}>
              <th className={styles.matrixRoleCell}>
                <div className={styles.matrixRoleInner}>
                  <RoleLogoView role={role} size={28} />
                  <div className={styles.matrixRoleText}>
                    <span className={styles.matrixRoleName}>{role.display_name}</span>
                  </div>
                </div>
              </th>
              {matrixAliases.map((alias) => {
                const selectedState = Boolean(selectedLookup[alias]?.has(role.id));
                const selectable = canToggleAliasRole(alias);
                return (
                  <td
                    key={`${alias}:${role.id}`}
                    className={styles.matrixAliasColumnCell}
                    style={matrixColumnStyleByAlias[alias]}
                  >
                    <div className={styles.matrixCellActions}>
                      <EnableDropdown
                        enabled={selectedState}
                        disabled={!selectable}
                        compact
                        pricingModel="app"
                        plans={rolePlanOptions[role.id]}
                        selectedPlanId={selectedPlanLookup[alias]?.[role.id] ?? null}
                        onSelectPlan={(planId) => onSelectPlanByAlias(alias, role.id, planId)}
                        roleId={role.id}
                        pricing={role.pricing || null}
                        pricingSummary={role.pricing_summary || null}
                        baseUrl={baseUrl}
                        serverCount={selectedState ? 1 : 0}
                        appCount={1}
                        onEnable={() => {
                          if (!selectedState) {
                            onToggleSelectedByAlias(alias, role.id);
                          }
                        }}
                        onDisable={() => {
                          if (selectedState) {
                            onToggleSelectedByAlias(alias, role.id);
                          }
                        }}
                      />
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
