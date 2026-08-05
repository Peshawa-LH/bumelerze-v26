import type { AccelerometerVector, SensorSample } from "./types";

/**
 * One-pole low-pass filter used to separate the slowly-changing gravity
 * component from the fast-changing linear-motion component of a raw
 * accelerometer reading — the standard approach from Android's own "Motion
 * sensors" developer guide (isolating gravity via a low-pass filter, and
 * linear acceleration as raw-minus-gravity). Each new gravity estimate is a
 * weighted blend of the previous estimate and the new raw sample:
 *
 *   gravity[i] = alpha * gravity[i-1] + (1 - alpha) * raw[i]
 *   linear[i]  = raw[i] - gravity[i]
 *
 * ALPHA = 0.8 is the constant used as a starting point in that guide; it
 * approximates a low cutoff so gravity (which changes slowly — only when
 * the phone's orientation changes) is tracked smoothly while faster shaking
 * mostly survives into the linear-acceleration remainder. It is a
 * well-documented default, not a value we've tuned against our own hardware
 * — "boring, well-documented" per PROJECT.md's gotcha about exotic signal
 * processing the owner would have to debug blind.
 */
export const GRAVITY_LOW_PASS_ALPHA = 0.8;

export class GravityFilter {
  private gravity: AccelerometerVector | null = null;

  constructor(private readonly alpha: number = GRAVITY_LOW_PASS_ALPHA) {}

  /**
   * Feeds one raw sample, returns the linear-acceleration component (raw
   * minus the current gravity estimate). The very first sample seeds the
   * gravity estimate with itself (linear = 0) instead of starting from
   * {0,0,0} — starting from zero would produce a large fake "shake" spike
   * on the first few samples while the filter settles, since a phone at
   * rest already reads ~1 g on whichever axis faces up.
   */
  apply(raw: AccelerometerVector): AccelerometerVector {
    if (!this.gravity) {
      this.gravity = { ...raw };
      return { x: 0, y: 0, z: 0 };
    }

    this.gravity = {
      x: this.alpha * this.gravity.x + (1 - this.alpha) * raw.x,
      y: this.alpha * this.gravity.y + (1 - this.alpha) * raw.y,
      z: this.alpha * this.gravity.z + (1 - this.alpha) * raw.z,
    };

    return {
      x: raw.x - this.gravity.x,
      y: raw.y - this.gravity.y,
      z: raw.z - this.gravity.z,
    };
  }

  reset(): void {
    this.gravity = null;
  }
}

/**
 * Runs a fresh `GravityFilter` across a chronological sample series and
 * returns the linear-acceleration trace. Re-seeding per call (rather than
 * keeping one filter alive across the sensor listener's whole lifetime)
 * keeps the "remove gravity" toggle a pure function of the currently
 * visible window: recomputed the same way on every render tick, with no
 * hidden state to reset when the toggle flips or the screen refocuses. The
 * first plotted point of the window is always exactly 0 g by construction —
 * a minor, honest artifact of that seeding, not a device reading.
 */
export function removeGravityFromSeries(
  samples: readonly SensorSample[],
): SensorSample[] {
  const filter = new GravityFilter();
  return samples.map((sample) => {
    const linear = filter.apply(sample);
    return { ...linear, t: sample.t };
  });
}
