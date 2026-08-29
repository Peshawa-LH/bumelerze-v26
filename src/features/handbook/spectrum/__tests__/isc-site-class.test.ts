import { iscSiteClassFromVs30 } from "../isc-site-class";

describe("iscSiteClassFromVs30", () => {
  it("classifies hard rock as A above 1500 m/s", () => {
    expect(iscSiteClassFromVs30(1600)).toBe("A");
  });

  it("classifies rock as B in the 760-1500 m/s band", () => {
    expect(iscSiteClassFromVs30(1000)).toBe("B");
  });

  it("classifies very dense soil/soft rock as C in the 370-760 m/s band", () => {
    expect(iscSiteClassFromVs30(500)).toBe("C");
  });

  it("classifies stiff soil as D in the 180-370 m/s band", () => {
    expect(iscSiteClassFromVs30(250)).toBe("D");
  });

  it("classifies soft clay soil as E below 180 m/s", () => {
    expect(iscSiteClassFromVs30(150)).toBe("E");
  });

  it("resolves the ISC-2017 C/D boundary at exactly 370 m/s to D (this app's boundary convention)", () => {
    expect(iscSiteClassFromVs30(370)).toBe("D");
    expect(iscSiteClassFromVs30(371)).toBe("C");
    expect(iscSiteClassFromVs30(369)).toBe("D");
  });

  it("does NOT use EC8's 360 m/s boundary — 365 m/s is ISC class D, not C", () => {
    // handbook-spectra-design.md §3.6: this is the exact 360-370 disagreement
    // band (2.4% of the bundled Vs30 grid) where EC8 says B/C and ISC says D.
    expect(iscSiteClassFromVs30(365)).toBe("D");
  });

  it("is monotonic — higher Vs30 never yields a softer ISC class", () => {
    const ORDER = ["E", "D", "C", "B", "A"];
    const values = [100, 150, 180, 200, 300, 370, 400, 600, 760, 900, 1500, 1600];
    let lastIndex = -1;
    for (const v of values) {
      const idx = ORDER.indexOf(iscSiteClassFromVs30(v));
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });

  it("diverges from the app's typical Vs30 grid median (~291 m/s): ISC gives D, matching the code's median-case story in the design doc", () => {
    expect(iscSiteClassFromVs30(291)).toBe("D");
  });
});
