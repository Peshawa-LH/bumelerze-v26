/**
 * Layer 1 — raw palette.
 *
 * Raw swatches only. Nothing here is used directly by screens/components —
 * only `semantic.ts` reads from this file. This indirection is what makes the
 * palette swappable (design-language.md §3, D7): the day the SHAKEmaps
 * Toolkit's real intensity hex values are extracted and reconciled, only this
 * file changes.
 *
 * PLACEHOLDER VALUES — SWAPPABLE. Two things are explicitly not final yet
 * (design-language.md "Handoff notes"):
 *   1. Brand blue / action red exact hex (owner-review item).
 *   2. The full intensity ramp — must be reconciled against the actual
 *      SHAKEmaps Toolkit palette file before Phase 3 ships (tracked in
 *      decisions.md task ledger as "toolkit palette hex extraction").
 */

/** 12-step neutral gray ramp, white (0) to near-black (1100). */
export const neutral = {
  0: "#FFFFFF",
  100: "#F7F7F8",
  200: "#EDEDEF",
  300: "#E2E2E5",
  400: "#CBCBCF",
  500: "#A6A6AA",
  600: "#85858A",
  700: "#5B5B5E",
  800: "#444447",
  900: "#2A2A2C",
  1000: "#1E1E1E",
  1100: "#161616",
} as const;

/** Brand primary — "Zagros Blue". PLACEHOLDER, owner review pending (§3). */
export const brand = {
  primaryLight: "#1F4E5F",
  primaryDark: "#3E7C93",
} as const;

/**
 * Action red — "Felt-Report Red". Reserved exclusively for the persistent
 * "I felt it" CTA and true danger states — never reused for intensity fills.
 * PLACEHOLDER, owner review pending (§3).
 */
export const actionRed = {
  light: "#C6202D",
  dark: "#E8433E",
} as const;

export const status = {
  success: "#2E9E5B",
  warning: "#C77E12",
  danger: "#C3202B",
  info: "#2E6E9E",
} as const;

/**
 * EMS-98 intensity ramp, indexed I..XII (array index 1..12, index 0 unused
 * so the Roman-numeral level reads directly as the array index).
 * Hex values are the design-language.md §3.1 working placeholders, following
 * the general USGS ShakeMap MMI convention. NOT the authoritative toolkit
 * palette yet — see file header.
 */
export const intensityRampLight: readonly string[] = [
  "", // index 0 unused
  "#F2F2F2", // I    — not felt
  "#C9E8F5", // II   — weak (II–III merged band in EMS-98 display convention)
  "#C9E8F5", // III  — weak (same fill as II, per merged-band convention)
  "#8FD1E8", // IV   — light
  "#FFEB6E", // V    — moderate
  "#FFC94D", // VI   — strong
  "#FF9E42", // VII  — very strong
  "#FF6E3D", // VIII — severe (contrast crossover point, verify AA)
  "#E8402E", // IX   — violent
  "#C3202B", // X    — devastating
  "#8E1B2E", // XI   — completely devastating
  "#5C1420", // XII  — catastrophic
];

/** Per-swatch on-fill text color — never a single global white/black rule. */
export const intensityOnFillLight: readonly string[] = [
  "",
  neutral[1000],
  neutral[1000],
  neutral[1000],
  neutral[1000],
  neutral[1000],
  neutral[1000],
  neutral[1000],
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
];

/**
 * Dark-mode intensity ramp: same hue family as light (never re-hue the
 * scientific scale), lightness/saturation tuned so swatches don't glow
 * against true-black surfaces. Placeholder pass — needs the same
 * toolkit-reconciliation + contrast verification as the light ramp.
 */
export const intensityRampDark: readonly string[] = [
  "",
  "#2A2A2C",
  "#1E4A5C",
  "#1E4A5C",
  "#1C5A6E",
  "#B99A2E",
  "#B9862E",
  "#C06A2C",
  "#C0502C",
  "#A6301F",
  "#8A1E28",
  "#671826",
  "#43101A",
];

export const intensityOnFillDark: readonly string[] = [
  "",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
  "#161616",
  "#161616",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
];
