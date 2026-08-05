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
 * Reduces a chronological sample array to at most `maxPoints` points by
 * picking evenly-spaced indices, always keeping the first and last sample so
 * the plotted trace still spans the full visible time window. This caps the
 * number of SVG polyline points redrawn on every throttled render tick — the
 * ring buffer already bounds memory, this bounds render cost.
 */
export function downsampleForPlot(
  samples: readonly SensorSample[],
  maxPoints: number,
): SensorSample[] {
  if (maxPoints <= 0) {
    throw new Error("maxPoints must be greater than 0");
  }
  if (samples.length <= maxPoints) {
    return [...samples];
  }
  if (maxPoints === 1) {
    const last = samples[samples.length - 1];
    return last ? [last] : [];
  }

  const result: SensorSample[] = [];
  const step = (samples.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.round(i * step);
    const sample = samples[index];
    if (sample) {
      result.push(sample);
    }
  }
  return result;
}
