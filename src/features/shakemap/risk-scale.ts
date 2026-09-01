/**
 * Pure log-scale positioning for `RiskImpactScale.tsx` — kept independent
 * of any component/theme/i18n so the actual axis math is directly
 * unit-testable (no `onLayout`/DOM involved: every position is a 0..1
 * fraction the component turns into a `left`/`width` PERCENTAGE string,
 * so it never needs to know the rail's real measured pixel width at all).
 */

/** The rail's fixed domain: 10 to 1,000,000 heavily-damaged buildings (6
 * orders of magnitude) — wide enough to cover every real event this app
 * has computed a risk product for without the P50/whisker ever needing to
 * clip, while still resolving small events (tens of buildings) as more
 * than a sliver at the rail's start. */
export const IMPACT_SCALE_MIN = 10;
export const IMPACT_SCALE_MAX = 1_000_000;

/** Fixed short-form tick marks — like `INTENSITY_ROMAN_NUMERALS`/`DAMAGE_
 * GRADE_LABELS`, these are scale notation (order-of-magnitude shorthand),
 * not prose, and are deliberately NOT translated per locale. */
export const IMPACT_SCALE_TICKS: readonly { value: number; label: string }[] = [
  { value: 10, label: "10" },
  { value: 100, label: "100" },
  { value: 1_000, label: "1k" },
  { value: 10_000, label: "10k" },
  { value: 100_000, label: "100k" },
  { value: 1_000_000, label: "1M" },
];

/**
 * `value`'s position along the rail as a 0..1 fraction — `log10(value)`
 * normalized against the domain's own log10 span, clamped so a value
 * outside `[IMPACT_SCALE_MIN, IMPACT_SCALE_MAX]` still resolves to a real
 * on-rail position (0 or 1) rather than an off-rail/negative/NaN one.
 * `value <= 0` clamps to the minimum (there is no log of zero/negative).
 */
export function logPositionForValue(value: number): number {
  if (value <= IMPACT_SCALE_MIN) {
    return 0;
  }
  if (value >= IMPACT_SCALE_MAX) {
    return 1;
  }
  const logMin = Math.log10(IMPACT_SCALE_MIN);
  const logMax = Math.log10(IMPACT_SCALE_MAX);
  return (Math.log10(value) - logMin) / (logMax - logMin);
}

/** `logPositionForValue`, as a `"NN.NN%"` CSS-percentage string — what the
 * component actually hands to a `left` style. React Native's Yoga layout
 * engine (unlike web CSS) has no `calc()`, so a segment's on-screen WIDTH
 * is always expressed as its own percentage (`logSpanPercent` below),
 * never as "100% minus something" — this function and that one are the
 * only two percentage builders `RiskImpactScale.tsx` needs. */
export function logPositionPercent(value: number): `${number}%` {
  // React Native's `DimensionValue` type requires this exact template-
  // literal shape (`${number}%`), not a general `string` — the cast is
  // safe here because `.toFixed(2)` always produces digits, and
  // `logPositionForValue` always returns a finite 0..1 number (clamped),
  // so this string always genuinely matches the pattern.
  return `${(logPositionForValue(value) * 100).toFixed(2)}%` as `${number}%`;
}

/** The percentage WIDTH of the span between `fromValue` and `toValue` —
 * `logPositionForValue(toValue) - logPositionForValue(fromValue)`, clamped
 * to never go negative (a defensive floor only; every real caller already
 * hands this two values in ascending order). */
export function logSpanPercent(fromValue: number, toValue: number): `${number}%` {
  const span = Math.max(0, logPositionForValue(toValue) - logPositionForValue(fromValue));
  return `${(span * 100).toFixed(2)}%` as `${number}%`;
}
