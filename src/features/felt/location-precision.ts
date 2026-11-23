/**
 * Felt report locations are stored at about 100 m (security audit PRIV-03,
 * migration 0083): every use downstream is a map cell of 1.2 km or more, so
 * the app never sends, or keeps in its queue, a finer position. The server
 * rounds the same way for older app versions.
 */
export const FELT_LOCATION_DECIMALS = 3;

const FACTOR = 10 ** FELT_LOCATION_DECIMALS;

/** A coordinate rounded to 0.001 degrees (about 100 m). */
export function roundFeltCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;
  // toFixed avoids 36.1915 * 1000 style float errors; Number() drops "-0"
  const rounded = Number(
    (Math.round(value * FACTOR) / FACTOR).toFixed(FELT_LOCATION_DECIMALS),
  );
  return Object.is(rounded, -0) ? 0 : rounded;
}
