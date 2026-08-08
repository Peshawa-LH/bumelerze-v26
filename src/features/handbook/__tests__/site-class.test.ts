import { siteClassFromVs30 } from "../site-class";

describe("siteClassFromVs30", () => {
  it("classifies stiff rock as EC8 A / NEHRP A-B boundary correctly", () => {
    expect(siteClassFromVs30(1600).ec8).toBe("A");
    expect(siteClassFromVs30(1600).nehrp).toBe("A");
  });

  it("classifies a typical Sulaimani-range Vs30 (~467 m/s) as EC8 B / NEHRP C", () => {
    const result = siteClassFromVs30(467);
    expect(result.ec8).toBe("B");
    expect(result.nehrp).toBe("C");
  });

  it("classifies soft soil near the bottom of the bundled range as EC8 D / NEHRP E", () => {
    const result = siteClassFromVs30(150);
    expect(result.ec8).toBe("D");
    expect(result.nehrp).toBe("E");
  });

  it("is monotonic — higher Vs30 never yields a 'softer' EC8 class", () => {
    const EC8_ORDER = ["D", "C", "B", "A"];
    const values = [150, 200, 300, 400, 500, 700, 900, 1600];
    let lastIndex = -1;
    for (const v of values) {
      const idx = EC8_ORDER.indexOf(siteClassFromVs30(v).ec8);
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });
});
