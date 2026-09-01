/**
 * Expected-damage-grade value -> DG ramp index (1..5) — the risk-chain
 * sibling of `intensity-ramp.ts`'s `mmiValueToLevel`, kept as its own tiny
 * module (not folded into `risk.ts`) so `ShakeMapView`'s damage-layer
 * legend and `risk.ts`'s `parseDamageContours` share the exact same
 * rounding rule and can never drift, the same "one shared level mapping,
 * two callers" discipline `intensity-ramp.ts`'s own doc comment
 * establishes for the intensity ramp.
 */
const MIN_LEVEL = 1;
const MAX_LEVEL = 5;

export function damageValueToLevel(value: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(value)));
}

/** DG1..DG5 labels for ramp indices 1..5 (index 0 unused, same "index 0 is
 * a placeholder" convention as `intensity-ramp.ts`'s
 * `INTENSITY_ROMAN_NUMERALS`). Like Roman numerals for MMI, "DG" damage-
 * grade codes are the fixed scientific short form (EMS-98-family
 * damage-grade convention cited by the product itself, `field:
 * "expected_damage_grade"`) and are deliberately NOT translated per
 * locale — same reasoning `INTENSITY_ROMAN_NUMERALS` documents for why
 * "I".."XII" never localizes either. */
export const DAMAGE_GRADE_LABELS: readonly string[] = [
  "",
  "DG1",
  "DG2",
  "DG3",
  "DG4",
  "DG5",
];
