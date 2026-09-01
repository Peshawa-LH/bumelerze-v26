import { z } from "zod";

import { SHAKEMAP_MAX_RINGS_PER_LEVEL, SHAKEMAP_MIN_RING_POINTS } from "./config";
import { mmiValueToLevel } from "./intensity-ramp";
import type { ContourRing, IntensityContourSet } from "./types";

/**
 * Tolerant zod schemas for USGS `download/cont_mi.json` — a GeoJSON
 * `FeatureCollection` of MMI isolines. Real USGS output is
 * `MultiLineString` (see fixture README: every ring in the Halabja fixture
 * came from real `MultiLineString` coordinates); `MultiPolygon` is
 * accepted too since D9's contract is producer-agnostic and a future
 * `bumelerze-engine` output — or a different USGS product vintage —
 * could ship filled polygons directly. For `MultiPolygon`, only each
 * polygon's OUTER ring (coordinates[0]) is kept — interior holes are
 * dropped. This is a deliberate simplification for this wave's renderer
 * (which fills whole rings as flat color bands, see `ShakeMapView.tsx`'s
 * top-of-file tradeoff comment): a hole would need to render as a
 * cutout, which the simple "paint each ring in ascending value order"
 * approach below doesn't support. Revisit if/when a producer's contours
 * actually carry meaningful holes.
 */
const lonLatTuple = z.tuple([z.number(), z.number()]);

const multiLineStringGeometrySchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(lonLatTuple)),
});

const multiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(lonLatTuple))),
});

const contourGeometrySchema = z.union([
  multiLineStringGeometrySchema,
  multiPolygonGeometrySchema,
]);

const contourFeaturePropertiesSchema = z.object({
  value: z.number(),
});

const contourFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: contourFeaturePropertiesSchema,
  geometry: contourGeometrySchema,
});

const contourFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

/** Rings implied by one feature's geometry — a `MultiLineString`'s lines
 * directly, or a `MultiPolygon`'s outer rings only (see schema doc
 * comment above). */
function ringsFromGeometry(
  geometry: z.infer<typeof contourGeometrySchema>,
): ContourRing[] {
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((points) => ({ points }));
  }
  // MultiPolygon: coordinates is polygon[] -> ring[] -> point[]; take each
  // polygon's first (outer) ring only.
  return geometry.coordinates.flatMap((polygon) => {
    const outerRing = polygon[0];
    return outerRing ? [{ points: outerRing }] : [];
  });
}

/** One value's worth of rings, before a ramp-index is assigned — the
 * shared shape `extractContourLevels` below returns, and both
 * `parseIntensityContours` (MMI ramp) and `risk.ts`'s
 * `parseDamageContours` (DG ramp) map to their own `level` field from. */
export interface RawContourLevel {
  value: number;
  rings: ContourRing[];
}

export interface ExtractedContourLevels {
  levels: RawContourLevel[];
  skippedCount: number;
}

/**
 * Shared GeoJSON contour-collection parsing (rings only, no ramp-index
 * assignment) — the actual product-shape logic USGS-shaped `cont_mi.json`
 * and `bumelerze-engine`'s own `cont_damage.json` both share (D9's
 * "producer-agnostic" contract generalizes across products too: both are
 * `FeatureCollection`s of `{properties.value, geometry}` isolines, only the
 * MEANING of `value` differs — MMI intensity vs. expected damage grade).
 * Tolerant per-feature parsing (malformed features are skipped and
 * counted, never thrown — same convention as `features/events/usgs.ts`); a
 * top-level payload that isn't even a `FeatureCollection` still throws,
 * since there's nothing tolerant to do with a response that isn't the
 * expected shape at all — callers that need to treat that as "product
 * absent" (an optional risk product) catch it themselves; `parseIntensity
 * Contours` below does not, matching its existing "always-present, must
 * parse" contract.
 *
 * Levels are always returned sorted ASCENDING by value, regardless of
 * source order — `ShakeMapView` relies on this to paint higher values last
 * (on top).
 */
export function extractContourLevels(payload: unknown): ExtractedContourLevels {
  const collection = contourFeatureCollectionSchema.parse(payload);

  const byLevel = new Map<number, { value: number; rings: ContourRing[] }>();
  let skippedCount = 0;

  for (const rawFeature of collection.features) {
    const parsed = contourFeatureSchema.safeParse(rawFeature);
    if (!parsed.success) {
      skippedCount += 1;
      continue;
    }

    const { value } = parsed.data.properties;
    const rings = ringsFromGeometry(parsed.data.geometry).filter(
      (ring) => ring.points.length >= SHAKEMAP_MIN_RING_POINTS,
    );
    if (rings.length === 0) {
      continue;
    }

    const existing = byLevel.get(value);
    if (existing) {
      existing.rings.push(...rings);
    } else {
      byLevel.set(value, { value, rings });
    }
  }

  const levels: RawContourLevel[] = Array.from(byLevel.values())
    .sort((a, b) => a.value - b.value)
    .map(({ value, rings }) => ({
      value,
      // Perf guard (PROJECT.md: low-end Android is the baseline device) —
      // keep the largest (most area-significant) rings, drop small
      // fragments beyond the cap, biggest-first.
      rings: [...rings]
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, SHAKEMAP_MAX_RINGS_PER_LEVEL),
    }));

  return { levels, skippedCount };
}

/**
 * Parses a `cont_mi.json` payload (already fetched) into the internal,
 * producer-agnostic `IntensityContourSet` (D9) — `extractContourLevels`
 * above plus the MMI/EMS-98 ramp-index assignment (`mmiValueToLevel`).
 */
export function parseIntensityContours(payload: unknown): IntensityContourSet {
  const { levels, skippedCount } = extractContourLevels(payload);
  return {
    levels: levels.map(({ value, rings }) => ({
      value,
      level: mmiValueToLevel(value),
      rings,
    })),
    skippedCount,
  };
}
