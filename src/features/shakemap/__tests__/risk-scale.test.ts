import { IMPACT_SCALE_MAX, IMPACT_SCALE_MIN, IMPACT_SCALE_TICKS, logPositionForValue, logPositionPercent } from "../risk-scale";

describe("logPositionForValue", () => {
  it("positions the domain minimum at 0 and the domain maximum at 1", () => {
    expect(logPositionForValue(IMPACT_SCALE_MIN)).toBe(0);
    expect(logPositionForValue(IMPACT_SCALE_MAX)).toBe(1);
  });

  it("clamps values below the minimum to 0, never negative or NaN", () => {
    expect(logPositionForValue(0)).toBe(0);
    expect(logPositionForValue(-5)).toBe(0);
  });

  it("clamps values above the maximum to 1", () => {
    expect(logPositionForValue(50_000_000)).toBe(1);
  });

  it("positions the geometric midpoint of the domain at 0.5", () => {
    // sqrt(10 * 1,000,000) = ~3162.3 is the geometric midpoint of a 10..1e6 log domain.
    expect(logPositionForValue(Math.sqrt(IMPACT_SCALE_MIN * IMPACT_SCALE_MAX))).toBeCloseTo(0.5, 5);
  });

  it("is monotonically increasing", () => {
    expect(logPositionForValue(100)).toBeGreaterThan(logPositionForValue(10));
    expect(logPositionForValue(1_000)).toBeGreaterThan(logPositionForValue(100));
    expect(logPositionForValue(10_000)).toBeGreaterThan(logPositionForValue(1_000));
  });
});

describe("logPositionPercent", () => {
  it("formats as a CSS percentage string", () => {
    expect(logPositionPercent(IMPACT_SCALE_MIN)).toBe("0.00%");
    expect(logPositionPercent(IMPACT_SCALE_MAX)).toBe("100.00%");
  });
});

describe("IMPACT_SCALE_TICKS", () => {
  it("has one tick per order of magnitude across the whole domain, ascending", () => {
    expect(IMPACT_SCALE_TICKS.map((tick) => tick.value)).toEqual([
      10, 100, 1_000, 10_000, 100_000, 1_000_000,
    ]);
    expect(IMPACT_SCALE_TICKS.map((tick) => tick.label)).toEqual([
      "10", "100", "1k", "10k", "100k", "1M",
    ]);
  });
});
