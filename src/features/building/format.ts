import { isolateNumeric } from "@/features/events/format";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";

/** Number formatting for the report: digits localize, the numeral is isolated
 * so it never reorders inside an RTL sentence. */

export function formatPercent(fraction: number, locale: string): string {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return isolateNumeric(`${localizeDigits(String(percent), locale)}%`);
}

export function formatPga(pgaG: number, locale: string): string {
  return isolateNumeric(formatFixedLocalized(pgaG, 2, locale));
}

/** Vs30 rounded to the nearest 10 m/s: the bundled grid is a coarse model. */
export function formatVs30(vs30: number, locale: string): string {
  return isolateNumeric(localizeDigits(String(Math.round(vs30 / 10) * 10), locale));
}

/** "B-D" -> "B–D" for display (en dash); "C" stays "C". */
export function displayVcRange(range: string | null | undefined): string | null {
  return range ? range.replace("-", "–") : null;
}
