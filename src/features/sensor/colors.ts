import type { SemanticColors } from "@/theme";
import type { AxisKey } from "./types";

/**
 * Axis→color mapping derived from the app's existing `status.*` semantic
 * tokens (already used elsewhere, e.g. `EventCard`'s magnitude accent
 * stripe) rather than inventing new palette entries. `semantic.ts` assigns
 * `status` the exact same object for both light and dark themes, so these
 * three colors need no separate dark-mode variant and are guaranteed to
 * stay distinguishable from each other regardless of scheme — three already
 * visually distinct hues (red / blue / green), never reusing the reserved
 * `action.felt` red (that token is exclusively the felt-report CTA).
 */
export function axisColor(colors: SemanticColors, axis: AxisKey): string {
  switch (axis) {
    case "x":
      return colors.status.danger;
    case "y":
      return colors.status.info;
    case "z":
      return colors.status.success;
  }
}

/**
 * Text color used on top of a *filled* axis chip (see `AxisToggleChips`).
 * Deliberately not `colors.text.inverse` — that token flips per color
 * scheme (near-white in light mode, near-black in dark mode) because it's
 * designed to sit on `colors.brand.primary`, which itself flips lightness
 * per scheme. The three status colors above do not flip — they're the same
 * dark, saturated hex in both themes (palette.ts) — so a single white
 * always reads correctly on top of them. Same placeholder-palette caveat as
 * the rest of `palette.ts`: exact contrast is owner-review territory, not
 * locked here.
 */
export const AXIS_CHIP_ON_FILL_TEXT = "#FFFFFF";
