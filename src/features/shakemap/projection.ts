import {
  SHAKEMAP_BBOX_MIN_PADDING_DEG,
  SHAKEMAP_BBOX_PADDING_RATIO,
} from "./config";
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
  const lonPad = Math.max(lonSpan * SHAKEMAP_BBOX_PADDING_RATIO, SHAKEMAP_BBOX_MIN_PADDING_DEG);
  const latPad = Math.max(latSpan * SHAKEMAP_BBOX_PADDING_RATIO, SHAKEMAP_BBOX_MIN_PADDING_DEG);

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
