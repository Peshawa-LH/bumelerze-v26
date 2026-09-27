import type { SemanticColors } from "@/theme";
import type { StationFreshness } from "../types";

/** Map dot and badge colour per tier; silent stations are drawn, greyed
 * (owner, 2026-09-27: every Iraqi station shown as a station and a place,
 * with no data on the figure). */
export function freshnessColor(colors: SemanticColors, tier: StationFreshness): string {
  switch (tier) {
    case "live":
      return colors.status.success;
    case "recent":
      return colors.status.warning;
    case "silent":
      return colors.text.tertiary;
    case "unknown":
      return colors.text.secondary;
  }
}
