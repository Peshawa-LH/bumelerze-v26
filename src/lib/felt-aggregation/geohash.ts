/**
 * Hand-rolled geohash encoder — no dependency (deliberately; see the
 * portability note in `index.ts`/`README.md`: this whole folder must run
 * unchanged inside a Supabase Edge Function, i.e. Deno, later).
 *
 * Standard base32 interleave algorithm (Niemeyer geohash, the same one every
 * `geohash`/`ngeohash` npm package implements) — bit-halves the lon/lat
 * ranges alternately (lon first), 5 bits per output character, alphabet
 * excludes `a, i, l, o` to avoid confusion with `4, 1, 1, 0`.
 *
 * Precision (felt-report-science-v1.md §3.1, D18 R12): p4 ≈ 39×19.5 km rural
 * rollup, p5 ≈ 4.9×4.9 km base display/CDI cell, p6 ≈ 1.2×0.6 km city
 * refinement (computed additionally when a p5 cell holds ≥20 reports). The
 * function itself is general (any precision ≥1); the app only ever asks for
 * 4/5/6.
 */

const BASE32_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Encodes a lat/lon pair to a geohash string of the given character
 * `precision`.
 *
 * Verified against the canonical geohash.org example
 * (57.64911, 10.40744 → "u4pruydqqvj...") — see `__tests__/geohash.test.ts`.
 */
export function encodeGeohash(lat: number, lon: number, precision: number): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let isEvenBit = true; // interleave starts on longitude, per the standard algorithm
  let bitIndex = 0;
  let charCode = 0;
  let geohash = "";

  while (geohash.length < precision) {
    if (isEvenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        charCode |= 1 << (4 - bitIndex);
        lonMin = mid;
      } else {
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        charCode |= 1 << (4 - bitIndex);
        latMin = mid;
      } else {
        latMax = mid;
      }
    }
    isEvenBit = !isEvenBit;

    if (bitIndex < 4) {
      bitIndex++;
    } else {
      // `charCode` is always 0-31 here (5 bits accumulated), so `charAt`
      // never returns "" — using `charAt` (not `[]`) sidesteps
      // `noUncheckedIndexedAccess` without a non-null assertion.
      geohash += BASE32_ALPHABET.charAt(charCode);
      bitIndex = 0;
      charCode = 0;
    }
  }

  return geohash;
}
