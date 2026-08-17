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
  /**
   * WCAG-AA contrast fix (accessibility-tester Phase 5 audit,
   * `theme/__tests__/palette.test.ts`'s new "text.tertiary" describe
   * block): `text.tertiary` (light theme) previously pointed at
   * `neutral[500]`, which reads at only ~2.43:1 against white — a clear
   * fail of the 4.5:1 normal-text floor, on real screen content
   * (`notificationSettings.homeBase.notSetHint`, `.fatigueFooter`,
   * `sensor.gravityNote`) as well as the always-visible tab-bar inactive
   * icon/label color. `neutral[600]` alone only reaches ~3.67:1 — still
   * short — and jumping straight to `neutral[700]` (6.77:1) would erase the
   * visual hierarchy between "tertiary" and "secondary" text entirely. This
   * step sits between the two, reaches ~5.08:1 (safe margin over 4.5), and
   * stays visibly lighter than `neutral[700]`.
   */
  650: "#6E6E72",
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
 *
 * [REVIEW visual - Peshawa] XI/XII light+dark unification (2026-08-17 update
 * wave, §2.1): this used to be two ramps — `intensityRampLight` kept the
 * canonical toolkit reds `#880000`/`#440001`, `intensityRampDark` swapped in
 * lightened substitutes `#B25959`/`#85595A` because the canonical reds
 * measured ~1.8:1/~1.1:1 against the true-black dark surface (`#141414`),
 * well under the 3:1 floor. Owner directive: "keep dark mode and light mode
 * the SAME colors, or better ones" — `intensityRampDark` is retired, this
 * single ramp now serves both themes. New XI/XII values `#DB0000`/`#CC0000`
 * (pure-hue, fully-saturated red, hue 0° — a deliberately more vivid "fire"
 * red than the toolkit's print-oriented darkreds, chosen so lifting the
 * lightness enough to survive true-black doesn't just look like a paler
 * version of X): both levels stay in the dark-red family, both are DARKER
 * (lower relative luminance) than X (`#D9262A`, lum 0.163) so the ramp still
 * reads as increasing severity after X — XI lum 0.151, XII lum 0.128, X > XI
 * > XII — and both clear 3:1 against EVERY surface that matters, with a real
 * margin, not a razor's edge:
 *   XI  #DB0000 vs dark surface `#141414`: 3.52:1  |  vs light surface `#FFFFFF`: 5.23:1
 *   XII #CC0000 vs dark surface `#141414`: 3.13:1  |  vs light surface `#FFFFFF`: 5.89:1
 * (contrast ratios are WCAG 2.x relative-luminance, computed not eyeballed —
 * see `theme/__tests__/palette.test.ts`). Levels I-X are byte-identical to
 * the pre-unification values; only XI/XII changed, and only once (no
 * separate light/dark hex pair exists anywhere in this file anymore).
 */
export const intensityRamp: readonly string[] = [
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
  "#DB0000", // XI   — unified light/dark, see "XI/XII light+dark unification" above
  "#CC0000", // XII  — unified light/dark, see "XI/XII light+dark unification" above
];

/** Per-swatch on-fill text color for `intensityRamp`, light-theme reading —
 * never a single global white/black rule. Computed from WCAG 2.x
 * relative-luminance contrast (not eyeballed) against `neutral[1000]` (dark
 * text) vs. `#FFFFFF` (light text), always picking whichever wins: I..VIII
 * clear the full 4.5:1 AA-normal-text ratio with dark text, X..XII clear it
 * with white text. IX (`#DF532A`) is the one genuinely borderline swatch —
 * dark text only reaches ~4.29:1 there (white is worse, ~3.88:1) — still the
 * better of the two options and comfortably over the 3:1 floor WCAG 1.4.11
 * sets for a graphical/iconographic element like this numeral swatch, just
 * short of the stricter normal-text bar; flagged here rather than hidden,
 * see `theme/__tests__/palette.test.ts` for the exact figures. This
 * crossover shifted down overall (was VIII on the old placeholder ramp)
 * because the real toolkit reds/darkreds are more saturated than the old
 * placeholder guesses. XI/XII (2026-08-17 unification) were re-checked
 * against their new hex values and still land clearly on white text (5.23:1
 * and 5.89:1 respectively — both comfortably clear 4.5:1, a larger margin
 * than the pre-unification dark-mode substitutes had). */
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

/** Same `intensityRamp` fills, dark-theme on-fill reading — the swatch
 * colors are now identical between themes (see the unification note above),
 * but the two candidate text tokens still differ slightly per theme
 * (`#161616`/`#F2F2F3` here vs. `neutral[1000]`/`#FFFFFF` above), so this
 * stays a separate array rather than being collapsed into one. Same
 * WCAG-computed crossover as `intensityOnFillLight` (I-IX dark text, X-XII
 * white text) holds for every level, XI/XII included: white text on
 * `#DB0000`/`#CC0000` reaches 4.68:1/5.26:1 against this theme's dark-text
 * option, both clearing 4.5:1 with more margin than the pre-unification
 * substitutes (`#B25959`/`#85595A`) had. */
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

/**
 * Damage-grade palette (2026-08-17 update wave, §2.2b) — DG1..DG5 (array
 * index 1..5, index 0 unused, same "index reads directly as the grade"
 * convention as `intensityRamp`). Owner directive: damage tiles get their
 * OWN 5-color palette, decoupled entirely from sampling points on the EMS
 * intensity ramp (the old `DAMAGE_GRADE_TO_INTENSITY_INDEX` mechanism in
 * `features/felt/damage.ts` is retired by this change) — a damage grade is
 * not literally an EMS intensity, so it shouldn't borrow that ramp's colors.
 *
 * Exact hexes as specified: DG3 `#F9EC33`, DG4 `#DF532A`, DG5 `#440001` (a
 * deliberate, exact echo of the EMS ramp's PRE-unification canonical XII —
 * "total collapse = the worst/darkest color in the app" — chosen
 * independently of whatever `intensityRamp`'s own XII happens to be after
 * the 2.1 unification, since this palette no longer samples that ramp at
 * all). DG1/DG2 (greens) were ours to choose:
 *   - DG2 (light green) = `#8FC891`, reused verbatim from `intensityRamp`'s
 *     level V — already contrast-verified in this app, and reusing it keeps
 *     the damage palette visually related to the intensity ramp's own
 *     "calm" end without literally sampling it as an index.
 *   - DG1 (dark green, "no visible damage") = `#1B5E20`, a new token in the
 *     SAME hue family as DG2 (hue ~124-125°, matching V's ~122° almost
 *     exactly) so the two greens read as one harmonious light/dark pair
 *     rather than two unrelated greens, just much darker/richer so it holds
 *     its own next to DG5's near-black red at the palette's other end.
 *
 * Contrast (WCAG 2.x relative luminance, computed not eyeballed — see
 * `theme/__tests__/palette.test.ts`), on-fill text vs. this app's two
 * candidate text tokens per theme:
 *   DG1 #1B5E20 — white text 7.87:1 (light theme) / 7.03:1 (dark theme) — clears 4.5:1 easily
 *   DG2 #8FC891 — dark text 8.60:1 (light theme) / 9.34:1 (dark theme) — clears 4.5:1 easily
 *   DG3 #F9EC33 — dark text 13.55:1 (light theme) / 14.71:1 (dark theme) — clears 4.5:1 easily
 *   DG4 #DF532A — dark text 4.29:1 (light theme) / 4.66:1 (dark theme) — same borderline case as
 *     `intensityRamp`'s IX (identical hex): best available option, still clears the 3:1
 *     graphical-object floor even where it falls just short of the stricter 4.5:1 normal-text bar
 *   DG5 #440001 — white text 16.85:1 (light theme) / 15.06:1 (dark theme) — clears 4.5:1 easily
 */
export const damageGradePalette: readonly string[] = [
  "", // index 0 unused
  "#1B5E20", // DG1 — no visible damage
  "#8FC891", // DG2
  "#F9EC33", // DG3
  "#DF532A", // DG4
  "#440001", // DG5 — partial/full collapse
];

/** `damageGradePalette` on-fill text, light-theme reading — same
 * "pick whichever of the two candidate text colors wins" logic as
 * `intensityOnFillLight`, computed per-swatch (see the contrast figures on
 * `damageGradePalette` above). */
export const damageGradeOnFillLight: readonly string[] = [
  "",
  "#FFFFFF", // DG1 — light text wins (dark text only ~2.12:1)
  neutral[1000], // DG2 — dark text wins
  neutral[1000], // DG3 — dark text wins
  neutral[1000], // DG4 — dark text wins (borderline, see note above)
  "#FFFFFF", // DG5 — light text wins (dark text only ~1.01:1)
];

/** `damageGradePalette` on-fill text, dark-theme reading — mirrors
 * `intensityOnFillDark`'s two candidate tokens (`#161616`/`#F2F2F3`). */
export const damageGradeOnFillDark: readonly string[] = [
  "",
  "#F2F2F3", // DG1
  "#161616", // DG2
  "#161616", // DG3
  "#161616", // DG4 — borderline, see note above
  "#F2F2F3", // DG5
];
