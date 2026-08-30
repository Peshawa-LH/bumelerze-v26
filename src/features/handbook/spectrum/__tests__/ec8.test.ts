import { buildEc8Curve, ec8Parameters, ec8Spectrum, EC8_MAX_PERIOD_S } from "../ec8";

/**
 * Pins EN 1998-1:2004 Tables 3.2 and 3.3 and equations 3.2 to 3.5, read
 * from the standard in the vault. EC8 is offered only as a comparison
 * against the ISC spectrum, so the thing that must not drift is its SHAPE.
 */

describe("EN 1998-1 Table 3.2 (Type 1)", () => {
  it.each([
    ["A", 1.0, 0.15, 0.4, 2.0],
    ["B", 1.2, 0.15, 0.5, 2.0],
    ["C", 1.15, 0.2, 0.6, 2.0],
    ["D", 1.35, 0.2, 0.8, 2.0],
    ["E", 1.4, 0.15, 0.5, 2.0],
  ])("ground type %s", (g, s, tb, tc, td) => {
    expect(ec8Parameters(g as "A")).toEqual({ s, tb, tc, td });
  });
});

describe("EN 1998-1 Table 3.3 (Type 2)", () => {
  it("differs from Type 1, with a shorter constant-acceleration branch", () => {
    const t1 = ec8Parameters("C", "type1");
    const t2 = ec8Parameters("C", "type2");
    expect(t2).toEqual({ s: 1.5, tb: 0.1, tc: 0.25, td: 1.2 });
    expect(t2.tc).toBeLessThan(t1.tc);
    expect(t2.td).toBeLessThan(t1.td);
  });
});

describe("ec8Spectrum", () => {
  const ag = 0.3;

  it("starts at ag*S and reaches the 2.5*S*eta plateau at TB", () => {
    for (const g of ["A", "B", "C", "D", "E"] as const) {
      const { s, tb } = ec8Parameters(g);
      expect(ec8Spectrum(0, ag, g)).toBeCloseTo(ag * s, 10);
      expect(ec8Spectrum(tb, ag, g)).toBeCloseTo(ag * s * 2.5, 10);
    }
  });

  it("holds the plateau from TB to TC", () => {
    const { s, tb, tc } = ec8Parameters("C");
    const plateau = ag * s * 2.5;
    for (const t of [tb, (tb + tc) / 2, tc]) {
      expect(ec8Spectrum(t, ag, "C")).toBeCloseTo(plateau, 10);
    }
  });

  it("decays as 1/T between TC and TD, then as 1/T^2", () => {
    const { s, tc, td } = ec8Parameters("C");
    const plateau = ag * s * 2.5;
    expect(ec8Spectrum(1.0, ag, "C")).toBeCloseTo(plateau * (tc / 1.0), 10);
    // Just past TD the curve must be continuous with the 1/T branch.
    expect(ec8Spectrum(td, ag, "C")).toBeCloseTo(plateau * (tc / td), 10);
    expect(ec8Spectrum(3.0, ag, "C")).toBeCloseTo(plateau * ((tc * td) / 9.0), 10);
  });

  it("is continuous at every corner period", () => {
    for (const g of ["A", "B", "C", "D", "E"] as const) {
      const { tb, tc, td } = ec8Parameters(g);
      for (const corner of [tb, tc, td]) {
        const before = ec8Spectrum(corner - 1e-6, ag, g);
        const after = ec8Spectrum(corner + 1e-6, ag, g);
        expect(Math.abs(after - before)).toBeLessThan(1e-4);
      }
    }
  });

  it("scales linearly with ag", () => {
    expect(ec8Spectrum(0.5, 0.6, "C")).toBeCloseTo(2 * ec8Spectrum(0.5, 0.3, "C"), 10);
  });

  it("gives softer ground a higher plateau", () => {
    const plateauOf = (g: "A" | "B" | "C" | "D") => ec8Spectrum(ec8Parameters(g).tc, ag, g);
    expect(plateauOf("D")).toBeGreaterThan(plateauOf("A"));
    expect(plateauOf("B")).toBeGreaterThan(plateauOf("A"));
  });
});

describe("buildEc8Curve", () => {
  it("never extrapolates past the 4 s the standard defines", () => {
    const curve = buildEc8Curve(0.3, "C", 8);
    expect(Math.max(...curve.map((p) => p.t))).toBeLessThanOrEqual(EC8_MAX_PERIOD_S);
  });

  it("includes the corner periods exactly, so the plateau is not rounded off", () => {
    const { tb, tc, td } = ec8Parameters("D");
    const ts = buildEc8Curve(0.3, "D", 4).map((p) => p.t);
    for (const corner of [tb, tc, td]) {
      expect(ts).toContain(corner);
    }
  });

  it("is monotonically decreasing after the plateau", () => {
    const { tc } = ec8Parameters("C");
    const tail = buildEc8Curve(0.3, "C", 4).filter((p) => p.t > tc);
    for (let i = 1; i < tail.length; i += 1) {
      expect(tail[i]!.sa).toBeLessThanOrEqual(tail[i - 1]!.sa + 1e-12);
    }
  });
});
