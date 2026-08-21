import type { TFunction } from "i18next";

import { formatCoordinates, formatDistanceKm, isolateNumeric } from "@/features/events";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";
import { SOIL_NEARBY_RADIUS_KM, VS30_DISPLAY_PRECISION_MS } from "./config";
import type { HandbookLookupResult, NearbySoilPoint, SoilMethod } from "./types";

type TranslateFn = TFunction;

/** Row/screen formatting for the Engineer's Handbook — thin composition of
 * the same scientific-formatting primitives the rest of the app uses
 * (typescript-react-native.md "one module owns scientific formatting"),
 * never reimplementing digit localization or rounding here. */

export function formatHandbookResultsTitle(
  result: Pick<HandbookLookupResult, "lat" | "lon">,
  locale: string,
  t: TranslateFn,
): string {
  return t("handbook.resultsTitle", {
    lat: isolateNumeric(formatFixedLocalized(result.lat, 3, locale)),
    lon: isolateNumeric(formatFixedLocalized(result.lon, 3, locale)),
  });
}

export function formatHandbookCoordinates(lat: number, lon: number, locale: string): string {
  return formatCoordinates(lat, lon, locale);
}

/** "{{value}}g (Zone {{zone}})" — the Roman-numeral zone label is never
 * digit-localized (types.ts's doc comment: it's a cartographic symbol, not
 * a numeral). */
export function formatPgaValue(pgaG: number, zone: string, locale: string, t: TranslateFn): string {
  return t("handbook.rows.pga.value", {
    value: isolateNumeric(formatFixedLocalized(pgaG, 1, locale)),
    zone,
  });
}

/** Rounds to `VS30_DISPLAY_PRECISION_MS` before display (config.ts's doc
 * comment: the bundled grid is a coarse global topographic-slope proxy,
 * not a site measurement — nearest-1-m/s display would overstate what it
 * can support). */
export function formatVs30Value(vs30MS: number, locale: string, t: TranslateFn): string {
  const rounded = Math.round(vs30MS / VS30_DISPLAY_PRECISION_MS) * VS30_DISPLAY_PRECISION_MS;
  return t("handbook.rows.vs30.value", {
    value: isolateNumeric(localizeDigits(String(rounded), locale)),
  });
}

/** EC8 only (owner feedback 2026-08-21: the paired "EC8 X / NEHRP Y" line
 * was one more number than the compact table needs — NEHRP is still
 * computed by `site-class.ts` for any future caller, just not surfaced
 * here). */
export function formatSiteClassValue(ec8: string, t: TranslateFn): string {
  return t("handbook.rows.siteClass.value", { ec8 });
}

export function formatSoilMethodLabel(method: SoilMethod, t: TranslateFn): string {
  return t(`handbook.methods.${method}`);
}

/**
 * One-line summary of the nearest Sulaimani soil/site point (owner
 * feedback 2026-08-21: replaces the old per-point list, which rendered
 * every point within `SOIL_NEARBY_RADIUS_KM` — up to the full 303-point
 * dataset for a central-Sulaimani coordinate — as its own card). Shows the
 * method and distance plus the point's EC8 class only: a category drawn
 * from the field classification, never the point's numeric Vs30 estimate
 * (dropped entirely — see `HANDBOOK_DATA_REPORT.md` §3: the `hvsr` and
 * `dem-vs30` methods' numeral is the same DEM topographic proxy as the
 * bundled grid, just sampled at native resolution, and `spt-vs`'s is
 * `Vs5`, not `Vs30` — none of the three is a number this tool can put in
 * front of an engineer as if it were a 30 m in-situ measurement).
 */
export function formatNearestSoilPoint(
  nearest: NearbySoilPoint,
  locale: string,
  t: TranslateFn,
): string {
  const method = formatSoilMethodLabel(nearest.point.method, t);
  const distance = isolateNumeric(formatDistanceKm(nearest.distanceKm, locale));
  if (nearest.point.ec8 === null) {
    return t("handbook.rows.soil.nearestValueNoClass", { method, distance });
  }
  return t("handbook.rows.soil.nearestValue", { method, distance, ec8: nearest.point.ec8 });
}

/** "{{countText}} field points within {{radiusText}} km" — `count` is the
 * total number of points within radius (including the one summarized by
 * `formatNearestSoilPoint`), so the reader knows the single line shown is
 * a sample, not the whole picture.
 *
 * Both numerals go through `localizeDigits` + `isolateNumeric` like every
 * other numeral in this screen — interpolating the raw numbers instead
 * left them in Latin digits inside otherwise Eastern-Arabic-Indic Sorani
 * and Arabic sentences (caught in browser RTL verification, 2026-08-22).
 * The bare numeric `count` is still passed alongside so i18next can pick
 * a plural form from it. */
export function formatNearbySoilSummary(
  count: number,
  locale: string,
  t: TranslateFn,
): string {
  return t("handbook.rows.soil.sublabel", {
    count,
    countText: isolateNumeric(localizeDigits(String(count), locale)),
    radiusText: isolateNumeric(localizeDigits(String(SOIL_NEARBY_RADIUS_KM), locale)),
  });
}
