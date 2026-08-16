/**
 * Geohash -> lat/lon bounding-box decoder — the exact inverse of
 * `src/lib/felt-aggregation/geohash.ts`'s `encodeGeohash` (standard base32
 * Niemeyer geohash, same alphabet, same lon-first bit interleave). Kept
 * local to `feltmap` rather than added to `felt-aggregation` because that
 * folder's own README declares a hard "pure CDI science, zero rendering
 * concerns" scope (Deno Edge Function portability constraint) — bounding-box
 * decoding is a rendering-geometry need, not aggregation science, so it
 * lives next to the renderer that actually needs it instead.
 */

const BASE32_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

export interface GeohashBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Decodes a geohash string to the lat/lon box it represents. Verified
 * against `encodeGeohash` via round-trip tests (`__tests__/geohash-bounds
 * .test.ts`): encoding a point and decoding the result always yields a box
 * that contains the original point.
 */
export function decodeGeohashBounds(geohash: string): GeohashBounds {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let isEvenBit = true; // same lon-first interleave as encodeGeohash

  for (const char of geohash.toLowerCase()) {
    const charIndex = BASE32_ALPHABET.indexOf(char);
    if (charIndex < 0) {
      // Not a valid geohash character — stop decoding further characters
      // rather than throwing; the bounds accumulated so far (from the
      // valid prefix) are returned as the best-effort result. Callers that
      // care about strict validity should validate upstream (this module
      // has no opinion on where a geohash string comes from).
      break;
    }
    for (let bit = 4; bit >= 0; bit--) {
      const bitValue = (charIndex >> bit) & 1;
      if (isEvenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (bitValue === 1) {
          lonMin = mid;
        } else {
          lonMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitValue === 1) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      isEvenBit = !isEvenBit;
    }
  }

  return { minLat: latMin, maxLat: latMax, minLon: lonMin, maxLon: lonMax };
}
