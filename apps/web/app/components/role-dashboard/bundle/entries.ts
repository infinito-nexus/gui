import { formatMonthlyPrice } from "../formatting";
import type { Bundle, Role } from "./types";
import type { BundleEntry, BundleState } from "./types";

export function buildBundleEntries(
  bundles: Bundle[],
  bundleStates: Record<string, BundleState>,
  roleById: Record<string, Role>,
  roleServerCountByRole?: Record<string, number>
): BundleEntry[] {
  return bundles.map((bundle) => {
    const roleIds = (Array.isArray(bundle.role_ids) ? bundle.role_ids : [])
      .map((roleId) => String(roleId || "").trim())
      .filter(Boolean);
    const roleRows = roleIds.map((roleId) => {
      const role = roleById[roleId] || null;
      const rawServerCount = Math.max(
        0,
        Math.floor(Number(roleServerCountByRole?.[roleId] || 0))
      );
      const monthlyPriceAmount = Math.max(1, rawServerCount);
      return {
        roleId,
        role,
        label: String(role?.display_name || roleId).trim(),
        monthlyPriceAmount,
        monthlyPriceLabel: formatMonthlyPrice(monthlyPriceAmount),
        isActive: rawServerCount > 0,
      };
    });
    const state = bundleStates[bundle.id] || {
      enabled: false,
      selectedCount: 0,
      totalCount: roleIds.length,
    };
    const totalPriceAmount = roleRows.reduce((sum, row) => sum + row.monthlyPriceAmount, 0);
    return {
      bundle,
      roleIds,
      roleRows,
      totalPriceLabel: formatMonthlyPrice(totalPriceAmount),
      state,
    };
  });
}
