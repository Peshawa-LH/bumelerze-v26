import { computeResponseSpectrum, SPECTRUM_PERIODS_S } from "../response-spectrum";
import type { SensorSample } from "../types";

function harmonic(
  freqHz: number,
  amplitudeG: number,
  seconds: number,
  sps = 50,
): SensorSample[] {
  const out: SensorSample[] = [];
  for (let i = 0; i < seconds * sps; i += 1) {
    const t = i / sps;
    out.push({
      t: 1_000_000 + t * 1000,
      x: amplitudeG * Math.sin(2 * Math.PI * freqHz * t),
      y: 0,
      z: 0,
    });
  }
  return out;
}

describe("computeResponseSpectrum", () => {
  it("is zero for a phone at rest", () => {
    const rest = Array.from({ length: 200 }, (_, i) => ({
      t: 1000 + i * 20,
      x: 0,
      y: 0,
      z: 0,
    }));
    const s = computeResponseSpectrum(rest);
    expect(s.periodsS).toBe(SPECTRUM_PERIODS_S);
    expect(Math.max(...s.sa.x, ...s.sa.y, ...s.sa.z)).toBe(0);
  });

  it("peaks at the period of a harmonic input and amplifies it, only on that axis", () => {
    const s = computeResponseSpectrum(harmonic(2, 0.1, 10));
    const peakIndex = s.sa.x.indexOf(Math.max(...s.sa.x));
    const peakPeriod = s.periodsS[peakIndex] ?? 0;
    expect(peakPeriod).toBeGreaterThan(0.4);
    expect(peakPeriod).toBeLessThan(0.65);
    // 5 % damping: resonant amplification well above the 0.1 g input.
    expect(s.sa.x[peakIndex]).toBeGreaterThan(0.5);
    expect(Math.max(...s.sa.y)).toBe(0);
    // Far from resonance the spectrum returns to roughly the input level.
    expect(s.sa.x[0]).toBeLessThan(0.2);
  });
});
