import { classifyDamageBand, DAMAGE_BAND_ORDER } from "../risk-alert";

describe("classifyDamageBand", () => {
  it("classifies green for under 100 buildings heavily damaged", () => {
    expect(classifyDamageBand(0)).toBe("green");
    expect(classifyDamageBand(99)).toBe("green");
  });

  it("classifies yellow for 100 up to (not including) 1,000", () => {
    expect(classifyDamageBand(100)).toBe("yellow");
    expect(classifyDamageBand(999)).toBe("yellow");
  });

  it("classifies orange for 1,000 up to (not including) 10,000", () => {
    expect(classifyDamageBand(1_000)).toBe("orange");
    expect(classifyDamageBand(9_999)).toBe("orange");
  });

  it("classifies red for 10,000 or more", () => {
    expect(classifyDamageBand(10_000)).toBe("red");
    expect(classifyDamageBand(158_965)).toBe("red");
  });

  it("exposes the four bands in worst-last order", () => {
    expect(DAMAGE_BAND_ORDER).toEqual(["green", "yellow", "orange", "red"]);
  });
});
