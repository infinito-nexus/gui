import { SERVER_VIEW_MODES } from "../types";
import type { ServerViewMode } from "../types";
import type { ViewModeIconMap } from "./types";

export const SERVER_VIEW_ICONS: ViewModeIconMap = {
  detail: "fa-solid fa-table-cells-large",
  list: "fa-solid fa-list",
  mini: "fa-solid fa-border-all",
  matrix: "fa-solid fa-table",
  row: "fa-solid fa-grip-lines",
  column: "fa-solid fa-columns",
};

export const ROW_FILTER_OPTIONS: number[] = [1, 2, 3, 5, 10, 20, 100, 500, 1000];

export const HW_QUERY_KEYS = {
  view: "hw_view",
  rows: "hw_rows",
} as const;

export const DEFAULT_SERVER_VIEW_MODES: ServerViewMode[] = [
  "detail",
  "list",
  "mini",
  "matrix",
];

export const ANIMATED_SERVER_VIEW_MODES: ServerViewMode[] = ["row", "column"];

export const SERVER_VIEW_MODE_SET = new Set<ServerViewMode>(SERVER_VIEW_MODES);

export const SINGLE_COLUMN_SERVER_VIEW_MODES = new Set<ServerViewMode>([
  "list",
  "matrix",
  "row",
  "column",
]);

export const LIST_LIKE_SERVER_VIEW_MODES = new Set<ServerViewMode>(["list", "matrix"]);

export const LANE_SERVER_VIEW_MODES = new Set<ServerViewMode>(["row", "column"]);

export function formatViewLabel(mode: ServerViewMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
