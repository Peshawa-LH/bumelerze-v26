/** One of the three accelerometer axes. */
export type AxisKey = "x" | "y" | "z";

export interface AccelerometerVector {
  x: number;
  y: number;
  z: number;
}

/**
 * One accelerometer reading, values in g. `t` is a monotonic milliseconds
 * timestamp (`Date.now()`) captured when the sample was received by our
 * listener — not `expo-sensors`' own `AccelerometerMeasurement.timestamp`
 * field, which is platform-defined (seconds since an OS-specific reference)
 * and not safely comparable across iOS/Android. Using our own receipt time
 * keeps every downstream windowing/plotting calculation platform-agnostic.
 */
export interface SensorSample extends AccelerometerVector {
  t: number;
}

export type AxisVisibility = Record<AxisKey, boolean>;
