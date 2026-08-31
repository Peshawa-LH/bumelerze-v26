import { toAsciiDigits } from "@/lib/format-numbers";

export type CoordinateFieldError = "empty" | "notANumber" | "outOfRange";

export interface CoordinateValidation {
  value: number | null;
  error: CoordinateFieldError | null;
}

/**
 * Validates one decimal-degrees text field.
 *
 * The field WRITES Latin digits (typescript-react-native.md:
 * "digit-localized DISPLAY but accept Latin input", spec-v1.md §7), and
 * localized-digit rendering happens only on the read-back/results side via
 * `@/lib/format-numbers`, never here.
 *
 * What it ACCEPTS is wider, and deliberately so: the raw text is passed
 * through `toAsciiDigits` first. A Sorani or Arabic reader types on their
 * own keyboard, and every numeral the app shows them is Eastern
 * Arabic-Indic; entering a coordinate that way used to return NaN and a
 * flat "not a number", which for the primary audience of a Kurdish-first
 * app is a wall rather than a validation message. Widening what is
 * accepted cannot change what is written.
 */
export function validateCoordinateField(
  raw: string,
  bound: { min: number; max: number },
): CoordinateValidation {
  const trimmed = toAsciiDigits(raw.trim());
  if (trimmed.length === 0) {
    return { value: null, error: "empty" };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { value: null, error: "notANumber" };
  }
  if (value < bound.min || value > bound.max) {
    return { value: null, error: "outOfRange" };
  }
  return { value, error: null };
}

export const LATITUDE_BOUND = { min: -90, max: 90 };
export const LONGITUDE_BOUND = { min: -180, max: 180 };

export function validateLatitude(raw: string): CoordinateValidation {
  return validateCoordinateField(raw, LATITUDE_BOUND);
}

export function validateLongitude(raw: string): CoordinateValidation {
  return validateCoordinateField(raw, LONGITUDE_BOUND);
}
