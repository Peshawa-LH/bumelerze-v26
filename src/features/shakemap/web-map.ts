/**
 * Pure, MapLibre-API-free helpers for the web SHAKEmap renderer
 * (`components/ShakeMapView.web.tsx`) — GeoJSON feature-building, a theme-
 * ramp color `match` expression builder, and a bbox-to-`fitBounds` input
 * converter. Kept out of the component file so they're testable without
 * mocking `maplibre-gl`/the DOM at all (same "pure helper, thin glue"
 * split `map.web.tsx`'s own `primeTerrainAndLabelCache`/`findHillshade
 * BeforeLayerId` follow).
 */
import type { LonLatBoundingBox } from "./projection";
import type { ContourRing } from "./types";

/** One MapLibre source id / fill+line layer id pair per contour product —
 * two independent GeoJSON sources (never one shared source with a
 * discriminator property) so toggling one layer's visibility can never
 * accidentally touch the other's data. */
export const SHAKEMAP_WEB_INTENSITY_SOURCE_ID = "bumelerze-shakemap-intensity";
export const SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID = "bumelerze-shakemap-intensity-fill";
export const SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID = "bumelerze-shakemap-intensity-line";
export const SHAKEMAP_WEB_DAMAGE_SOURCE_ID = "bumelerze-shakemap-damage";
export const SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID = "bumelerze-shakemap-damage-fill";
export const SHAKEMAP_WEB_DAMAGE_LINE_LAYER_ID = "bumelerze-shakemap-damage-line";

/** Fallback color for a `level` outside the ramp's 1..N range — should
 * never actually paint (every real contour level comes from `mmiValueToLevel`/
 * `damageValueToLevel`, both already clamped), kept only so a `match`
 * expression is always well-formed even against a malformed level. */
const FALLBACK_RAMP_COLOR = "#999999";

export interface ContourLevelLike {
  value: number;
  level: number;
  rings: ContourRing[];
}

export interface ContourPolygonFeature {
  type: "Feature";
  properties: { level: number; value: number };
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
}

export interface ContourFeatureCollection {
  type: "FeatureCollection";
  features: ContourPolygonFeature[];
}

/** GeoJSON `Polygon` rings must be closed (first point === last point);
 * `ContourRing.points` is deliberately NOT guaranteed closed (`types.ts`'s
 * own doc comment — the SVG renderer relies on `react-native-svg`'s
 * `Polygon` auto-closing instead). Appends the first point again only when
 * it isn't already the last one, never duplicating an already-closed ring. */
function closeRing(points: readonly (readonly [number, number])[]): [number, number][] {
  const coords: [number, number][] = points.map(([lon, lat]) => [lon, lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coords.push([first[0], first[1]]);
  }
  return coords;
}

/**
 * One GeoJSON `Polygon` feature per contour RING (a level with multiple
 * rings becomes multiple same-`level` features) — mirrors the SVG
 * renderer's own one-`<Polygon>`-per-ring approach exactly, ring for ring,
 * so the two renderers show the same shapes.
 *
 * `levels` is sorted ascending by `value` first (defensive — every real
 * caller already hands this sorted, `contours.ts`/`risk.ts`'s own
 * contract) so a `fill`/`line` layer, which paints GeoJSON features in
 * SOURCE order, draws higher levels on top of lower ones — the same
 * z-ordering the SVG renderer gets for free from DOM paint order.
 * `SHAKEMAP_MAX_RINGS_PER_LEVEL` is already enforced upstream
 * (`contours.ts`'s own ring cap at parse time), so nothing further to cap
 * here.
 */
export function buildContourFeatureCollection(
  levels: readonly ContourLevelLike[],
): ContourFeatureCollection {
  const sorted = [...levels].sort((a, b) => a.value - b.value);
  const features: ContourPolygonFeature[] = [];
  for (const level of sorted) {
    for (const ring of level.rings) {
      if (ring.points.length < 3) {
        continue;
      }
      features.push({
        type: "Feature",
        properties: { level: level.level, value: level.value },
        geometry: { type: "Polygon", coordinates: [closeRing(ring.points)] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * `["match", ["get", "level"], 1, ramp[1], 2, ramp[2], ..., N, ramp[N],
 * fallback]` — a MapLibre data-driven `fill-color`/`line-color` paint
 * expression built from the SAME theme ramp array
 * (`colors.intensity`/`colors.damageGrade`) the SVG renderer's own
 * `rampColor` helper indexes into (`ShakeMapViewSvg.tsx`), so the two
 * renderers can never show a different color for the same level.
 * `maxLevel` is 12 for the MMI/EMS-98 ramp, 5 for the DG ramp — callers
 * pass their own ramp's real upper bound rather than this module guessing
 * it from array length (index 0 is always an unused placeholder,
 * `theme/palette.ts`'s own convention). The returned type is deliberately
 * `unknown[]`, not `maplibre-gl`'s own `ExpressionSpecification` — this
 * module has no `maplibre-gl` import at all (doc comment above), and
 * every real call site (`ShakeMapView.web.tsx`) hands this straight to a
 * `paint` property MapLibre itself validates at runtime.
 */
export function buildLevelColorMatchExpression(
  ramp: readonly string[],
  maxLevel: number,
): unknown[] {
  const fallback = ramp[1] ?? FALLBACK_RAMP_COLOR;
  const expression: unknown[] = ["match", ["get", "level"]];
  for (let level = 1; level <= maxLevel; level += 1) {
    expression.push(level, ramp[level] ?? fallback);
  }
  expression.push(fallback);
  return expression;
}

/** `LonLatBoundingBox` (`projection.ts`) -> MapLibre `fitBounds`'s own
 * `[[west, south], [east, north]]` tuple shape — mirrors `@/features/map`'s
 * `regionBboxToLngLatBounds` (a structurally different bbox shape, hence a
 * separate small converter rather than a shared one). */
export function contourBoundsToLngLatBounds(
  bbox: LonLatBoundingBox,
): [[number, number], [number, number]] {
  return [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
  ];
}
