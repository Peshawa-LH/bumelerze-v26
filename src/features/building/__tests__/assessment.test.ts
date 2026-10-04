import {
  BELTS_DONT_KNOW_CONFINED,
  ENGINEERED_DONT_KNOW,
  METHOD,
  NEW_DONT_KNOW,
  ROOF_DONT_KNOW_SLAB,
  STONE_UNSURE_M4,
  assessAnswers,
  assessBuilding,
  confidence,
  contextForLocation,
  dominantFamily,
  expectedDamage,
  expectedDamageTable,
  formatVcRange,
  hasEngineerBenefit,
  improvementTips,
  mostLikelyVc,
  netShift,
  parseVcRange,
  plainTypeKey,
  rankedTypes,
  shiftVc,
  siteHazard,
  storeyBand,
  typeDistribution,
  vcDistribution,
  vcRange,
  vulnerableSigns,
} from "../assessment";
import { IMS_TYPES, TYPE_PRIORS, type VcProbs } from "../ims25";
import type { Answers } from "../questionnaire";

const URBAN_KRG = { region: "kurdistan", settlement: "urban" } as const;
const RURAL_KRG = { region: "kurdistan", settlement: "rural" } as const;
const URBAN_IRAQ = { region: "iraq", settlement: "urban" } as const;

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

describe("type distribution", () => {
  it("block walls with a concrete slab and no belts are M6", () => {
    const types = typeDistribution(
      { structure: "block", belts: "no", roof: "slab" },
      URBAN_KRG,
    );
    expect(types).toEqual({ M6: 1 });
  });

  it("belts and corner columns make block walls M7 whatever the roof", () => {
    expect(
      typeDistribution({ structure: "block", belts: "yes", roof: "slab" }, URBAN_KRG),
    ).toEqual({ M7: 1 });
    expect(
      typeDistribution({ structure: "block", belts: "yes", roof: "metal" }, URBAN_KRG),
    ).toEqual({ M7: 1 });
  });

  it.each(["jack_arch", "wood", "metal"])("a %s roof without belts is M5", (roof) => {
    expect(
      typeDistribution({ structure: "block", belts: "no", roof }, URBAN_KRG),
    ).toEqual({
      M5: 1,
    });
  });

  it("belts unknown splits 50/50 between M7 and M6 (owner decision)", () => {
    const types = typeDistribution(
      { structure: "block", belts: "dk", roof: "slab" },
      URBAN_KRG,
    );
    expect(types.M7).toBeCloseTo(BELTS_DONT_KNOW_CONFINED);
    expect(types.M6).toBeCloseTo(1 - BELTS_DONT_KNOW_CONFINED);
  });

  it("an unanswered belts question counts as unknown", () => {
    const types = typeDistribution({ structure: "block", roof: "slab" }, URBAN_KRG);
    expect(types.M7).toBeCloseTo(0.5);
  });

  it("an unknown roof leans to the concrete slab", () => {
    const types = typeDistribution(
      { structure: "block", belts: "no", roof: "dk" },
      URBAN_KRG,
    );
    expect(types.M6).toBeCloseTo(ROOF_DONT_KNOW_SLAB);
    expect(types.M5).toBeCloseTo(1 - ROOF_DONT_KNOW_SLAB);
  });

  it("fired brick follows the same pattern as block", () => {
    const brick = { belts: "dk", roof: "slab" };
    expect(typeDistribution({ structure: "brick", ...brick }, URBAN_KRG)).toEqual(
      typeDistribution({ structure: "block", ...brick }, URBAN_KRG),
    );
  });

  it("stone is M3, M4 only when engineered and dressed", () => {
    expect(
      typeDistribution(
        { structure: "stone", stone: "rough", builder: "eng_full" },
        URBAN_KRG,
      ),
    ).toEqual({ M3: 1 });
    expect(
      typeDistribution(
        { structure: "stone", stone: "dressed", builder: "self" },
        URBAN_KRG,
      ),
    ).toEqual({ M3: 1 });
    expect(
      typeDistribution(
        { structure: "stone", stone: "dressed", builder: "eng_plans" },
        URBAN_KRG,
      ),
    ).toEqual({ M4: 1 });
  });

  it("stone with an unknown detail keeps M3 0.7 / M4 0.3", () => {
    const unsureDressed = typeDistribution(
      { structure: "stone", stone: "dk", builder: "eng_full" },
      URBAN_KRG,
    );
    expect(unsureDressed.M4).toBeCloseTo(STONE_UNSURE_M4);
    expect(unsureDressed.M3).toBeCloseTo(0.7);
    const unsureEngineer = typeDistribution(
      { structure: "stone", stone: "dressed", builder: "dk" },
      URBAN_KRG,
    );
    expect(unsureEngineer.M4).toBeCloseTo(0.3);
    const bothUnsure = typeDistribution({ structure: "stone" }, URBAN_KRG);
    expect(bothUnsure.M4).toBeCloseTo(0.3);
  });

  it("mud brick is M2 and wood is T1", () => {
    expect(typeDistribution({ structure: "mud" }, URBAN_KRG)).toEqual({ M2: 1 });
    expect(typeDistribution({ structure: "wood" }, URBAN_KRG)).toEqual({ T1: 1 });
  });

  it("an old, non-engineered concrete frame is RC1-L", () => {
    const types = typeDistribution(
      { structure: "frame", builder: "builder", age: "over50" },
      URBAN_KRG,
    );
    expect(types).toEqual({ "RC1-L": 1 });
  });

  it("an engineered but old frame stays RC1-L", () => {
    expect(
      typeDistribution(
        { structure: "frame", builder: "eng_full", age: "a25_50" },
        URBAN_KRG,
      ),
    ).toEqual({ "RC1-L": 1 });
  });

  it("a new, non-engineered frame stays RC1-L", () => {
    expect(
      typeDistribution(
        { structure: "frame", builder: "self", age: "under10" },
        URBAN_KRG,
      ),
    ).toEqual({ "RC1-L": 1 });
  });

  it("an engineered frame under 25 years is RC1-M 0.6 / RC1-L 0.4, never H", () => {
    for (const age of ["under10", "a10_25"]) {
      const types = typeDistribution(
        { structure: "frame", builder: "eng_full", age },
        URBAN_KRG,
      );
      expect(types["RC1-M"]).toBeCloseTo(0.6);
      expect(types["RC1-L"]).toBeCloseTo(0.4);
      expect(types["RC1-H"]).toBeUndefined();
    }
  });

  it("frame with unknown engineer and age mixes by the don't-know shares", () => {
    const types = typeDistribution({ structure: "frame" }, URBAN_KRG);
    expect(types["RC1-M"]).toBeCloseTo(0.6 * ENGINEERED_DONT_KNOW * NEW_DONT_KNOW);
    expect(sum(Object.values(types))).toBeCloseTo(1);
  });

  it("steel is S-L unless engineered and new", () => {
    expect(
      typeDistribution(
        { structure: "steel", builder: "builder", age: "under10" },
        URBAN_KRG,
      ),
    ).toEqual({ "S-L": 1 });
    expect(
      typeDistribution(
        { structure: "steel", builder: "eng_full", age: "under10" },
        URBAN_KRG,
      ),
    ).toEqual({ "S-M/H": 1 });
    expect(
      typeDistribution(
        { structure: "steel", builder: "eng_full", age: "over50" },
        URBAN_KRG,
      ),
    ).toEqual({ "S-L": 1 });
  });

  it("an unknown structure falls back to the region, settlement and storey prior", () => {
    const urban = typeDistribution({ structure: "dk", floors: "f2" }, URBAN_KRG);
    const expected = TYPE_PRIORS.kurdistan.urban["2"];
    expect(urban.M6).toBeCloseTo(
      (expected.M6 as number) / sum(Object.values(expected)),
      4,
    );

    const tall = typeDistribution({ floors: "f6_10" }, URBAN_KRG);
    expect(Object.keys(tall)).toContain("RC1-L");
    expect(rankedTypes(tall)[0]?.type).toBe("RC1-L");

    const ruralTall = typeDistribution({ floors: "f11p" }, RURAL_KRG);
    expect(rankedTypes(ruralTall)[0]?.type).toBe("RC1-H");

    const iraq = typeDistribution({ floors: "f3" }, URBAN_IRAQ);
    expect(rankedTypes(iraq)[0]?.type).toBe("M3");
    expect(rankedTypes(typeDistribution({ floors: "f3" }, URBAN_KRG))[0]?.type).toBe(
      "M6",
    );
  });

  it("an unknown structure and floors uses the 'unknown' band", () => {
    const types = typeDistribution({}, URBAN_KRG);
    expect(rankedTypes(types)[0]?.type).toBe("M6");
    expect(sum(Object.values(types))).toBeCloseTo(1, 6);
  });

  it("maps floors answers to storey bands", () => {
    expect(
      ["f1", "f2", "f3", "f4_5", "f6_10", "f11p", "dk", undefined].map(storeyBand),
    ).toEqual(["1", "2", "3", "4-5", "6+", "6+", "unknown", "unknown"]);
  });

  it("every distribution sums to one and only uses known types", () => {
    const structures = ["frame", "block", "brick", "stone", "mud", "steel", "wood", "dk"];
    const known = new Set(IMS_TYPES.map((entry) => entry.type));
    for (const structure of structures) {
      for (const builder of ["eng_full", "builder", "dk"]) {
        for (const age of ["under10", "over50", "dk"]) {
          const types = typeDistribution({ structure, builder, age }, URBAN_KRG);
          expect(sum(Object.values(types))).toBeCloseTo(1, 6);
          for (const type of Object.keys(types)) {
            expect(known.has(type)).toBe(true);
          }
        }
      }
    }
  });
});

describe("vulnerability class", () => {
  it("is the type-weighted sum of the type priors", () => {
    const vc = vcDistribution({ M6: 0.5, M7: 0.5 });
    expect(vc.B).toBeCloseTo(0.125);
    expect(vc.C).toBeCloseTo((0.625 + 0.125) / 2);
    expect(vc.D).toBeCloseTo((0.125 + 0.625) / 2);
    expect(vc.E).toBeCloseTo(0.125);
    expect(sum(Object.values(vc))).toBeCloseTo(1);
  });

  it("picks the most likely class and keeps the more vulnerable on a tie", () => {
    expect(mostLikelyVc({ A: 0, B: 0.25, C: 0.625, D: 0.125, E: 0, F: 0 })).toBe("C");
    expect(mostLikelyVc({ A: 0, B: 0.5, C: 0.5, D: 0, E: 0, F: 0 })).toBe("B");
  });

  it("shifts mass toward more vulnerable and keeps A absorbing", () => {
    const start: VcProbs = { A: 0.1, B: 0.2, C: 0.7, D: 0, E: 0, F: 0 };
    const up = shiftVc(start, 1);
    expect(up.A).toBeCloseTo(0.3);
    expect(up.B).toBeCloseTo(0.7);
    expect(up.C).toBe(0);
    const twice = shiftVc(start, 2);
    expect(twice.A).toBeCloseTo(1);
    expect(sum(Object.values(shiftVc(start, 5)))).toBeCloseTo(1);
  });

  it("shifts mass toward less vulnerable and keeps F absorbing", () => {
    const start: VcProbs = { A: 0, B: 0, C: 0, D: 0.2, E: 0.3, F: 0.5 };
    const down = shiftVc(start, -1);
    expect(down.D).toBe(0);
    expect(down.E).toBeCloseTo(0.2);
    expect(down.F).toBeCloseTo(0.8);
  });

  it("counts the five weaker-building signs", () => {
    expect(vulnerableSigns({})).toBe(0);
    expect(
      vulnerableSigns({
        added: "yes",
        openGround: "yes",
        shape: "overhang",
        cracks: "large",
        pastDamage: "heavy",
      }),
    ).toBe(5);
    expect(vulnerableSigns({ shape: "irregular" })).toBe(1);
    expect(
      vulnerableSigns({ cracks: "hairline", pastDamage: "cracks", added: "dk" }),
    ).toBe(0);
  });

  it("the engineer benefit is one shift, from either source, not both", () => {
    expect(hasEngineerBenefit({ builder: "eng_full" })).toBe(true);
    expect(hasEngineerBenefit({ builder: "eng_plans" })).toBe(false);
    expect(hasEngineerBenefit({ strengthened: "strengthening" })).toBe(true);
    expect(hasEngineerBenefit({ strengthened: "repairs" })).toBe(false);
    expect(netShift({ builder: "eng_full", strengthened: "strengthening" })).toBe(-1);
  });

  it("modifiers move the class one step each, capped at two", () => {
    const base: Answers = { structure: "block", belts: "no", roof: "slab" };
    expect(assessAnswers(base, URBAN_KRG).vc_most_likely).toBe("C");
    expect(assessAnswers({ ...base, added: "yes" }, URBAN_KRG).vc_most_likely).toBe("B");
    expect(
      assessAnswers({ ...base, added: "yes", openGround: "yes" }, URBAN_KRG)
        .vc_most_likely,
    ).toBe("A");
    // A third sign changes nothing: capped at two shifts.
    const two = assessAnswers({ ...base, added: "yes", openGround: "yes" }, URBAN_KRG);
    const five = assessAnswers(
      {
        ...base,
        added: "yes",
        openGround: "yes",
        shape: "irregular",
        cracks: "large",
        pastDamage: "heavy",
      },
      URBAN_KRG,
    );
    expect(five.vc_probs).toEqual(two.vc_probs);
  });

  it("an engineer-supervised or strengthened building is one class better", () => {
    const base: Answers = { structure: "block", belts: "no", roof: "slab" };
    expect(
      assessAnswers({ ...base, builder: "eng_full" }, URBAN_KRG).vc_most_likely,
    ).toBe("D");
    expect(
      assessAnswers({ ...base, strengthened: "strengthening" }, URBAN_KRG).vc_most_likely,
    ).toBe("D");
    expect(
      assessAnswers(
        { ...base, builder: "eng_full", strengthened: "strengthening" },
        URBAN_KRG,
      ).vc_most_likely,
    ).toBe("D");
  });

  it("signs and the engineer benefit cancel", () => {
    const base: Answers = { structure: "block", belts: "no", roof: "slab" };
    expect(
      assessAnswers({ ...base, builder: "eng_full", added: "yes" }, URBAN_KRG).vc_probs,
    ).toEqual(assessAnswers(base, URBAN_KRG).vc_probs);
  });
});

describe("range", () => {
  it("is the smallest contiguous span covering at least 80 %", () => {
    expect(vcRange({ A: 0, B: 0.25, C: 0.625, D: 0.125, E: 0, F: 0 })).toEqual({
      from: "B",
      to: "C",
    });
    expect(vcRange({ A: 0, B: 0.1, C: 0.2, D: 0.5, E: 0.2, F: 0 })).toEqual({
      from: "C",
      to: "E",
    });
    expect(vcRange({ A: 0, B: 0, C: 0.85, D: 0.15, E: 0, F: 0 })).toEqual({
      from: "C",
      to: "C",
    });
    expect(vcRange({ A: 0, B: 0, C: 0.5, D: 0.4, E: 0.1, F: 0 })).toEqual({
      from: "C",
      to: "D",
    });
  });

  it("prefers the span with more mass when two have the same length", () => {
    expect(vcRange({ A: 0.4, B: 0.4, C: 0.2, D: 0, E: 0, F: 0 })).toEqual({
      from: "A",
      to: "B",
    });
  });

  it("formats and parses the stored string", () => {
    expect(formatVcRange({ from: "C", to: "C" })).toBe("C");
    expect(formatVcRange({ from: "B", to: "D" })).toBe("B-D");
    expect(parseVcRange("B-D")).toEqual({ from: "B", to: "D" });
    expect(parseVcRange("E")).toEqual({ from: "E", to: "E" });
    expect(parseVcRange(null)).toBeNull();
    expect(parseVcRange("nonsense")).toBeNull();
  });

  it("always contains the most likely class", () => {
    for (const structure of ["frame", "block", "stone", "dk"]) {
      const result = assessAnswers({ structure, builder: "dk", age: "dk" }, URBAN_KRG);
      const range = parseVcRange(result.vc_range);
      const order = ["A", "B", "C", "D", "E", "F"];
      expect(range).not.toBeNull();
      const index = order.indexOf(result.vc_most_likely);
      expect(index).toBeGreaterThanOrEqual(order.indexOf(range?.from as string));
      expect(index).toBeLessThanOrEqual(order.indexOf(range?.to as string));
    }
  });
});

describe("confidence", () => {
  it("is answered structural questions over all structural questions", () => {
    expect(confidence({})).toBe(0);
    expect(
      confidence({
        floors: "f2",
        age: "a10_25",
        builder: "eng_full",
        structure: "frame",
      }),
    ).toBe(1);
    expect(
      confidence({ floors: "f2", age: "dk", builder: "dk", structure: "frame" }),
    ).toBe(0.5);
  });

  it("adds the branch questions for walls and stone", () => {
    const walls: Answers = {
      floors: "f2",
      age: "a10_25",
      builder: "builder",
      structure: "block",
    };
    // floors, age, builder, structure, belts, roof: 4 of 6 answered.
    expect(confidence(walls)).toBeCloseTo(4 / 6);
    expect(confidence({ ...walls, belts: "yes", roof: "dk" })).toBeCloseTo(5 / 6);
    expect(confidence({ ...walls, belts: "yes", roof: "slab" })).toBe(1);
    expect(confidence({ ...walls, structure: "stone", stone: "dressed" })).toBe(1);
  });

  it("ignores the modifier questions", () => {
    const answers: Answers = { floors: "f2", age: "dk", builder: "dk", structure: "dk" };
    expect(confidence({ ...answers, cracks: "large", added: "yes" })).toBe(
      confidence(answers),
    );
  });

  it("is rounded into the assessment", () => {
    expect(assessAnswers({ structure: "wood" }, URBAN_KRG).confidence).toBe(0.25);
  });
});

describe("assessAnswers", () => {
  it("returns the method, a full VC distribution and a rounded type map", () => {
    const result = assessAnswers(
      { structure: "block", belts: "dk", roof: "slab" },
      URBAN_KRG,
    );
    expect(result.method).toBe(METHOD);
    expect(METHOD).toBe("auto-v0");
    expect(result.ims_type_probs).toEqual({ M6: 0.5, M7: 0.5 });
    expect(Object.keys(result.vc_probs)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(sum(Object.values(result.vc_probs))).toBeCloseTo(1, 3);
    expect(result.vc_range).toMatch(/^[A-F](-[A-F])?$/);
  });

  it("is deterministic", () => {
    const answers: Answers = {
      structure: "frame",
      builder: "eng_full",
      age: "under10",
      floors: "f4_5",
    };
    expect(assessAnswers(answers, URBAN_KRG)).toEqual(assessAnswers(answers, URBAN_KRG));
  });

  it("an engineered new frame is better than an old non-engineered one", () => {
    const strong = assessAnswers(
      { structure: "frame", builder: "eng_full", age: "under10" },
      URBAN_KRG,
    );
    const weak = assessAnswers(
      { structure: "frame", builder: "self", age: "over50" },
      URBAN_KRG,
    );
    const order = "ABCDEF";
    expect(order.indexOf(strong.vc_most_likely)).toBeGreaterThan(
      order.indexOf(weak.vc_most_likely),
    );
  });
});

describe("place", () => {
  it("Erbil centre is urban Kurdistan", () => {
    expect(contextForLocation(36.19, 44.01)).toEqual({
      region: "kurdistan",
      settlement: "urban",
    });
  });

  it("open country far from any city is rural", () => {
    expect(contextForLocation(36.55, 43.2).settlement).toBe("rural");
  });

  it("Baghdad is urban and outside the Kurdistan Region", () => {
    expect(contextForLocation(33.31, 44.37)).toEqual({
      region: "iraq",
      settlement: "urban",
    });
  });
});

describe("hazard", () => {
  it("reads design PGA, zone, Vs30 and site class at Sulaimani", () => {
    const hazard = siteHazard(35.56, 45.43);
    expect(hazard.source).toBe("ISC-2025");
    expect(hazard.pga_g).toBeGreaterThan(0.05);
    expect(hazard.pga_g).toBeLessThan(2);
    expect(hazard.zone).toMatch(/^(I|II|III|IV|V)$/);
    expect(hazard.vs30).toBeGreaterThan(100);
    expect(["A", "B", "C", "D"]).toContain(hazard.site_class);
  });

  it("returns nulls outside the mapped area", () => {
    const hazard = siteHazard(48.85, 2.35);
    expect(hazard.pga_g).toBeNull();
    expect(hazard.zone).toBeNull();
    expect(hazard.vs30).toBeNull();
    expect(hazard.site_class).toBeNull();
  });

  it("assessBuilding adds the hazard at the point", () => {
    const result = assessBuilding(
      { structure: "block", belts: "no", roof: "slab" },
      36.19,
      44.01,
    );
    expect(result.hazard.pga_g).not.toBeNull();
    expect(result.ims_type_probs).toEqual({ M6: 1 });
  });
});

describe("expected damage", () => {
  it("reads the IMS-25 damage logic for a class and intensity", () => {
    expect(expectedDamage("C", "VII")).toEqual([{ grade: 2, quantity: "few" }]);
    expect(expectedDamage("B", "VII")).toEqual([
      { grade: 2, quantity: "many" },
      { grade: 3, quantity: "few" },
    ]);
    expect(expectedDamage("A", "VIII")).toEqual([
      { grade: 4, quantity: "many" },
      { grade: 5, quantity: "few" },
    ]);
  });

  it("is empty where the logic expects no damage", () => {
    expect(expectedDamage("F", "VI")).toEqual([]);
    expect(expectedDamage("E", "VII")).toEqual([]);
  });

  it("builds the VI / VII / VIII table", () => {
    const table = expectedDamageTable("D");
    expect(table.map((row) => row.intensity)).toEqual(["VI", "VII", "VIII"]);
    expect(table[0]?.damage).toEqual([]);
    expect(table[1]?.damage).toEqual([{ grade: 1, quantity: "few" }]);
    expect(table[2]?.damage).toEqual([{ grade: 2, quantity: "few" }]);
  });
});

describe("types in plain words and tips", () => {
  it("maps every IMS-25 type to a plain-language key", () => {
    for (const entry of IMS_TYPES) {
      expect(plainTypeKey(entry.type)).toMatch(/^[A-Za-z0-9]+$/);
    }
    expect(plainTypeKey("RC1-L")).toBe("RCframe");
    expect(plainTypeKey("RC6-M")).toBe("RCprecast");
    expect(plainTypeKey("RC4")).toBe("RC4");
    expect(plainTypeKey("S-M/H")).toBe("steel");
    expect(plainTypeKey("T2-L")).toBe("timber");
  });

  it("ranks types by probability", () => {
    expect(rankedTypes({ M6: 0.3, M7: 0.7, M5: 0 })).toEqual([
      { type: "M7", probability: 0.7 },
      { type: "M6", probability: 0.3 },
    ]);
  });

  it("picks the dominant family", () => {
    expect(dominantFamily({ M6: 0.6, "RC1-L": 0.4 })).toBe("masonry");
    expect(dominantFamily({ M6: 0.3, "RC1-L": 0.5, "RC1-M": 0.1, T1: 0.1 })).toBe("rc");
    expect(dominantFamily({ "S-L": 1 })).toBe("other");
    expect(dominantFamily({ M2: 0.2, T1: 0.5, "S-L": 0.3 })).toBe("other");
  });

  it("gives exactly three tip keys for the family", () => {
    expect(improvementTips({ M6: 1 })).toEqual([
      "building.tips.masonry.1",
      "building.tips.masonry.2",
      "building.tips.masonry.3",
    ]);
    expect(improvementTips({ "RC1-L": 1 })[0]).toBe("building.tips.rc.1");
    expect(improvementTips({ T1: 1 })).toHaveLength(3);
    expect(improvementTips({ T1: 1 })[2]).toBe("building.tips.other.3");
  });
});
