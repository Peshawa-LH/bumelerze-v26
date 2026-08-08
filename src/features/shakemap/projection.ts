import { SHAKEMAP_BBOX_MIN_PADDING_DEG, SHAKEMAP_BBOX_PADDING_RATIO } from "./config";
import type { IntensityContourLevel } from "./types";

export interface LonLatBoundingBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

/**
 * Bounding box around every contour ring's points (plus any extra points
 * the caller wants guaranteed inside it — `ShakeMapView` passes the
 * epicenter, since a product's contours could in principle not fully
 * enclose it), padded outward so the outermost ring never touches the SVG
 * edge. Padding is a ratio of the raw span, with a fixed-degree floor for
 * the degenerate single-point case (ratio-of-zero would otherwise pad by
 * nothing at all).
 */
export function computeContourBoundingBox(
  levels: readonly IntensityContourLevel[],
  extraPoints: readonly (readonly [number, number])[] = [],
): LonLatBoundingBox {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const level of levels) {
    for (const ring of level.rings) {
      for (const [lon, lat] of ring.points) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  for (const [lon, lat] of extraPoints) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (!Number.isFinite(minLon)) {
    // No points at all (empty contour set and no extra points either) —
    // an arbitrary-but-valid degenerate box around 0,0 so callers never
    // have to special-case Infinity.
    return { minLon: -1, maxLon: 1, minLat: -1, maxLat: 1 };
  }

  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const lonPad = Math.max(
    lonSpan * SHAKEMAP_BBOX_PADDING_RATIO,
    SHAKEMAP_BBOX_MIN_PADDING_DEG,
  );
  const latPad = Math.max(
    latSpan * SHAKEMAP_BBOX_PADDING_RATIO,
    SHAKEMAP_BBOX_MIN_PADDING_DEG,
  );

  return {
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
  };
}

export interface Projector {
  project(lon: number, lat: number): ProjectedPoint;
}

/** Liang-Barsky segment-vs-rectangle clip: returns the `[t0, t1]` parameter
 * range (0..1 along the segment) that lies inside `bbox`, or `null` if the
 * segment never enters it at all. Standard algorithm, four half-plane
 * checks (one per bbox edge) narrowing the surviving parameter interval. */
function clipSegmentToBbox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bbox: LonLatBoundingBox,
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges: [number, number][] = [
    [-dx, x0 - bbox.minLon],
    [dx, bbox.maxLon - x0],
    [-dy, y0 - bbox.minLat],
    [dy, bbox.maxLat - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0, t1];
}

/**
 * Clips one basemap polyline (`basemap.ts`'s `BasemapLine`, `[lon, lat]`
 * points) against `bbox` — the map's own contour bbox, always far smaller
 * than the whole basemap fixture's ~20-country coverage — so `ShakeMapView`
 * only ever projects and draws the handful of points actually inside its
 * current viewBox (wave brief point 2: "clip boundary lines to the
 * viewBox"). A line that exits and re-enters the box comes back as multiple
 * separate polylines rather than one that jumps across the gap; a line that
 * never touches the box at all comes back as an empty array.
 */
export function clipLineToBbox(
  points: BasemapLike,
  bbox: LonLatBoundingBox,
): (readonly [number, number])[][] {
  const result: (readonly [number, number])[][] = [];
  let current: [number, number][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const [x0, y0] = a;
    const [x1, y1] = b;
    const clipped = clipSegmentToBbox(x0, y0, x1, y1, bbox);
    if (!clipped) {
      if (current.length > 1) result.push(current);
      current = [];
      continue;
    }
    const [t0, t1] = clipped;
    const p0: [number, number] = [x0 + t0 * (x1 - x0), y0 + t0 * (y1 - y0)];
    const p1: [number, number] = [x0 + t1 * (x1 - x0), y0 + t1 * (y1 - y0)];
    if (current.length === 0) {
      current.push(p0);
    }
    current.push(p1);
    if (t1 < 1) {
      // The segment exited the box before reaching its own endpoint —
      // break the chain here so the next surviving piece starts fresh.
      result.push(current);
      current = [];
    }
  }
  if (current.length > 1) result.push(current);
  return result;
}

/** Minimal structural type for a basemap polyline — kept local (rather than
 * importing `BasemapLine` from `../basemap/basemap`) so this projection
 * module has no dependency on the basemap fixture, only the reverse. */
type BasemapLike = readonly (readonly [number, number])[];

/**
 * Equirectangular projector, longitude-corrected by `cos(midLat)` so a
 * bounding box near Kurdistan's ~33-39°N latitude band doesn't visibly
 * stretch east-west (a naive equirectangular plot without this correction
 * measurably distorts at this latitude). Scales to CONTAIN `bbox` within
 * `viewport` (letterboxing whichever axis has slack) and centers it —
 * never crops either axis.
 */
export function createEquirectangularProjector(
  bbox: LonLatBoundingBox,
  viewport: Viewport,
): Projector {
  const midLatRad = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180);
  const lonCorrection = Math.cos(midLatRad);

  const projectedLonSpan = (bbox.maxLon - bbox.minLon) * lonCorrection;
  const latSpan = bbox.maxLat - bbox.minLat;

  // Degenerate spans (a single point, or a corrected span of exactly 0)
  // fall back to 1 so scale computation never divides by zero.
  const safeLonSpan = projectedLonSpan > 0 ? projectedLonSpan : 1;
  const safeLatSpan = latSpan > 0 ? latSpan : 1;

  const scale = Math.min(viewport.width / safeLonSpan, viewport.height / safeLatSpan);

  const drawnWidth = safeLonSpan * scale;
  const drawnHeight = safeLatSpan * scale;
  const offsetX = (viewport.width - drawnWidth) / 2;
  const offsetY = (viewport.height - drawnHeight) / 2;

  return {
    project(lon: number, lat: number): ProjectedPoint {
      const x = offsetX + (lon - bbox.minLon) * lonCorrection * scale;
      // Screen y grows downward; latitude grows northward — flip so north
      // renders at the top.
      const y = offsetY + (bbox.maxLat - lat) * scale;
      return { x, y };
    },
  };
}
