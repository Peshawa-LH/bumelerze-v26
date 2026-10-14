import type { TFunction } from "i18next";

import {
  formatAbsoluteDual,
  formatCoordinates,
  formatDateOnly,
  formatDepthKm,
  formatMagnitudeValue,
  isolateNumeric,
} from "@/features/events";
import { placeLine } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import type { CatalogRow } from "./types";

type TranslateFn = TFunction;

/** Row/detail-sheet formatting for the Catalog browser — thin composition
 * of the same scientific-formatting primitives the live feed and event
 * detail already use (`features/events/format.ts`, `features/geo`), never
 * reimplementing digit localization or magnitude/coordinate rounding here
 * (PROJECT.md: "one module owns scientific formatting"). */

export function formatCatalogYear(year: number, locale: string): string {
  return localizeDigits(String(year), locale);
}

/**
 * "M {{value}}" for every row. The value is the homogenised Mw wherever the
 * catalog has one (native or Onur et al. 2017 from ML/mb/MD) and the
 * agency's own magnitude otherwise. The distinction stays INTERNAL: the
 * owner (2026-09-27, on feedback 038081da) — "we keep M; this Mw is just an
 * internal thing, it doesn't really affect the end app". So no "ML"/"mb"
 * prefixes and no conversion wording on screen; `mwMethod` remains in the
 * row for anything that needs to know.
 */
export function formatCatalogMagnitude(
  row: Pick<CatalogRow, "mag" | "mwDerived">,
  locale: string,
  t: TranslateFn,
): string {
  return t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(row.mwDerived ?? row.mag, locale),
  });
}

/** Localized place line, the same `placeLine` rule every other surface uses
 * (D28): a gazetteer near-field line close to Kurdistan, otherwise the
 * translated Flinn-Engdahl region of the epicentre. The catalog's stored
 * per-agency `region` strings are deliberately NOT used here: they are
 * provider text in mixed spellings, and the same epicentre must carry the
 * same name in the catalog, the live feed and the event detail. */
export function formatCatalogPlace(
  row: Pick<CatalogRow, "lat" | "lon">,
  locale: string,
  t: TranslateFn,
): string {
  return placeLine({ lat: row.lat, lon: row.lon }, locale, t);
}

/** Depth numeral + localized unit, isolated for safe embedding in an RTL
 * sentence — same composition `event/[id].tsx` uses. Returns `null` when
 * the merged record has no depth (build script leaves 8 events without one
 * — see BUILD_REPORT.md), so callers can render an em dash or omit the row. */
export function formatCatalogDepth(
  row: Pick<CatalogRow, "depthKm">,
  locale: string,
  t: TranslateFn,
): string | null {
  if (row.depthKm === null) {
    return null;
  }
  return isolateNumeric(`${formatDepthKm(row.depthKm, locale)} ${t("units.km")}`);
}

/** Full UTC date+time for the detail sheet in the SAME medium style as the
 * event page's Time section ("Nov 12, 2017, 6:18 PM UTC"; Sorani with its
 * own month names and before/after-noon tokens) — one date style for one
 * app (A-12). Only UTC, never a local time: every catalog event's local
 * zone at the time of occurrence is ambiguous for decades-old records, so
 * the one unambiguous value is shown.
 *
 * `epochSeconds` is the db's `t` column (schema v3) — SECONDS, not
 * milliseconds, hence the `* 1000` below. Negative values (events before
 * 1970; this catalog starts in 872) are valid `Date` inputs and format
 * correctly with no special-casing — `Date` and `Intl.DateTimeFormat` both
 * support the full proleptic Gregorian range this needs. */
export function formatCatalogDateTimeUtc(
  epochSeconds: number,
  locale: string,
  t: TranslateFn,
): string {
  return formatAbsoluteDual(epochSeconds * 1000, locale, t).utc;
}

/** The calendar date (UTC) for a list row — "Nov 12, 2017" rather than the
 * bare year the rows used to show (A-23), in the same per-locale template
 * the rest of the app uses for a date without a time. */
export function formatCatalogDate(epochSeconds: number, locale: string, t: TranslateFn): string {
  return formatDateOnly(epochSeconds * 1000, locale, t, "UTC");
}

export function formatCatalogCoordinates(
  row: Pick<CatalogRow, "lat" | "lon">,
  locale: string,
): string {
  return formatCoordinates(row.lat, row.lon, locale);
}
