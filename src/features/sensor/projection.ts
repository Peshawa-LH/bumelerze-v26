import type { AccelerometerVector } from "./types";

/**
 * Fixed camera for the 3D view: the phone's own frame (x across the short
 * side, y up the long side, z out of the screen) turned so all three axes
 * read at once — a plain orthographic projection, no perspective, no 3D
 * library (the "boring, well-documented" rule). The angles never change
 * at runtime: a camera that moved would be one more thing jittering.
 */
export const VIEW_AZIMUTH_RAD = (-35 * Math.PI) / 180;
export const VIEW_ELEVATION_RAD = (24 * Math.PI) / 180;

export interface ScreenPoint {
  u: number;
  v: number;
}

/**
 * Projects a point in phone-frame units onto the drawing plane. `scale`
 * is pixels per unit; `cx`/`cy` is where the phone's centre lands.
 */
export function projectPoint(
  p: AccelerometerVector,
  scale: number,
  cx: number,
  cy: number,
): ScreenPoint {
  const cosA = Math.cos(VIEW_AZIMUTH_RAD);
  const sinA = Math.sin(VIEW_AZIMUTH_RAD);
  const cosE = Math.cos(VIEW_ELEVATION_RAD);
  const sinE = Math.sin(VIEW_ELEVATION_RAD);
  const x1 = p.x * cosA + p.z * sinA;
  const z1 = -p.x * sinA + p.z * cosA;
  const y2 = p.y * cosE - z1 * sinE;
  return { u: cx + x1 * scale, v: cy - y2 * scale };
}

/** Half-sizes of the phone slab drawn at the origin, in view units (the
 * same units the acceleration dot moves in: 1 unit = the view's half
 * span, so a shake stronger than ~a fifth of it leaves the phone). */
export const PHONE_HALF = { x: 0.22, y: 0.42, z: 0.025 } as const;

const CORNER_SIGNS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

/** The twelve edges of the slab as pairs of corner indices. */
export const PHONE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export function phoneCorners(): AccelerometerVector[] {
  return CORNER_SIGNS.map(([sx, sy, sz]) => ({
    x: sx * PHONE_HALF.x,
    y: sy * PHONE_HALF.y,
    z: sz * PHONE_HALF.z,
  }));
}

export function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
