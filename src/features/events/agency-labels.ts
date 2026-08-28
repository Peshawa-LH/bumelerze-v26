/**
 * Display labels for the agency codes that come back from
 * `public.events_with_sources`.
 *
 * The registry stores what each feed reports as the authoring agency, and
 * those are raw network codes: USGS reports itself as `US`, GFZ as `GFZ`.
 * Rendered unmapped, the same organisation appeared as "US" on a
 * corroborated card and "USGS" on every other one, which reads as two
 * different sources rather than one (spotted in a screenshot, 2026-08-28).
 *
 * These are proper nouns and are deliberately NOT translated (owner rule:
 * agency names stay as-is in every locale); this is a code-to-name map, not
 * an i18n catalogue. Unknown codes fall through unchanged, which is the
 * right default: a new agency shows its real code rather than vanishing,
 * and the fix is to add a line here.
 */
const AGENCY_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  // Global and regional agencies we already ingest.
  US: "USGS",
  NEIC: "USGS",
  GFZ: "GEOFON",
  CSEM: "EMSC",
  EMSC: "EMSC",
  ISC: "ISC",
  IDC: "IDC",
  // Agencies the ISC bulletin brings in for our region.
  ISN: "ISN",
  ISK: "Kandilli",
  AFAD: "AFAD",
  TEH: "Tehran Univ.",
  THR: "IIEES",
  AZER: "RSSC",
  RSSC: "RSSC",
  KISC: "KISC",
};

export function agencyDisplayLabel(code: string): string {
  return AGENCY_DISPLAY_LABELS[code] ?? code;
}
