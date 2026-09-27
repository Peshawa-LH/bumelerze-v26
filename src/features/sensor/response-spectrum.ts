import type { AxisKey, SensorSample } from "./types";

/** Periods of the spectrum: log-spaced 0.05–4 s, 24 points — the range
 * building codes draw and a phone can resolve at ~50 Hz. */
export const SPECTRUM_PERIODS_S: readonly number[] = Array.from({ length: 24 }, (_, i) =>
  Number((0.05 * Math.pow(4 / 0.05, i / 23)).toFixed(4)),
);
/** 5 % of critical, the convention every code spectrum assumes. */
export const SPECTRUM_DAMPING = 0.05;
/** How often the hook recomputes the spectrum from the window. */
export const SPECTRUM_INTERVAL_MS = 500;

export interface ResponseSpectrum {
  periodsS: readonly number[];
  /** Pseudo-spectral acceleration per axis, in g, one value per period. */
  sa: Record<AxisKey, number[]>;
  /** Wall-clock time of the window's newest sample. */
  computedAt: number;
}

/**
 * Pseudo-acceleration response of a 5 %-damped single-degree-of-freedom
 * oscillator to the recorded ground acceleration, per axis: the same
 * quantity a design spectrum plots (Handbook, spectrum/). Newmark's
 * average-acceleration scheme (γ = ½, β = ¼), unconditionally stable, run
 * with the samples' own irregular time steps. Input and output in g.
 */
export function computeResponseSpectrum(
  samples: readonly SensorSample[],
  periodsS: readonly number[] = SPECTRUM_PERIODS_S,
  damping: number = SPECTRUM_DAMPING,
): ResponseSpectrum {
  const sa: Record<AxisKey, number[]> = { x: [], y: [], z: [] };
  const axes: AxisKey[] = ["x", "y", "z"];
  for (const period of periodsS) {
    const omega = (2 * Math.PI) / period;
    for (const axis of axes) {
      sa[axis].push(
        omega * omega * peakRelativeDisplacement(samples, axis, omega, damping),
      );
    }
  }
  const last = samples[samples.length - 1];
  return { periodsS, sa, computedAt: last ? last.t : 0 };
}

function peakRelativeDisplacement(
  samples: readonly SensorSample[],
  axis: AxisKey,
  omega: number,
  zeta: number,
): number {
  if (samples.length < 2) return 0;
  const gamma = 0.5;
  const beta = 0.25;
  const k = omega * omega;
  const c = 2 * zeta * omega;
  let u = 0;
  let v = 0;
  const first = samples[0];
  let a = -(first ? first[axis] : 0); // ü = −a_g − c·u̇ − k·u at rest
  let peak = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (!prev || !cur) continue;
    const dt = Math.min(Math.max((cur.t - prev.t) / 1000, 1e-3), 0.2);
    const p = -cur[axis];
    const kHat = k + (gamma / (beta * dt)) * c + 1 / (beta * dt * dt);
    const pHat =
      p +
      (1 / (beta * dt * dt)) * u +
      (1 / (beta * dt)) * v +
      (1 / (2 * beta) - 1) * a +
      c *
        ((gamma / (beta * dt)) * u +
          (gamma / beta - 1) * v +
          dt * (gamma / (2 * beta) - 1) * a);
    const uNext = pHat / kHat;
    const vNext =
      (gamma / (beta * dt)) * (uNext - u) +
      (1 - gamma / beta) * v +
      dt * (1 - gamma / (2 * beta)) * a;
    const aNext =
      (uNext - u) / (beta * dt * dt) - v / (beta * dt) - (1 / (2 * beta) - 1) * a;
    u = uNext;
    v = vNext;
    a = aNext;
    const abs = Math.abs(u);
    if (abs > peak) peak = abs;
  }
  return peak;
}
