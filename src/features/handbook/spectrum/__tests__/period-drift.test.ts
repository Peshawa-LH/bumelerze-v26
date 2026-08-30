import { computeSpectrumParameters, governingCs } from "../compute";
import { allowableDrift, allowableDriftMm, driftStructureTypeFor } from "../drift";
import { approximatePeriod, computePeriod, periodCoefficientsFor, upperLimitCoefficient } from "../period";
import { formatCodeCoefficient } from "../format";
import { STRUCTURAL_SYSTEMS, findStructuralSystem } from "../structural-systems";
import type { SpectrumInputs } from "../types";

const rcSpecial = findStructuralSystem("mf.rcSpecial")!;
const rcIntermediate = findStructuralSystem("mf.rcIntermediate")!;
const steelSpecial = findStructuralSystem("mf.steelSpecial")!;
const steelEbf = findStructuralSystem("bf.steelEbfMomentConnections")!;
const masonryOrdinary = findStructuralSystem("bw.masonryShearWallOrdinary")!;
const rcShearWall = findStructuralSystem("bw.rcShearWallSpecial")!;

describe("ISC-2017 Table 3-9/2 period coefficients", () => {
  it("routes each system to its own row", () => {
    expect(periodCoefficientsFor(steelSpecial)).toMatchObject({ ct: 0.068, x: 0.8 });
    expect(periodCoefficientsFor(rcSpecial)).toMatchObject({ ct: 0.044, x: 0.9 });
    expect(periodCoefficientsFor(steelEbf)).toMatchObject({ ct: 0.07, x: 0.75 });
    expect(periodCoefficientsFor(rcShearWall)).toMatchObject({ ct: 0.055, x: 0.75 });
  });

  it("does not drift toward ASCE 7-10's SI coefficients", () => {
    // ASCE has 0.0724 / 0.0466 / 0.0731 / 0.0488. ISC-2017 does not.
    expect(periodCoefficientsFor(steelSpecial).ct).not.toBeCloseTo(0.0724, 4);
    expect(periodCoefficientsFor(rcSpecial).ct).not.toBeCloseTo(0.0466, 4);
  });

  it("computes Ta = Ct * hn^x", () => {
    // 24 m RC moment frame: 0.044 * 24^0.9
    expect(approximatePeriod(rcSpecial, 24)).toBeCloseTo(0.044 * Math.pow(24, 0.9), 10);
    // Taller buildings have longer periods, in every system.
    for (const s of [rcSpecial, steelSpecial, steelEbf, rcShearWall]) {
      expect(approximatePeriod(s, 40)).toBeGreaterThan(approximatePeriod(s, 20));
    }
  });
});

describe("ISC-2017 Table 3-9/1 upper-limit coefficient", () => {
  it.each([
    [0.6, 1.4], [0.4, 1.4], [0.35, 1.4], [0.3, 1.4],
    [0.25, 1.5], [0.2, 1.5], [0.18, 1.6], [0.15, 1.6],
    [0.12, 1.7], [0.05, 1.7], [0.01, 1.7],
  ])("SD1 %p gives Cu %p", (sd1, cu) => {
    expect(upperLimitCoefficient(sd1)).toBe(cu);
  });

  it("steps to the conservative row between tabulated values", () => {
    // Between the 0.3 and 0.2 rows the code says nothing, so the smaller Cu
    // wins: a shorter permitted period, hence a larger Cs.
    expect(upperLimitCoefficient(0.25)).toBe(1.5);
    expect(upperLimitCoefficient(0.29)).toBe(1.5);
    expect(upperLimitCoefficient(0.31)).toBe(1.4);
  });
});

describe("governing Cs", () => {
  function paramsFor(over: Partial<SpectrumInputs> = {}) {
    const inputs: SpectrumInputs = {
      ss: 1.5, s1: 0.6, siteClass: "C", occupancy: "I_II", r: 6.5, ...over,
    };
    return { inputs, params: computeSpectrumParameters(inputs) };
  }

  it("uses the plateau at very short periods", () => {
    const { inputs, params } = paramsFor();
    const cs = governingCs(params, inputs.r, 0.05);
    expect(cs.governedBy).toBe("plateau");
    expect(cs.cs).toBeCloseTo(params.csUnreduced, 10);
  });

  it("applies the SD1/(T R/I) cap between the plateau and the floor", () => {
    // The cap only governs in a window: it must have fallen below the
    // plateau but not yet below the floor. For these inputs that window is
    // roughly 0.52 s to 1.82 s, so 2.0 s is already floor-governed.
    const { inputs, params } = paramsFor();
    const cs = governingCs(params, inputs.r, 1.0);
    expect(cs.governedBy).toBe("periodCap");
    expect(cs.cs).toBeLessThan(params.csUnreduced);
    expect(cs.cs).toBeCloseTo(params.sd1 / (1.0 * (inputs.r / params.importanceFactor)), 10);
  });

  it("never falls below the 0.044 SDS I floor", () => {
    const { inputs, params } = paramsFor();
    // A very long period drives the cap far below the floor.
    const cs = governingCs(params, inputs.r, 50);
    expect(cs.governedBy).toBe("floor");
    expect(cs.cs).toBeCloseTo(params.csFloor, 10);
  });

  it("decreases monotonically with period until the floor bites", () => {
    const { inputs, params } = paramsFor();
    let previous = Infinity;
    for (const t of [0.1, 0.3, 0.6, 1.0, 1.5, 2.5, 4.0]) {
      const value = governingCs(params, inputs.r, t).cs;
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      previous = value;
    }
  });

  it("omits ASCE's long-period branch, as ISC-2017 does", () => {
    const { inputs, params } = paramsFor();
    // Past TL (6 s) ASCE would switch to SD1*TL/(T^2 (R/I)), which is
    // SMALLER than the plain cap. ISC-2017 has no such branch, so the value
    // must still be the plain cap or the floor, never the T^2 form.
    const t = 8;
    const cs = governingCs(params, inputs.r, t);
    const asceLongPeriod = (params.sd1 * params.tl) / (t * t * (inputs.r / params.importanceFactor));
    expect(cs.cs).not.toBeCloseTo(asceLongPeriod, 6);
    expect(cs.cs).toBeCloseTo(Math.max(params.sd1 / (t * (inputs.r / params.importanceFactor)), params.csFloor), 10);
  });
});

describe("ISC-2017 Table 3-12/1 allowable drift", () => {
  it("gives masonry shear walls the tightest limit", () => {
    expect(driftStructureTypeFor(masonryOrdinary)).toBe("otherMasonryShearWall");
    expect(allowableDrift(masonryOrdinary, "I_II").ratio).toBe(0.007);
    expect(allowableDrift(masonryOrdinary, "IV").ratio).toBe(0.007);
  });

  it("tightens with occupancy category for other structures", () => {
    expect(allowableDrift(rcSpecial, "I_II").ratio).toBe(0.02);
    expect(allowableDrift(rcSpecial, "III").ratio).toBe(0.015);
    expect(allowableDrift(rcSpecial, "IV").ratio).toBe(0.01);
  });

  it("never claims the table's conditional first row", () => {
    // 0.025 needs a design intent and storey count the app cannot know.
    for (const occupancy of ["I_II", "III", "IV"] as const) {
      for (const system of [rcSpecial, rcIntermediate, steelSpecial, rcShearWall]) {
        expect(allowableDrift(system, occupancy).ratio).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it("converts a ratio to millimetres for a storey height", () => {
    expect(allowableDriftMm(0.02, 3)).toBeCloseTo(60, 10);
  });
});

describe("computePeriod", () => {
  it("returns Ta, Cu and their product together", () => {
    const r = computePeriod(rcSpecial, 30, 0.25);
    expect(r.ta).toBeCloseTo(0.044 * Math.pow(30, 0.9), 10);
    expect(r.cu).toBe(1.5);
    expect(r.cuTa).toBeCloseTo(r.ta * 1.5, 10);
    expect(r.row).toBe("rcMomentFrame");
  });
});

/** Strips the bidi isolation marks `isolateNumeric` wraps every numeral in
 * so a Sorani or Arabic sentence cannot reorder its digits. */
function bare(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}

describe("formatCodeCoefficient", () => {
  /**
   * Regression for a bug found in browser verification, 2026-08-30: the
   * 2-decimal `formatPlainNumber` rendered Ct 0.044 as "0.04" and the 0.007
   * masonry drift limit as "0.01" — a 43% error on a published code limit.
   */
  it.each([
    [0.044, "0.044"],
    [0.068, "0.068"],
    [0.055, "0.055"],
    [0.07, "0.07"],
    [0.007, "0.007"],
    [0.013, "0.013"],
    [0.02, "0.02"],
    [0.9, "0.9"],
    [1.4, "1.4"],
    [2.5, "2.5"],
  ])("renders %p verbatim as %p in en", (value, expected) => {
    expect(bare(formatCodeCoefficient(value as number, "en"))).toBe(expected);
  });

  it("never rounds a code coefficient away", () => {
    for (const s of STRUCTURAL_SYSTEMS) {
      const { ct, x } = periodCoefficientsFor(s);
      expect(Number(bare(formatCodeCoefficient(ct, "en")))).toBe(ct);
      expect(Number(bare(formatCodeCoefficient(x, "en")))).toBe(x);
    }
    for (const occupancy of ["I_II", "III", "IV"] as const) {
      for (const s of STRUCTURAL_SYSTEMS) {
        const { ratio } = allowableDrift(s, occupancy);
        expect(Number(bare(formatCodeCoefficient(ratio, "en")))).toBe(ratio);
      }
    }
  });
});

describe("no structural system chosen", () => {
  /**
   * Choosing a system is optional: the spectrum never needed it, and most
   * engineers know their own R. The code still answers, through its own
   * catch-all rows, so Ta, Cs and the drift limit stay available.
   */
  it("falls back to the code's own 'all other structural systems' period row", () => {
    expect(periodCoefficientsFor(null)).toMatchObject({ ct: 0.055, x: 0.75, row: "allOther" });
    expect(approximatePeriod(null, 24)).toBeCloseTo(0.055 * Math.pow(24, 0.75), 10);
  });

  it("falls back to the drift table's 'all other structures' row", () => {
    expect(driftStructureTypeFor(null)).toBe("allOther");
    expect(allowableDrift(null, "I_II").ratio).toBe(0.02);
    expect(allowableDrift(null, "IV").ratio).toBe(0.01);
  });

  it("still yields a governing Cs from a hand-entered R", () => {
    const inputs = { ss: 1.22, s1: 0.49, siteClass: "C", occupancy: "I_II", r: 4 } as const;
    const params = computeSpectrumParameters(inputs);
    const period = computePeriod(null, 24, params.sd1);
    const cs = governingCs(params, inputs.r, period.ta);
    expect(cs.cs).toBeGreaterThan(0);
    expect(["plateau", "periodCap", "floor"]).toContain(cs.governedBy);
  });
});
