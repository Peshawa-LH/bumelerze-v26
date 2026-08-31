import { computeSpectrumParameters } from "../compute";
import type { SpectrumInputs } from "../types";

/**
 * ISC-2017 Appendix B — an Iraqi government building in Baghdad on stiff
 * soil. Every expected value below is `[P]`, read directly out of the
 * code's own worked example (`handbook-spectra-design.md` §3.3), cross-
 * checked against two independent secondary sources. This is the "free
 * regression test" §7.3 calls out: if this suite does not pass exactly,
 * the implementation is wrong, not the code.
 */
const BAGHDAD_APPENDIX_B: SpectrumInputs = {
  ss: 0.3,
  s1: 0.1,
  siteClass: "D",
  occupancy: "I_II", // Occupancy category II -> I = 1.0
  r: 4, // intermediate RC moment frame
};

describe("computeSpectrumParameters — ISC-2017 Appendix B (Baghdad)", () => {
  const result = computeSpectrumParameters(BAGHDAD_APPENDIX_B);

  it("Fa = 1.56", () => {
    expect(result.fa).toBeCloseTo(1.56, 10);
  });

  it("Fv = 2.4", () => {
    expect(result.fv).toBe(2.4);
  });

  it("SMS = Fa * Ss = 0.468", () => {
    expect(result.sms).toBeCloseTo(0.468, 10);
  });

  it("SM1 = Fv * S1 = 0.24", () => {
    expect(result.sm1).toBeCloseTo(0.24, 10);
  });

  it("SDS = (2/3) SMS = 0.312", () => {
    expect(result.sds).toBeCloseTo(0.312, 10);
  });

  it("SD1 = (2/3) SM1 = 0.16", () => {
    expect(result.sd1).toBeCloseTo(0.16, 10);
  });

  it("T0 = 0.2 SD1/SDS = 0.103 s", () => {
    expect(result.t0).toBeCloseTo(0.103, 3);
  });

  it("Ts = SD1/SDS = 0.513 s", () => {
    expect(result.ts).toBeCloseTo(0.513, 3);
  });

  it("TL = 6 s, the national constant, regardless of inputs", () => {
    expect(result.tl).toBe(6);
  });

  it("Importance factor I = 1.0 for occupancy category I/II", () => {
    expect(result.importanceFactor).toBe(1.0);
  });

  it("Seismic design category = C (governed by the SD1 table)", () => {
    expect(result.seismicDesignCategory).toBe("C");
  });

  it("Cs (unreduced) = SDS/(R/I) = 0.078", () => {
    expect(result.csUnreduced).toBeCloseTo(0.078, 10);
  });

  it("Cs floor = 0.044 SDS I = 0.014 (rounded)", () => {
    expect(result.csFloor).toBeCloseTo(0.0137, 4);
    expect(Math.round(result.csFloor * 1000) / 1000).toBeCloseTo(0.014, 3);
  });
});

describe("computeSpectrumParameters — seismic design category boundaries", () => {
  const base: SpectrumInputs = { ss: 0.3, s1: 0.1, siteClass: "D", occupancy: "I_II", r: 4 };

  it("category IV diverges from I/II and III exactly at the boundary bands", () => {
    // SDS just inside the 0.167-0.33 band: I/II and III both read B, IV reads C.
    const paramsIandII = computeSpectrumParameters({ ...base, occupancy: "I_II" });
    const paramsIV = computeSpectrumParameters({ ...base, occupancy: "IV" });
    expect(paramsIandII.seismicDesignCategory).not.toBe(paramsIV.seismicDesignCategory);
  });

  it("higher R lowers the unreduced Cs (larger ductility assumption, smaller design force)", () => {
    const lowR = computeSpectrumParameters({ ...base, r: 2 });
    const highR = computeSpectrumParameters({ ...base, r: 8 });
    expect(highR.csUnreduced).toBeLessThan(lowR.csUnreduced);
  });
});

describe("occupancy category", () => {
  /**
   * Reported as "changing occupancy does nothing". It does — but only to
   * `I`, and through it to `Cs` and the drift check. The spectrum itself is
   * independent of occupancy by ISC-2017 §2-2/5, whose four branches use
   * `SDS`, `SD1`, `T0`, `Ts` and `TL` and nothing else. These tests pin both
   * halves of that, so neither can drift into the other.
   */
  const base = { ss: 1.22, s1: 0.49, siteClass: "C", r: 4 } as const;
  const params = (occupancy: "I_II" | "III" | "IV") =>
    computeSpectrumParameters({ ...base, occupancy } as SpectrumInputs);

  it("applies ISC-2017 Table 2-3/1's importance factors", () => {
    expect(params("I_II").importanceFactor).toBe(1.0);
    expect(params("III").importanceFactor).toBe(1.25);
    expect(params("IV").importanceFactor).toBe(1.5);
  });

  it("scales the base-shear coefficient with the importance factor", () => {
    expect(params("III").csUnreduced / params("I_II").csUnreduced).toBeCloseTo(1.25, 6);
    expect(params("IV").csUnreduced / params("I_II").csUnreduced).toBeCloseTo(1.5, 6);
    expect(params("IV").csFloor / params("I_II").csFloor).toBeCloseTo(1.5, 6);
  });

  it("leaves the design spectrum itself untouched, as the code requires", () => {
    for (const occupancy of ["III", "IV"] as const) {
      expect(params(occupancy).sds).toBe(params("I_II").sds);
      expect(params(occupancy).sd1).toBe(params("I_II").sd1);
      expect(params(occupancy).t0).toBe(params("I_II").t0);
      expect(params(occupancy).ts).toBe(params("I_II").ts);
    }
  });
});
