import { isolateNumeric } from "@/features/events";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";
import type { IscSiteClass, OccupancyCategory, SeismicDesignCategory } from "./types";

/**
 * Display formatting for the spectrum module — thin composition of the
 * same digit-localization primitives the rest of the handbook uses
 * (`handbook/format.ts`'s own doc comment: "one module owns scientific
 * formatting"). Every numeral shown in the UI goes through here, never
 * through a raw `.toFixed()` in a component.
 */

/** `Ss`/`S1`/`Fa`/`Fv`/`SMS`/`SM1`/`SDS`/`SD1`/`Cs` — 3 decimals, isolated
 * so a Sorani/Arabic sentence's bidi algorithm never reorders the digits. */
export function formatCoefficient(value: number, locale: string): string {
  return isolateNumeric(formatFixedLocalized(value, 3, locale));
}

/** `T0`/`Ts`/`TL`/plotted period — 3 decimals plus the literal "s" unit
 * handled by the caller's translation string, matching
 * `handbook/format.ts`'s numeral-only/unit-via-i18n split. */
export function formatPeriodSeconds(value: number, locale: string): string {
  return isolateNumeric(formatFixedLocalized(value, 3, locale));
}

/** Free-entry `R` — up to 2 decimals, trailing zeros trimmed (an engineer
 * enters "4", not "4.00"). */
export function formatPlainNumber(value: number, locale: string): string {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return isolateNumeric(localizeDigits(text, locale));
}

/**
 * Small code constants that must survive verbatim: `Ct` 0.044, the 0.007
 * masonry drift ratio, `Cu` 1.4, the exponent `x` 0.9.
 *
 * `formatPlainNumber` rounds to 2 decimals, which is right for a
 * free-entry `R` and WRONG here: it renders `Ct = 0.044` as "0.04" and the
 * 0.007 drift limit as "0.01", a 43% error on a published limit. Caught in
 * browser verification, 2026-08-30. Up to 4 decimals, trailing zeros
 * trimmed, so 0.02 stays "0.02" and 0.044 stays "0.044".
 */
export function formatCodeCoefficient(value: number, locale: string): string {
  const text = Number(value.toFixed(4)).toString();
  return isolateNumeric(localizeDigits(text, locale));
}

/** ISC-2017 site class and seismic design category letters are notation
 * (same convention as the Roman-numeral PGA zone label and every other
 * mathematical symbol in this app, `handbook/types.ts`'s doc comment) —
 * never digit-localized, never translated. */
export function formatIscSiteClass(siteClass: IscSiteClass): string {
  return siteClass;
}

export function formatSeismicDesignCategory(category: SeismicDesignCategory): string {
  return category;
}

export function occupancyLabelKey(occupancy: OccupancyCategory): string {
  return `handbook.spectrum.occupancy.${occupancy}`;
}

/** Tab-free plain-text "{{label}}: {{value}}" lines for the control-point
 * table's clipboard export (§7.5 point 2) — the component supplies already
 * localized label/value strings; this just joins them consistently. */
export function serializeControlPointTableForClipboard(
  rows: readonly { label: string; value: string }[],
): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}
