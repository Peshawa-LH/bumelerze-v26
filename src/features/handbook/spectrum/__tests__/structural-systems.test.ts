import i18n from "@/i18n";

import {
  STRUCTURAL_SYSTEMS,
  checkHeight,
  findStructuralSystem,
  heightLimitFor,
} from "../structural-systems";

/**
 * These pin the transcription. The values come from reading ISC-2017
 * Table 3-2/1 rendered at high dpi (the PDF's text layer has a broken
 * digit map and cannot be used), so there is no generator to re-run and no
 * upstream to diff against: a silent edit here would reach engineers as a
 * design coefficient. Spot values below are the ones a reader can check
 * against the code by eye.
 */

describe("ISC-2017 Table 3-2/1 subset", () => {
  it("carries the 16 verified systems across three categories", () => {
    expect(STRUCTURAL_SYSTEMS).toHaveLength(16);
    expect(new Set(STRUCTURAL_SYSTEMS.map((s) => s.category))).toEqual(
      new Set(["bearingWall", "buildingFrame", "momentFrame"]),
    );
    expect(new Set(STRUCTURAL_SYSTEMS.map((s) => s.id)).size).toBe(16);
  });

  it.each([
    ["mf.rcSpecial", 6.5, 3, 5.5],
    ["mf.rcIntermediate", 4, 3, 4.5],
    ["mf.steelSpecial", 7, 3, 5.5],
    ["bw.rcShearWallSpecial", 4, 2.5, 5],
    ["bw.masonryShearWallOrdinary", 1.5, 2.5, 1.75],
    ["bf.steelEbfMomentConnections", 7, 2, 4],
    ["bf.steelCbfOrdinary", 4, 2, 4.5],
  ])("pins %s at R=%p, omega0=%p, Cd=%p", (id, r, omega0, cd) => {
    const s = findStructuralSystem(id as string);
    expect(s).not.toBeNull();
    expect(s!.r).toBe(r);
    expect(s!.omega0).toBe(omega0);
    expect(s!.cd).toBe(cd);
  });

  it("does not drift toward ASCE 7-10, which differs for this table", () => {
    // ASCE 7-10 has 8 and 7 for these two; ISC-2017 has 7 and 6. A future
    // edit "correcting" them to ASCE would be wrong.
    expect(findStructuralSystem("bf.steelEbfMomentConnections")!.r).toBe(7);
    expect(findStructuralSystem("bf.steelEbfNonMomentConnections")!.r).toBe(6);
    expect(findStructuralSystem("mf.rcSpecial")!.r).not.toBe(8);
  });

  it("keeps every coefficient physically ordered", () => {
    for (const s of STRUCTURAL_SYSTEMS) {
      expect(s.r).toBeGreaterThan(0);
      expect(s.r).toBeLessThanOrEqual(8);
      expect([2, 2.5, 3]).toContain(s.omega0);
      expect(s.cd).toBeGreaterThan(0);
      expect(s.cd).toBeLessThanOrEqual(s.r + 1.5);
    }
  });

  it("has a translated name for every system in every locale", async () => {
    const original = i18n.language;
    for (const locale of ["en", "ar", "ckb", "kmr"]) {
      await i18n.changeLanguage(locale);
      for (const s of STRUCTURAL_SYSTEMS) {
        const key = `handbook.spectrum.systems.${s.id}`;
        const text = i18n.t(key);
        expect(text).not.toBe(key);
        expect(text.length).toBeGreaterThan(3);
      }
    }
    await i18n.changeLanguage(original);
  });
});

describe("heightLimitFor", () => {
  it("groups categories A and B into one column, as the code does", () => {
    const s = findStructuralSystem("bw.masonryShearWallOrdinary")!;
    expect(heightLimitFor(s, "A")).toBe("NL");
    expect(heightLimitFor(s, "B")).toBe("NL");
    expect(heightLimitFor(s, "C")).toBe(50);
    expect(heightLimitFor(s, "D")).toBe("NP");
  });
});

describe("checkHeight", () => {
  const ordinaryRcWall = findStructuralSystem("bw.rcShearWallOrdinary")!;
  const specialRcWall = findStructuralSystem("bw.rcShearWallSpecial")!;
  const specialRcFrame = findStructuralSystem("mf.rcSpecial")!;

  it("reports a system as not permitted regardless of height", () => {
    // The compliance answer an arithmetic calculator cannot give.
    expect(checkHeight(ordinaryRcWall, "D", 10)).toEqual({ status: "notPermitted" });
    expect(checkHeight(ordinaryRcWall, "D", null)).toEqual({ status: "notPermitted" });
  });

  it("reports no limit where the code sets none", () => {
    expect(checkHeight(specialRcFrame, "D", 200)).toEqual({ status: "unlimited" });
  });

  it("compares a stated height against the metre limit", () => {
    expect(checkHeight(specialRcWall, "D", 40)).toEqual({ status: "withinLimit", limitM: 50 });
    expect(checkHeight(specialRcWall, "D", 60)).toEqual({ status: "overLimit", limitM: 50 });
  });

  it("still reports the limit when no height was entered, without claiming a pass", () => {
    // "withinLimit" with no height is the honest state: the number is worth
    // showing, but nothing has been checked against it.
    expect(checkHeight(specialRcWall, "D", null)).toEqual({ status: "withinLimit", limitM: 50 });
  });
});
