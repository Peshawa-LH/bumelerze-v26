import {
  ALERT_BONUS,
  REGION_BBOX,
  SIGNIFICANCE_THRESHOLDS,
} from "./config";
import type { UsgsFeature } from "./usgs-schema";
import type { Event } from "./types";

/** True when a point falls inside the region bbox (event-pipeline-design.md
 * §4). Pure function, kept separate from normalization so distance/UI code
 * can reuse it without re-normalizing an event. */
export function isInRegionBbox(lat: number, lon: number): boolean {
  return (
    lat >= REGION_BBOX.minLat &&
    lat <= REGION_BBOX.maxLat &&
    lon >= REGION_BBOX.minLon &&
    lon <= REGION_BBOX.maxLon
  );
}

/**
 * Client-side significance score, event-pipeline-design.md §3:
 *   sig = round(100*M + felt_term + alert_bonus)
 * felt_term is our OWN felt-report count, saturating at 60*log10(1+n),
 * capped at 200. Our felt-report system doesn't exist yet (that's Phase 2),
 * so felt_term is hard-pinned to 0 here — NOT a stand-in for USGS's own
 * `felt`/`cdi` fields, which we deliberately never fold into our score
 * (D8 "our felt dataset is ours"). Revisit this function once Phase 2 wires
 * real felt-report counts per event.
 */
const FELT_TERM_PHASE_1 = 0;

export function computeClientSig(
  magnitudeValue: number,
  alert: string | null | undefined,
): number {
  const alertBonus = alert ? (ALERT_BONUS[alert] ?? 0) : 0;
  return Math.round(100 * magnitudeValue + FELT_TERM_PHASE_1 + alertBonus);
}

/** event-pipeline-design.md §3 classification — region-significant requires
 * both the bbox flag AND the sig threshold. */
export function isRegionSignificant(event: Event): boolean {
  return event.isRegional && event.sig >= SIGNIFICANCE_THRESHOLDS.regionSignificant;
}

export function isWorldSignificant(event: Event): boolean {
  return event.sig >= SIGNIFICANCE_THRESHOLDS.worldSignificant;
}

/**
 * USGS GeoJSON feature -> internal Event. This is the ONLY place USGS field
 * names may appear outside `usgs.ts`/`usgs-schema.ts` (PROJECT.md gotcha). A
 * future `normalizeEmscFeature` lives beside this one and produces the
 * exact same `Event` shape.
 *
 * Returns `null` for a structurally-valid-but-unusable feature (e.g. a
 * placeholder magnitude of `null`, which USGS emits for not-yet-reviewed
 * events) rather than throwing — callers count and skip these, never crash
 * (tolerant-parsing requirement, wave brief).
 */
export function normalizeUsgsFeature(
  feature: UsgsFeature,
  fetchedAt: number,
): Event | null {
  const { properties, geometry, id } = feature;
  const [lon, lat, depthKm] = geometry.coordinates;

  // USGS emits `mag: null` for events pending review — not yet usable.
  if (properties.mag === null) {
    return null;
  }

  const providerId = properties.ids
    ? properties.ids.split(",").find((entry) => entry.length > 0) ?? id
    : id;

  const event: Event = {
    id,
    originTime: properties.time,
    lat,
    lon,
    depthKm,
    magnitude: {
      value: properties.mag,
      type: properties.magType ?? "unknown",
    },
    placeName: properties.place ?? "",
    provenance: {
      provider: "usgs",
      providerId,
      fetchedAt,
      providerUpdatedAt: properties.updated,
    },
    sig: computeClientSig(properties.mag, properties.alert),
    isRegional: isInRegionBbox(lat, lon),
    url: properties.url ?? "",
  };

  return event;
}
