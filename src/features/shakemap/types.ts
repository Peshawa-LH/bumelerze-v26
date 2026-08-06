/**
 * Product-shaped ShakeMap contract (D9): the app has ONE internal model for
 * "a ShakeMap product", regardless of producer — USGS today, our own
 * `bumelerze-shake-service` later (extracted from SHAKEmaps-Toolkit-v26).
 * `usgs-products.ts` is the only module that knows USGS's `contents`/
 * `properties` field names; everything past it reads `ShakeMapProduct`.
 */
export interface ShakeMapProduct {
  /** Producer network code for the CITED product, uppercased (USGS
   * `source` on the shakemap product itself, e.g. "ATLAS" or "US" — a
   * single event can carry more than one competing shakemap product from
   * different sources; this identifies the one actually shown). */
  network: string;
  /** Product version number (USGS `properties.version`, string in the
   * source payload, parsed to a number here). */
  version: number;
  /** Product update time, UTC ms (USGS `updateTime` on the product). */
  updateTime: number;
  /** `download/cont_mi.json` URL — the MMI contour GeoJSON this feature
   * renders. */
  contoursUrl: string;
  /** `download/info.json` URL, captured for provenance/future use. Not
   * fetched or parsed this wave (see `usgs-products.ts` doc comment) — the
   * one-line citation in Event Detail is built from `network`/`version`/
   * `updateTime` alone. */
  infoUrl: string | null;
}

/** One MMI contour ring: a sequence of `[lon, lat]` points (GeoJSON
 * coordinate order preserved end to end so `projection.ts` never has to
 * remember which axis is which). Never assumed closed — `ShakeMapView`
 * relies on SVG `Polygon`'s own auto-close behavior rather than requiring
 * `points[0] === points[last]`. */
export interface ContourRing {
  points: readonly (readonly [number, number])[];
}

/** All rings sharing one MMI value, plus the ramp-index this value maps to
 * (`level`, 1..12 — see `intensity-ramp.ts`). */
export interface IntensityContourLevel {
  /** Raw MMI value as reported by the product — may be fractional (USGS
   * `cont_mi.json` commonly emits half-integer levels like 4.5). */
  value: number;
  /** `value` rounded and clamped to the EMS-98/MMI ramp's 1..12 index
   * range (D7) — the index into `theme.colors.intensity`. */
  level: number;
  rings: ContourRing[];
}

/** Producer-agnostic parsed contour product (D9: "our service exports the
 * same shape" later). Always sorted ascending by `value` so a renderer that
 * simply iterates and paints in order gets correct z-ordering (higher
 * intensities paint last, on top of lower ones) for free. */
export interface IntensityContourSet {
  levels: IntensityContourLevel[];
  /** Count of contour features present in the source payload that failed
   * schema validation and were skipped — tolerant-parsing bookkeeping,
   * same convention as `events/usgs.ts`'s `skippedCount`. */
  skippedCount: number;
}
