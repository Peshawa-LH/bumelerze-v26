export type CoordinateFieldError = "empty" | "notANumber" | "outOfRange";

export interface CoordinateValidation {
  value: number | null;
  error: CoordinateFieldError | null;
}

/**
 * Validates one decimal-degrees text field. Deliberately accepts plain
 * Latin-digit input only (`Number()` on the raw string) — the coordinate
 * TextInput itself is Latin-only by design (typescript-react-native.md:
 * "digit-localized DISPLAY but accept Latin input", spec-v1.md §7); any
 * localized-digit rendering happens only on the read-back/results side via
 * `@/lib/format-numbers`, never here.
 */
export function validateCoordinateField(
  raw: string,
  bound: { min: number; max: number },
): CoordinateValidation {
  const trimmed = raw.trim();
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
