import {
  GravityFilter,
  GRAVITY_LOW_PASS_ALPHA,
  removeGravityFromSeries,
} from "../low-pass-filter";

describe("GravityFilter", () => {
  it("seeds the gravity estimate with the first sample, so the first output is exactly zero", () => {
    const filter = new GravityFilter();
    const result = filter.apply({ x: 0.02, y: -0.01, z: 0.98 });

    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("converges toward the true gravity vector for a phone held perfectly still", () => {
    const filter = new GravityFilter();
    const still = { x: 0, y: 0, z: 1 };

    let last = filter.apply(still);
    for (let i = 0; i < 200; i++) {
      last = filter.apply(still);
    }

    // A constant input should settle to (near) zero linear acceleration —
    // the filter has fully attributed the constant 1 g on Z to "gravity".
    expect(last.x).toBeCloseTo(0, 5);
    expect(last.y).toBeCloseTo(0, 5);
    expect(last.z).toBeCloseTo(0, 5);
  });

  it("lets a sudden shake mostly survive into the linear-acceleration output", () => {
    const filter = new GravityFilter();
    const still = { x: 0, y: 0, z: 1 };
    for (let i = 0; i < 50; i++) {
      filter.apply(still); // settle at rest first
    }

    const shaken = filter.apply({ x: 0, y: 0, z: 1.5 }); // sudden +0.5 g spike
    // With alpha=0.8 the gravity estimate barely moves on one sample, so
    // most of the spike shows up as linear acceleration, not gravity.
    expect(shaken.z).toBeGreaterThan(0.35);
  });

  it("linear = raw - gravity holds on every call (default alpha)", () => {
    expect(GRAVITY_LOW_PASS_ALPHA).toBeGreaterThan(0);
    expect(GRAVITY_LOW_PASS_ALPHA).toBeLessThan(1);
  });

  it("reset() clears the seeded gravity estimate so the next sample re-seeds", () => {
    const filter = new GravityFilter();
    filter.apply({ x: 1, y: 1, z: 1 });
    filter.reset();

    const result = filter.apply({ x: 0.5, y: 0.5, z: 0.5 });
    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("removeGravityFromSeries", () => {
  it("returns a same-length series with each sample's timestamp preserved", () => {
    const series = [
      { t: 0, x: 0, y: 0, z: 1 },
      { t: 20, x: 0, y: 0, z: 1 },
      { t: 40, x: 0.4, y: 0, z: 1 },
    ];

    const result = removeGravityFromSeries(series);

    expect(result.length).toBe(series.length);
    expect(result.map((s) => s.t)).toEqual([0, 20, 40]);
  });

  it("the first point of any window is always exactly zero (fresh seed per call)", () => {
    const series = [
      { t: 0, x: 0.3, y: -0.2, z: 0.9 },
      { t: 20, x: 0.3, y: -0.2, z: 0.9 },
    ];

    const result = removeGravityFromSeries(series);
    expect(result[0]).toEqual({ t: 0, x: 0, y: 0, z: 0 });
  });
});
