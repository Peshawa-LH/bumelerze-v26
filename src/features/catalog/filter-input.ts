import { toAsciiDigits } from "@/lib/format-numbers";

/** The oldest year the regional catalogue can hold (its first event, AD 872).
 * Typed and stepped "from/to year" values never go below it. */
export const CATALOG_FIRST_YEAR = 872;

/** The newest year a year filter can be set to: this calendar year. */
export function catalogCurrentYear(now: Date = new Date()): number {
  return now.getFullYear();
}

export interface FilterInputLimits {
  min: number;
  max: number;
  /** 0 for years, 1 for magnitudes. */
  decimals: number;
}

/**
 * Reads what someone typed into a catalogue filter box (review note 9.1).
 * Accepts ASCII digits, Eastern Arabic-Indic digits (as Sorani and Arabic
 * keyboards type them), the Arabic decimal separator (٤٫٥) and a decimal
 * comma (4,5) as well as 4.5; in a year a comma is read as a thousands
 * separator. The result is rounded to `decimals` and clamped
 * into [min, max]. Returns null for anything that is not a number (empty,
 * letters, two separators), so the box can fall back to the last good value.
 */
export function parseFilterInput(text: string, limits: FilterInputLimits): number | null {
  // A comma (Latin, Arabic U+060C or Arabic thousands U+066C) is a decimal
  // separator in a magnitude (4,5) but a thousands separator in a year (1,990).
  const ascii = toAsciiDigits(text.trim()).replace(
    /[,،٬]/g,
    limits.decimals > 0 ? "." : "",
  );
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(ascii)) {
    return null;
  }
  const parsed = Number(ascii);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const factor = 10 ** limits.decimals;
  const rounded = Math.round(parsed * factor) / factor;
  return Math.min(limits.max, Math.max(limits.min, rounded));
}
