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
 * could ship filled polygons directly.
 *
 * Since 2026-09-21 our own producer ships BOTH: `cont_mi.json` stays the
 * line product, and `bands_mi.json` carries closed `value >= level`
 * polygons WITH holes, which is what this app renders. The line product
 * cannot be filled correctly here and never could: a contour that leaves
 * the grid through its boundary is an open path, and closing it by
 * joining its last point back to its first draws a chord across open
 * space instead of walking the boundary. That is what broke the far field
 * of every map until the band product existed. `MultiLineString` is still
 * accepted, for USGS products and for any Atlas version published before
 * the change, but its rings are marked open and are stroked rather than
 * filled.
 *
 * A `MultiPolygon`'s interior rings are kept as `holes` so a band with a
 * low-intensity island in it lets the band below show through rather than
 * painting over it.
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

/** Twice a ring's signed area (the shoelace sum). Used only to rank rings
 * by how much of the map they cover, so the per-level cap drops the least
 * significant ones — point count, which this replaced, measures how
 * wiggly a ring is, not how big. */
function ringArea(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += points[j]![0] * points[i]![1] - points[i]![0] * points[j]![1];
  }
  return Math.abs(sum) / 2;
}

/** Rings implied by one feature's geometry — a `MultiLineString`'s lines
 * (open, stroke-only), or a `MultiPolygon`'s polygons with their holes
 * (closed, fillable). See the schema doc comment above. */
function ringsFromGeometry(
  geometry: z.infer<typeof contourGeometrySchema>,
): ContourRing[] {
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((points) => ({
      points,
      // A marching-squares path that ran off the edge of the producer's
      // grid. Nothing downstream can close it correctly, so it must not
      // be filled — `closed: false` is how the renderers know.
      closed: isClosedRing(points),
    }));
  }
  // MultiPolygon: coordinates is polygon[] -> ring[] -> point[]. Ring 0 is
  // the exterior, the rest are holes.
  return geometry.coordinates.flatMap((polygon) => {
    const [outerRing, ...holes] = polygon;
    if (!outerRing) {
      return [];
    }
    return [
      {
        points: outerRing,
        closed: true,
        holes: holes.filter((hole) => hole.length >= SHAKEMAP_MIN_RING_POINTS),
      },
    ];
  });
}

function isClosedRing(
  points: readonly (readonly [number, number])[],
): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1]
  );
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
      // keep the rings covering the most map AREA, drop the rest,
      // biggest-first. Ranking by point count instead (which this
      // replaced) kept whichever rings were wiggliest, so a long thread
      // of coastline detail displaced the compact block it wound around.
      rings: [...rings]
        .sort((a, b) => ringArea(b.points) - ringArea(a.points))
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
