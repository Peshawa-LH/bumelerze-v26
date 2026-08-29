/**
 * Numeric-field validation for the spectrum inputs form (`Ss`, `S1`, free-
 * entry `R`) — same shape as `handbook/coordinate-validation.ts`'s
 * `validateCoordinateField` (Latin-digit input only; localized-digit
 * rendering happens only on the read-back side), generalized to an
 * arbitrary positive-number bound instead of the lat/lon-specific one.
 */

export type NumberFieldError = "empty" | "notANumber" | "outOfRange";

export interface NumberFieldValidation {
  value: number | null;
  error: NumberFieldError | null;
}

export function validatePositiveNumberField(
  raw: string,
  bound: { min: number; max: number },
): NumberFieldValidation {
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
