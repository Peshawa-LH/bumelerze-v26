import { localizeDigits } from "@/lib/format-numbers";

import { INTENSITY_ROMAN_NUMERALS } from "./intensity-ramp";

/**
 * The ONE place an intensity level (EMS-98 / MMI, 1..12) becomes text
 * (owner note N15, 2026-10-07): English and Kurmanji read Roman numerals
 * (V, VI), Sorani and Arabic read the same Eastern Arabic digits as the rest
 * of those languages (٥, ٦). Every screen that prints an intensity (map
 * legend, map description, people-by-level rows, the hub impact chart, the
 * building report text) goes through here, so a Roman numeral can never
 * reappear in a Sorani or Arabic surface by a forgotten call site.
 *
 * Not for damage grades (DG1-DG5), vulnerability classes (A-F) or the
 * felt-report levels: those are different scales and keep their own labels.
 */

const MIN_LEVEL = 1;
const MAX_LEVEL = 12;

/** Locales that read intensity as digits; every other locale reads Roman. */
const DIGIT_INTENSITY_LOCALES: ReadonlySet<string> = new Set(["ckb", "ar"]);

/** Joins the two ends of a range or half step ("V–VI"). */
const RANGE_SEPARATOR = "–";

function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}

function formatWhole(level: number, locale: string): string {
  const whole = clampLevel(level);
  if (DIGIT_INTENSITY_LOCALES.has(locale)) {
    return localizeDigits(String(whole), locale);
  }
  return INTENSITY_ROMAN_NUMERALS[whole] ?? String(whole);
}

/**
 * One intensity level. A half step (5.5) reads as the range of the two
 * whole levels it sits between ("V–VI" / "٥–٦"); anything else is rounded
 * to the nearest whole level and clamped to 1..12, the same rule the map
 * ramp uses (`mmiValueToLevel`).
 */
export function formatIntensity(level: number, locale: string): string {
  if (Number.isFinite(level) && Math.abs(level * 2 - Math.round(level * 2)) < 1e-9) {
    const isHalf = Math.abs(level - Math.round(level)) > 0.25;
    if (isHalf) {
      const low = Math.floor(level);
      return formatIntensityRange(low, low + 1, locale);
    }
  }
  return formatWhole(level, locale);
}

/** A span of levels ("V–VII"); one level when both ends are the same. */
export function formatIntensityRange(low: number, high: number, locale: string): string {
  const from = clampLevel(Math.min(low, high));
  const to = clampLevel(Math.max(low, high));
  if (from === to) {
    return formatWhole(from, locale);
  }
  return `${formatWhole(from, locale)}${RANGE_SEPARATOR}${formatWhole(to, locale)}`;
}

/** Every level 1..12 in order, for a legend strip. */
export function intensityLegendLabels(
  locale: string,
): { level: number; label: string }[] {
  return Array.from({ length: MAX_LEVEL }, (_, index) => ({
    level: index + 1,
    label: formatWhole(index + 1, locale),
  }));
}
