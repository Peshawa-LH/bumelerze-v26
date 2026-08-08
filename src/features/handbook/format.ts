import type { TFunction } from "i18next";

import { formatCoordinates, formatDistanceKm, isolateNumeric } from "@/features/events";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";
import type { HandbookLookupResult, SoilMethod } from "./types";

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

export function formatVs30Value(vs30MS: number, locale: string, t: TranslateFn): string {
  return t("handbook.rows.vs30.value", {
    value: isolateNumeric(localizeDigits(String(Math.round(vs30MS)), locale)),
  });
}

export function formatVs30EstimateLine(
  vs30EstimateMS: number,
  locale: string,
  t: TranslateFn,
): string {
  return t("handbook.rows.soil.vs30EstimateLine", {
    value: isolateNumeric(localizeDigits(String(Math.round(vs30EstimateMS)), locale)),
  });
}

export function formatSoilDistance(distanceKm: number, locale: string, t: TranslateFn): string {
  return t("handbook.rows.soil.distance", {
    distance: isolateNumeric(formatDistanceKm(distanceKm, locale)),
  });
}

export function formatSiteClassValue(
  ec8: string,
  nehrp: string,
  t: TranslateFn,
): string {
  return t("handbook.rows.siteClass.value", { ec8, nehrp });
}

export function formatSoilClassLine(ec8: string | null, nehrp: string | null, t: TranslateFn): string | null {
  if (ec8 === null && nehrp === null) {
    return null;
  }
  return t("handbook.rows.soil.classLine", { ec8: ec8 ?? "—", nehrp: nehrp ?? "—" });
}

export function formatSoilMethodLabel(method: SoilMethod, t: TranslateFn): string {
  return t(`handbook.methods.${method}`);
}
