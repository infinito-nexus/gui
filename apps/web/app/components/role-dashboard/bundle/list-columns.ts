export const BUNDLE_LIST_COLUMN_GAP_PX = 12;

export type BundleOptionalListColumnKey =
  | "target"
  | "description"
  | "apps"
  | "price"
  | "details";

export type BundleListColumnKey = "bundle" | BundleOptionalListColumnKey | "enabled";

export const BUNDLE_LIST_COLUMN_ORDER: BundleListColumnKey[] = [
  "bundle",
  "target",
  "description",
  "apps",
  "price",
  "details",
  "enabled",
];

export const BUNDLE_OPTIONAL_LIST_COLUMNS: BundleOptionalListColumnKey[] = [
  "target",
  "description",
  "apps",
  "price",
  "details",
];

export const BUNDLE_LIST_COLUMN_LABEL: Record<BundleListColumnKey, string> = {
  bundle: "Bundle",
  target: "Target",
  description: "Description",
  apps: "Apps",
  price: "Price",
  details: "Details",
  enabled: "Enabled",
};

export const BUNDLE_LIST_COLUMN_TEMPLATE: Record<BundleListColumnKey, string> = {
  bundle: "minmax(210px, 1.35fr)",
  target: "minmax(94px, 0.72fr)",
  description: "minmax(200px, 1.45fr)",
  apps: "minmax(258px, 1.9fr)",
  price: "minmax(94px, 0.68fr)",
  details: "minmax(108px, 0.72fr)",
  enabled: "minmax(132px, 0.95fr)",
};

export const BUNDLE_LIST_COLUMN_MIN_WIDTH: Record<BundleListColumnKey, number> = {
  bundle: 210,
  target: 94,
  description: 200,
  apps: 258,
  price: 94,
  details: 108,
  enabled: 132,
};
