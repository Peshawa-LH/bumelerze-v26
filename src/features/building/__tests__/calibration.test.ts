import { assessAnswers, mostLikelyVc, type AssessmentContext } from "../assessment";
import type { VulnerabilityClass } from "../ims25";
import type { Answers } from "../questionnaire";

/**
 * The 12 typical buildings of the calibration review (D14 checkpoint,
 * owner-approved 2026-10-14). Each row: the answers a homeowner would give,
 * the place, what auto-v0 said ("today", for the record) and what auto-v1
 * must say. A change that moves any of these is a science change and goes
 * back to the owner.
 */

const RURAL_IRAQ: AssessmentContext = { region: "iraq", settlement: "rural" };
const URBAN_IRAQ: AssessmentContext = { region: "iraq", settlement: "urban" };
const URBAN_KRG: AssessmentContext = { region: "kurdistan", settlement: "urban" };

interface Case {
  n: number;
  building: string;
  answers: Answers;
  context: AssessmentContext;
  /** auto-v0, most likely (80 % range). */
  today: string;
  likely: VulnerabilityClass;
  range: string;
}

const CASES: Case[] = [
  {
    n: 1,
    building: "village mud-brick house, 1 floor",
    context: RURAL_IRAQ,
    answers: {
      use: "house_single",
      floors: "f1",
      age: "over50",
      builder: "self",
      structure: "mud",
    },
    today: "A (A-B)",
    likely: "A",
    range: "A-B",
  },
  {
    n: 2,
    building: "rubble-stone village house",
    context: RURAL_IRAQ,
    answers: {
      use: "house_single",
      floors: "f1",
      age: "over50",
      builder: "self",
      structure: "stone",
      stone: "rough",
    },
    today: "B (B)",
    likely: "B",
    range: "B",
  },
  {
    n: 3,
    building: "old brick house, jack-arch roof, 2 floors",
    context: URBAN_IRAQ,
    answers: {
      use: "house_single",
      floors: "f2",
      age: "over50",
      builder: "builder",
      structure: "brick",
      belts: "no",
      roof: "jack_arch",
    },
    today: "B (A-B)",
    likely: "B",
    range: "A-B",
  },
  {
    n: 4,
    building: "hollow-block house, concrete roof, no belts, 1 floor",
    context: URBAN_IRAQ,
    answers: {
      use: "house_single",
      floors: "f1",
      age: "a10_25",
      builder: "builder",
      structure: "block",
      belts: "no",
      roof: "slab",
    },
    today: "C (B-C)",
    likely: "B",
    range: "B-C",
  },
  {
    n: 5,
    building: "block house with belts and corner columns, by a builder",
    context: URBAN_KRG,
    answers: {
      use: "house_single",
      floors: "f2",
      age: "a10_25",
      builder: "builder",
      structure: "block",
      belts: "yes",
      roof: "slab",
    },
    today: "D (D-E)",
    likely: "C",
    range: "C-D",
  },
  {
    n: 6,
    building: "concrete frame with block infill, 3 floors, by a builder",
    context: URBAN_KRG,
    answers: {
      use: "house_single",
      floors: "f3",
      age: "a10_25",
      builder: "builder",
      structure: "frame",
    },
    today: "C (A-C)",
    likely: "C",
    range: "A-C",
  },
  {
    n: 7,
    building: "concrete frame, engineer designed and supervised, under 10 years",
    context: URBAN_KRG,
    answers: {
      use: "apartment",
      floors: "f4_5",
      age: "under10",
      builder: "eng_full",
      structure: "frame",
    },
    today: "E (C-E)",
    // "C-D" in the review: C and D are within a fraction of a point and the
    // tie rule would keep C; D is ahead by 0.2 points.
    likely: "D",
    range: "B-D",
  },
  {
    n: 8,
    building: "concrete frame with an open shop ground floor",
    context: URBAN_KRG,
    answers: {
      use: "mixed",
      floors: "f3",
      age: "a10_25",
      builder: "builder",
      structure: "frame",
      openGround: "yes",
    },
    today: "B (A-B)",
    likely: "B",
    range: "A-B",
  },
  {
    n: 9,
    building: "8-storey frame, engineer plans only (no supervision)",
    context: URBAN_KRG,
    answers: {
      use: "apartment",
      floors: "f6_10",
      age: "a10_25",
      builder: "eng_plans",
      structure: "frame",
    },
    today: "D (B-D)",
    likely: "C",
    range: "B-D",
  },
  {
    n: 10,
    building: "steel workshop, by a builder",
    context: URBAN_IRAQ,
    answers: {
      use: "industrial",
      floors: "f1",
      age: "a10_25",
      builder: "builder",
      structure: "steel",
    },
    today: "D (C-E)",
    likely: "D",
    range: "C-E",
  },
  {
    n: 11,
    building: "unknown structure, 2 floors, Kurdistan Region city",
    context: URBAN_KRG,
    answers: {
      use: "house_single",
      floors: "f2",
      age: "dk",
      builder: "dk",
      structure: "dk",
      cornerColumns: "dk",
    },
    today: "C (B-D)",
    likely: "C",
    range: "B-D",
  },
  {
    n: 12,
    building: "unknown structure, 1 floor, rural Iraq",
    context: RURAL_IRAQ,
    answers: {
      use: "house_single",
      floors: "f1",
      age: "dk",
      builder: "dk",
      structure: "dk",
      cornerColumns: "dk",
    },
    today: "B (A-D), E+F 15 %",
    likely: "B",
    range: "A-D",
  },
];

describe("calibration review 2026-10-14: the 12 typical buildings", () => {
  it.each(CASES)("$n: $building is $likely ($range), was $today", (row) => {
    const result = assessAnswers(row.answers, row.context);
    expect(result.vc_most_likely).toBe(row.likely);
    expect(result.vc_range).toBe(row.range);
  });

  it("7: C and D stay within two points of each other (the review's C-D)", () => {
    const row = CASES[6] as Case;
    const { vc_probs: probs } = assessAnswers(row.answers, row.context);
    expect(Math.abs(probs.C - probs.D)).toBeLessThan(0.02);
    expect(probs.E).toBeLessThan(0.15);
  });

  it("12: an unknown rural one-storey home in Iraq has at most 6 % in E and F", () => {
    const row = CASES[11] as Case;
    const { vc_probs: probs } = assessAnswers(row.answers, row.context);
    expect(probs.E + probs.F).toBeLessThanOrEqual(0.06);
  });

  // Review C-5 (owner, 2026-10-14): for the belts-and-columns house only
  // "designed and supervised by an engineer" earns the IMS table's D; plans
  // nobody supervised get the same non-engineered shift as a builder.
  describe("5: the belts-and-columns house, by who built it", () => {
    const row = CASES[4] as Case;
    it.each([
      ["builder", "C", "C-D"],
      ["self", "C", "C-D"],
      ["dk", "C", "C-D"],
      ["eng_plans", "C", "C-D"],
      ["eng_full", "D", "D-E"],
    ] as const)("%s: %s (%s)", (builder, likely, range) => {
      for (const answers of [
        { ...row.answers, builder },
        { ...row.answers, structure: "confined", belts: undefined, roof: undefined, builder },
      ] as Answers[]) {
        const result = assessAnswers(answers, row.context);
        expect(result.vc_most_likely).toBe(likely);
        expect(result.vc_range).toBe(range);
      }
    });
  });

  it("the new confined option, built by a builder, is the same as case 5", () => {
    const row = CASES[4] as Case;
    const confined = assessAnswers(
      {
        use: "house_single",
        floors: "f2",
        age: "a10_25",
        builder: "builder",
        structure: "confined",
      },
      row.context,
    );
    expect(confined.vc_most_likely).toBe("C");
    expect(confined.vc_range).toBe("C-D");
    expect(mostLikelyVc(confined.vc_probs)).toBe("C");
  });
});
