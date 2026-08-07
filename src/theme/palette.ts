/**
 * Layer 1 — raw palette.
 *
 * Raw swatches only. Nothing here is used directly by screens/components —
 * only `semantic.ts` reads from this file. This indirection is what makes the
 * palette swappable (design-language.md §3, D7): the day the SHAKEmaps
 * Toolkit's real intensity hex values are extracted and reconciled, only this
 * file changes.
 *
 * REMAINING PLACEHOLDER — SWAPPABLE. One thing is still not final
 * (design-language.md "Handoff notes"):
 *   1. Brand blue / action red exact hex (owner-review item).
 * The intensity ramp below is no longer a placeholder — see provenance note.
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
 *
 * PROVENANCE (ui-backlog.md item 8 / decisions.md "toolkit palette
 * extraction", 2026-08-07): extracted verbatim from
 * `SHAKEmaps-Toolkit-v26/modules/utils/SHAKEtools.py`, function
 * `contour_scale(pgm_type, scale_type="ems")`, the `ems_colors` list (12
 * entries, paired 1:1 with that same function's `ems_table
 * ["intensity_values_ems"] = [0,1,2,...,12]` — 13 bin edges, 12 bins, one
 * color per EMS level, no ambiguity). This is a DIFFERENT, EMS-98-native
 * list from the toolkit's other `usgs_colors` table (11 stops, MMI I-X +
 * one "off-scale" cap, found in the same file and duplicated in
 * `modules/viz/SHAKEmapper.py`) — that second list is the raw USGS
 * ShakeMap MMI convention, not what our app uses. Since Bumelerze displays
 * EMS-98 (D7), `ems_colors` is the correct, authoritative source, and it is
 * NOT simply "the standard USGS MMI palette" — it is the toolkit's own
 * purpose-built EMS ramp (named CSS-style in its source comments:
 * whitesmoke, mediumslateblue, lightskyblue, seagreen, yellow, gold,
 * orange, darkorange, red, darkred, "verydarkred"). Converted float
 * RGBA (0..1 channels, toolkit alpha ignored — see note on level I below)
 * to 6-digit hex, no rounding beyond nearest-integer channel value.
 *
 * One deliberate deviation from the raw extraction: the toolkit's own level
 * I entry is `(1, 1, 1, 0)` — fully TRANSPARENT white, because their map
 * renderer skips drawing a fill for "not felt" areas entirely. This array
 * has no alpha channel (every consumer — `ShakeMapView`'s SVG fill,
 * `LevelTile`'s solid swatch — expects a solid color), so level I renders
 * as solid white instead of a no-op fill. Not a color choice, a type-shape
 * necessity; flagged for Peshawa in case ShakeMapView should instead skip
 * painting level-I rings altogether to match the toolkit's own convention
 * (a future, larger change, not attempted here).
 *
 * Also worth flagging: this toolkit source assigns II and III visibly
 * different colors (`#EDEFF3` vs `#ACB4CE`) — the OLD placeholder ramp this
 * replaces had deliberately merged II/III into one shared swatch ("EMS-98
 * display convention"). That merge is dropped here in favor of the
 * toolkit's real, level-by-level-distinct data (D7: follow the source, don't
 * invent simplifications on top of it). If Peshawa wants the merged-band
 * display back for readability, that's a display-layer decision to revisit,
 * not a palette one.
 */
export const intensityRampLight: readonly string[] = [
  "", // index 0 unused
  "#FFFFFF", // I    — not felt (toolkit: transparent; see note above)
  "#EDEFF3", // II   — whitesmoke
  "#ACB4CE", // III  — mediumslateblue
  "#A1D7E3", // IV   — lightskyblue
  "#8FC891", // V    — seagreen
  "#F9EC33", // VI   — yellow
  "#EEB509", // VII  — gold
  "#E9872D", // VIII — orange
  "#DF532A", // IX   — darkorange
  "#D9262A", // X    — red
  "#880000", // XI   — darkred
  "#440001", // XII  — verydarkred
];

/** Per-swatch on-fill text color — never a single global white/black rule.
 * Computed from WCAG 2.x relative-luminance contrast (not eyeballed) against
 * `neutral[1000]` (dark text) vs. `#FFFFFF` (light text), always picking
 * whichever wins: I..VIII clear the full 4.5:1 AA-normal-text ratio with
 * dark text, X..XII clear it with white text. IX (`#DF532A`) is the one
 * genuinely borderline swatch — dark text only reaches ~4.29:1 there (white
 * is worse, ~3.88:1) — still the better of the two options and comfortably
 * over the 3:1 floor WCAG 1.4.11 sets for a graphical/iconographic element
 * like this numeral swatch, just short of the stricter normal-text bar;
 * flagged here rather than hidden, see `theme/__tests__/palette.test.ts`
 * for the exact figures. This crossover shifted down overall (was VIII on
 * the old placeholder ramp) because the real toolkit reds/darkreds are more
 * saturated than the old placeholder guesses. */
export const intensityOnFillLight: readonly string[] = [
  "",
  neutral[1000],
  neutral[1000],
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
];

/**
 * Dark-mode intensity ramp: same toolkit hue family as light (never re-hue
 * the scientific scale) for every level EXCEPT XI/XII — see the flagged,
 * minimal adjustment below. Levels I-X are identical to
 * `intensityRampLight`: verified (WCAG relative luminance) to read clearly
 * against this app's true-black-leaning dark surfaces, including the pale
 * I/II/III/IV entries the ui-backlog item anticipated might "vanish" —
 * checked and they don't (pale colors read at very high, not low, contrast
 * against true black; if anything they read brighter/"glowier" than a calm
 * dark theme ideally wants, but that's a stylistic nit, not an accessibility
 * failure, so left untouched per "don't silently redesign").
 *
 * The MEASURED problem turned out to be the opposite end: XI (`#880000`)
 * and especially XII (`#440001`) are dark, print/paper-oriented reds — on
 * this app's true-black dark surfaces they measured ~1.8:1 and ~1.1:1
 * contrast against the dark card background (`#141414`), i.e. functionally
 * invisible, well under even the 3:1 floor for a graphical UI element. That
 * is a real "vanishes on dark" bug the ui-backlog item flagged for (it
 * expected it at the low end; it's at the high end instead, because the
 * authoritative EMS ramp turned out to be light-background-oriented at its
 * darkest stop). Documented minimal fix, flagged for Peshawa: blend 65%
 * toolkit color + 35% white, applied ONLY to XI/XII, which lifts both back
 * over a 3:1 contrast floor against `#141414` while keeping them visibly
 * the two darkest/most-saturated reds in the ramp. No other level touched.
 */
export const intensityRampDark: readonly string[] = [
  "",
  "#FFFFFF", // I    — unchanged, see file doc above
  "#EDEFF3", // II   — unchanged
  "#ACB4CE", // III  — unchanged
  "#A1D7E3", // IV   — unchanged
  "#8FC891", // V    — unchanged
  "#F9EC33", // VI   — unchanged
  "#EEB509", // VII  — unchanged
  "#E9872D", // VIII — unchanged
  "#DF532A", // IX   — unchanged
  "#D9262A", // X    — unchanged (already ~3.7:1 against #141414)
  "#B25959", // XI   — 65% #880000 + 35% white, flagged for Peshawa
  "#85595A", // XII  — 65% #440001 + 35% white, flagged for Peshawa
];

/** Same WCAG-computed crossover as `intensityOnFillLight` (I-IX dark text,
 * X-XII white text) — levels I-X share identical hex with the light ramp so
 * the same computed crossover holds; XI/XII were re-checked against their
 * new, lightened dark-mode hex values above and still land on white text
 * (with a larger, more comfortable margin than before the adjustment). */
export const intensityOnFillDark: readonly string[] = [
  "",
  "#161616",
  "#161616",
  "#161616",
  "#161616",
  "#161616",
  "#161616",
  "#161616",
  "#161616",
  "#161616",
  "#F2F2F3",
  "#F2F2F3",
  "#F2F2F3",
];
