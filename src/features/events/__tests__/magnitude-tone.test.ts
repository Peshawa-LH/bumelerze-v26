import { magnitudeTone } from "../magnitude-tone";

/** Five USGS magnitude classes (owner directive 2026-09-23), replacing
 * three bands at 4.5/6.0 that put 86% of every browsable event into one
 * color and rendered an M6.0 identically to an M7.8. */
describe("magnitudeTone", () => {
  it.each([
    [1.2, "minor"],
    [3.9, "minor"],
    [4.0, "light"],
    [4.9, "light"],
    [5.0, "moderate"],
    [5.9, "moderate"],
    [6.0, "strong"],
    [6.9, "strong"],
    [7.0, "major"],
    [7.8, "major"],
  ] as const)("puts M%s in the %s band", (value, band) => {
    expect(magnitudeTone(value)).toBe(band);
  });

  it("gives a boundary value to the higher band", () => {
    // An M6.0 is strong, not moderate — the edges are the USGS class
    // edges, and a reader placing an event from the numeral alone should
    // never be off by one band.
    expect(magnitudeTone(6)).toBe("strong");
    expect(magnitudeTone(5.999)).toBe("moderate");
  });

  it("separates the two events this region is measured against", () => {
    // 2023 Kahramanmaraş M7.8 and 2017 Iraq-Iran M7.3 both read as major;
    // an ordinary strong shock does not. Under the old bands all three
    // were the same red.
    expect(magnitudeTone(7.8)).toBe("major");
    expect(magnitudeTone(7.3)).toBe("major");
    expect(magnitudeTone(6.4)).toBe("strong");
  });

  it("keeps the Home display floor inside the lowest band", () => {
    // Home shows M>=3; 81% of the last six months' regional events are
    // under M4, so the minor band has to cover the ordinary case.
    expect(magnitudeTone(3.0)).toBe("minor");
    expect(magnitudeTone(3.9)).toBe("minor");
  });
});
