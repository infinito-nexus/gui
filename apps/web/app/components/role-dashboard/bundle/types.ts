// Re-exports the parent's role-dashboard types so callers inside
// `bundle/` can keep using `./types` without disambiguating between
// bundle-specific and parent types.
export * from "../types";

import type { BundleAppListRow } from "./AppList";
import type { Bundle } from "../types";

export type BundleState = {
  enabled: boolean;
  selectedCount: number;
  totalCount: number;
};

export type BundleEntry = {
  bundle: Bundle;
  roleIds: string[];
  roleRows: BundleAppListRow[];
  totalPriceLabel: string;
  state: BundleState;
};
