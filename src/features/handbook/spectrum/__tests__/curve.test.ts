import { computeSpectrumParameters } from "../compute";
import { buildSpectrumCurve, reducedSpectralAcceleration, serializeCurveForClipboard, spectralAcceleration } from "../curve";
import type { SpectrumInputs } from "../types";

const BAGHDAD: SpectrumInputs = { ss: 0.3, s1: 0.1, siteClass: "D", occupancy: "I_II", r: 4 };
const params = computeSpectrumParameters(BAGHDAD);

describe("spectralAcceleration — four branches", () => {
  it("branch 1 (T < T0): ramps from 0.4 SDS at T=0 up to SDS at T0", () => {
    expect(spectralAcceleration(0, params)).toBeCloseTo(0.4 * params.sds, 10);
    expect(spectralAcceleration(params.t0, params)).toBeCloseTo(params.sds, 10);
  });

  it("branch 2 (T0 <= T <= Ts): flat plateau at SDS", () => {
    const mid = (params.t0 + params.ts) / 2;
    expect(spectralAcceleration(mid, params)).toBeCloseTo(params.sds, 10);
    expect(spectralAcceleration(params.ts, params)).toBeCloseTo(params.sds, 10);
  });

  it("branch 3 (Ts < T <= TL): Sa = SD1/T, matches SDS at T=Ts and decays past it", () => {
    expect(spectralAcceleration(1.0, params)).toBeCloseTo(params.sd1 / 1.0, 10);
    expect(spectralAcceleration(2.0, params)).toBeCloseTo(params.sd1 / 2.0, 10);
  });

  it("branch 4 (T > TL): Sa = SD1 TL / T^2", () => {
    const t = params.tl + 2;
    expect(spectralAcceleration(t, params)).toBeCloseTo((params.sd1 * params.tl) / (t * t), 10);
  });

  it("is continuous at T0 (branch 1 meets branch 2)", () => {
    const epsilon = 1e-6;
    const below = spectralAcceleration(params.t0 - epsilon, params);
    const at = spectralAcceleration(params.t0, params);
    expect(below).toBeCloseTo(at, 3);
  });

  it("is continuous at Ts (branch 2 meets branch 3)", () => {
    const epsilon = 1e-6;
    const at = spectralAcceleration(params.ts, params);
    const above = spectralAcceleration(params.ts + epsilon, params);
    expect(at).toBeCloseTo(above, 3);
  });

  it("is continuous at TL (branch 3 meets branch 4)", () => {
    const epsilon = 1e-6;
    const at = spectralAcceleration(params.tl - epsilon, params);
    const above = spectralAcceleration(params.tl + epsilon, params);
    expect(at).toBeCloseTo(above, 3);
  });

  it("is continuous at every corner for a second, different input set (class E, high Ss/S1)", () => {
    const other = computeSpectrumParameters({ ss: 1.2, s1: 0.45, siteClass: "E", occupancy: "IV", r: 3 });
    const epsilon = 1e-6;
    expect(spectralAcceleration(other.t0 - epsilon, other)).toBeCloseTo(
      spectralAcceleration(other.t0, other),
      3,
    );
    expect(spectralAcceleration(other.ts, other)).toBeCloseTo(
      spectralAcceleration(other.ts + epsilon, other),
      3,
    );
    expect(spectralAcceleration(other.tl - epsilon, other)).toBeCloseTo(
      spectralAcceleration(other.tl + epsilon, other),
      3,
    );
  });
});

describe("reducedSpectralAcceleration", () => {
  it("is the code curve scaled by I/R", () => {
    const t = 1.0;
    const code = spectralAcceleration(t, params);
    const reduced = reducedSpectralAcceleration(t, params, BAGHDAD.r);
    expect(reduced).toBeCloseTo((code * params.importanceFactor) / BAGHDAD.r, 10);
  });
});

describe("buildSpectrumCurve", () => {
  const curve = buildSpectrumCurve(params, BAGHDAD.r, 4);

  it("includes the T0, Ts corner points (rounded to the module's 3-decimal key precision), not just the nearest 0.02 s grid sample", () => {
    // `samplePeriods` rounds every key (grid AND corner points) to 3
    // decimals to avoid float-step near-duplicates — so the assertion
    // compares at that same precision, not the raw irrational T0/Ts.
    const codeTimes = curve.code.map((p) => p.t);
    expect(codeTimes).toContainEqual(expect.closeTo(params.t0, 3));
    expect(codeTimes).toContainEqual(expect.closeTo(params.ts, 3));
    // And critically: T0/Ts do NOT sit on the 0.02 s uniform grid, so their
    // presence proves the corner-injection path actually ran, not just luck.
    expect(Math.abs(params.t0 / 0.02 - Math.round(params.t0 / 0.02))).toBeGreaterThan(1e-4);
  });

  it("marks corner points with isCornerPoint = true", () => {
    const t0Point = curve.code.find((p) => Math.abs(p.t - params.t0) < 1e-3);
    expect(t0Point?.isCornerPoint).toBe(true);
  });

  it("does not include TL when it falls outside the requested tMax", () => {
    // tMax = 4 < TL = 6, so TL must not appear in the sampled series.
    const codeTimes = curve.code.map((p) => p.t);
    expect(codeTimes.some((t) => Math.abs(t - params.tl) < 1e-6)).toBe(false);
  });

  it("is sorted ascending by T with no duplicate periods", () => {
    for (let i = 1; i < curve.code.length; i++) {
      expect(curve.code[i]!.t).toBeGreaterThan(curve.code[i - 1]!.t);
    }
  });
});

describe("serializeCurveForClipboard", () => {
  it("produces a tab-separated header plus one row per point, Latin digits regardless of caller locale", () => {
    const curve = buildSpectrumCurve(params, BAGHDAD.r, 1);
    const text = serializeCurveForClipboard(curve.code);
    const lines = text.split("\n");
    expect(lines[0]).toBe("T (s)\tSa (g)");
    expect(lines.length).toBe(curve.code.length + 1);
    expect(lines[1]).toMatch(/^[0-9.\t]+$/);
  });
});
