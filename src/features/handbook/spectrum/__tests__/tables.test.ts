import { faFromTable, fvFromTable } from "../tables";

describe("faFromTable / fvFromTable", () => {
  it("reproduces ISC-2017 Appendix B exactly: Fa = 1.56 for Ss = 0.3, class D", () => {
    // handbook-spectra-design.md §3.3: 1.6 + (0.05/0.25)(1.4-1.6) = 1.56
    expect(faFromTable(0.3, "D")).toBeCloseTo(1.56, 10);
  });

  it("reproduces ISC-2017 Appendix B exactly: Fv = 2.4 for S1 = 0.1, class D", () => {
    expect(fvFromTable(0.1, "D")).toBe(2.4);
  });

  it("hand-checked interior interpolation point: Fa = 1.16 for Ss = 0.6, class C", () => {
    // 1.2 + (0.1/0.25)(1.1-1.2) = 1.2 - 0.04 = 1.16
    expect(faFromTable(0.6, "C")).toBeCloseTo(1.16, 10);
  });

  it("hand-checked interior interpolation point: Fv = 1.7 for S1 = 0.35, class D", () => {
    // 1.8 + (0.05/0.1)(1.6-1.8) = 1.8 - 0.1 = 1.7
    expect(fvFromTable(0.35, "D")).toBeCloseTo(1.7, 10);
  });

  it("clamps flat below the first tabulated column", () => {
    expect(faFromTable(0.1, "D")).toBe(1.6);
    expect(fvFromTable(0.05, "D")).toBe(2.4);
  });

  it("clamps flat above the last tabulated column", () => {
    expect(faFromTable(2.0, "D")).toBe(1.0);
    expect(fvFromTable(1.0, "D")).toBe(1.5);
  });

  it("every site class is flat at Fa = Fv = 0.8/1.0 for classes A/B (no interpolation to check)", () => {
    for (const ss of [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 2]) {
      expect(faFromTable(ss, "A")).toBe(0.8);
      expect(faFromTable(ss, "B")).toBe(1.0);
    }
  });

  it("class E gives the largest Fa/Fv at low Ss/S1 (softest soil amplifies most)", () => {
    expect(faFromTable(0.25, "E")).toBeGreaterThan(faFromTable(0.25, "D"));
    expect(fvFromTable(0.1, "E")).toBeGreaterThan(fvFromTable(0.1, "D"));
  });
});
