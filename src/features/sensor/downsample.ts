import type { SensorSample } from "./types";

/**
 * Keeps only samples within `windowMs` of `now`, preserving order. Applied
 * before downsampling so the visible window is always time-accurate even
 * when the real device delivers samples at a variable rate (see the Android
 * caveat in constants.ts) — a count-based window would show a different
 * amount of wall-clock time on different devices, a time-based one doesn't.
 */
export function selectWindow(
  samples: readonly SensorSample[],
  now: number,
  windowMs: number,
): SensorSample[] {
  const cutoff = now - windowMs;
  return samples.filter((sample) => sample.t >= cutoff);
}

/**
 * Averages samples into fixed bins of `binMs` on ABSOLUTE time (bin k covers
 * `[k*binMs, (k+1)*binMs)`), one plotted point per bin at the bin's centre.
 * This is what keeps the trace still: the earlier version picked every
 * Nth sample by index, so each new sample shifted which samples were drawn
 * and, with shaking at a few hertz, every frame showed a different subset
 * of the same wave — the line's shape flickered while the data did not.
 * Bins anchored to the clock draw the same points frame after frame; only
 * the newest bin changes. The mean of the two or three samples a bin holds
 * at phone rates barely touches a shake at a few hertz.
 */
export function binForPlot(
  samples: readonly SensorSample[],
  binMs: number,
): SensorSample[] {
  if (binMs <= 0) {
    throw new Error("binMs must be greater than 0");
  }
  const result: SensorSample[] = [];
  let bin = Number.NaN;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const flush = () => {
    if (n > 0) {
      result.push({ t: (bin + 0.5) * binMs, x: sx / n, y: sy / n, z: sz / n });
    }
  };
  for (const sample of samples) {
    const k = Math.floor(sample.t / binMs);
    if (k !== bin) {
      flush();
      bin = k;
      n = 0;
      sx = 0;
      sy = 0;
      sz = 0;
    }
    n += 1;
    sx += sample.x;
    sy += sample.y;
    sz += sample.z;
  }
  flush();
  return result;
}
