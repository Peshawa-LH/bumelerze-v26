import { z } from "zod";

import { SHAKEMAP_MAX_RINGS_PER_LEVEL, SHAKEMAP_MIN_RING_POINTS } from "./config";
import { mmiValueToLevel } from "./intensity-ramp";
import type { ContourRing, IntensityContourLevel, IntensityContourSet } from "./types";

/**
 * Tolerant zod schemas for USGS `download/cont_mi.json` — a GeoJSON
 * `FeatureCollection` of MMI isolines. Real USGS output is
 * `MultiLineString` (see fixture README: every ring in the Halabja fixture
 * came from real `MultiLineString` coordinates); `MultiPolygon` is
 * accepted too since D9's contract is producer-agnostic and a future
 * `bumelerze-shake-service` output — or a different USGS product vintage —
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

/**
 * Parses a `cont_mi.json` payload (already fetched) into the internal,
 * producer-agnostic `IntensityContourSet` (D9). Tolerant per-feature
 * parsing (malformed features are skipped and counted, never thrown —
 * same convention as `features/events/usgs.ts`); a top-level payload that
 * isn't even a `FeatureCollection` still throws, since there's nothing
 * tolerant to do with a response that isn't the expected shape at all.
 *
 * Levels are always returned sorted ASCENDING by MMI value, regardless of
 * source order — `ShakeMapView` relies on this to paint higher intensities
 * last (on top).
 */
export function parseIntensityContours(payload: unknown): IntensityContourSet {
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

  const levels: IntensityContourLevel[] = Array.from(byLevel.values())
    .sort((a, b) => a.value - b.value)
    .map(({ value, rings }) => ({
      value,
      level: mmiValueToLevel(value),
      // Perf guard (PROJECT.md: low-end Android is the baseline device) —
      // keep the largest (most area-significant) rings, drop small
      // fragments beyond the cap, biggest-first.
      rings: [...rings]
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, SHAKEMAP_MAX_RINGS_PER_LEVEL),
    }));

  return { levels, skippedCount };
}
