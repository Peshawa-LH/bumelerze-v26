import { CARTOON_TO_INTENSITY, scoreTier2Report } from "../cdi-scoring";
import { EMPTY_TIER2_ANSWERS } from "@/features/felt/types";
import type { Tier2Answers } from "@/features/felt/types";

function answers(overrides: Partial<Tier2Answers>): Tier2Answers {
  return { ...EMPTY_TIER2_ANSWERS, ...overrides };
}

describe("scoreTier2Report — Q2/Q3 felt x othersFelt modifier chain (D18 R2)", () => {
  // felt-report-science-v1.md §2 Q3, DYFI v4 getFeltFromOther verbatim:
  // other_felt<2 -> unchanged; ==2 -> 0.36 (0 if felt=no); ==3 -> 0.72;
  // >=4 -> 1. Codes: dont_know=0, no_one=1, some=2, most=3, everyone=4.

  it("dont_know (code 0) leaves felt unchanged", () => {
    expect(scoreTier2Report(answers({ felt: "no", othersFelt: "dont_know" })).felt).toBe(
      0,
    );
    expect(scoreTier2Report(answers({ felt: "yes", othersFelt: "dont_know" })).felt).toBe(
      1,
    );
  });

  it("no_one (code 1) leaves felt unchanged", () => {
    expect(scoreTier2Report(answers({ felt: "no", othersFelt: "no_one" })).felt).toBe(0);
    expect(scoreTier2Report(answers({ felt: "yes", othersFelt: "no_one" })).felt).toBe(1);
  });

  it("some (code 2) -> 0.36, except 0 when the respondent themself felt nothing", () => {
    expect(scoreTier2Report(answers({ felt: "yes", othersFelt: "some" })).felt).toBe(
      0.36,
    );
    expect(scoreTier2Report(answers({ felt: "no", othersFelt: "some" })).felt).toBe(0);
  });

  it("most (code 3) -> 0.72 regardless of the respondent's own felt answer", () => {
    expect(scoreTier2Report(answers({ felt: "yes", othersFelt: "most" })).felt).toBe(
      0.72,
    );
    expect(scoreTier2Report(answers({ felt: "no", othersFelt: "most" })).felt).toBe(0.72);
  });

  it("everyone (code 4) -> 1 regardless of the respondent's own felt answer", () => {
    expect(scoreTier2Report(answers({ felt: "yes", othersFelt: "everyone" })).felt).toBe(
      1,
    );
    expect(scoreTier2Report(answers({ felt: "no", othersFelt: "everyone" })).felt).toBe(
      1,
    );
  });

  it("felt unanswered (null) stays null regardless of othersFelt (this module's reading, documented in cdi-scoring.ts)", () => {
    expect(
      scoreTier2Report(answers({ felt: null, othersFelt: "everyone" })).felt,
    ).toBeNull();
    expect(scoreTier2Report(answers({ felt: null, othersFelt: null })).felt).toBeNull();
  });

  it("othersFelt unanswered (null) is treated the same as < 2 (unchanged)", () => {
    expect(scoreTier2Report(answers({ felt: "yes", othersFelt: null })).felt).toBe(1);
  });
});

describe("scoreTier2Report — Q4 motion, 0-5", () => {
  const cases: [Tier2Answers["motion"], number][] = [
    ["not_felt", 0],
    ["weak", 1],
    ["mild", 2],
    ["moderate", 3],
    ["strong", 4],
    ["violent", 5],
  ];
  it.each(cases)("%s -> %d", (motion, expected) => {
    expect(scoreTier2Report(answers({ motion })).motion).toBe(expected);
  });

  it("unanswered motion is null, not 0", () => {
    expect(scoreTier2Report(answers({ motion: null })).motion).toBeNull();
  });
});

describe("scoreTier2Report — Q5 reaction, 0-5", () => {
  const cases: [Tier2Answers["reaction"], number][] = [
    ["no_reaction", 0],
    ["noticed", 1],
    ["excitement", 2],
    ["somewhat_frightened", 3],
    ["very_frightened", 4],
    ["extremely_frightened", 5],
  ];
  it.each(cases)("%s -> %d", (reaction, expected) => {
    expect(scoreTier2Report(answers({ reaction })).reaction).toBe(expected);
  });
});

describe("scoreTier2Report — Q6 stand, 0-1 (D18 R3: fell capped at 1)", () => {
  it("no -> 0", () => {
    expect(scoreTier2Report(answers({ stand: "no" })).stand).toBe(0);
  });
  it("difficult -> 1", () => {
    expect(scoreTier2Report(answers({ stand: "difficult" })).stand).toBe(1);
  });
  it("fell -> 1 (capped, not a higher value — IX+ diagnostic reserved for EMS side)", () => {
    expect(scoreTier2Report(answers({ stand: "fell" })).stand).toBe(1);
  });
});

describe("scoreTier2Report — Q7 shelf, 0/0.5/0.75/1 (D18 R1)", () => {
  const cases: [Tier2Answers["shelf"], number][] = [
    ["no", 0],
    ["rattled", 0.5],
    ["few_fell", 0.75],
    ["many_fell", 1],
  ];
  it.each(cases)("%s -> %d", (shelf, expected) => {
    expect(scoreTier2Report(answers({ shelf })).shelf).toBe(expected);
  });
});

describe("scoreTier2Report — Q8/Q9 picture/furniture booleans", () => {
  it("picture no/yes -> 0/1", () => {
    expect(scoreTier2Report(answers({ picture: "no" })).picture).toBe(0);
    expect(scoreTier2Report(answers({ picture: "yes" })).picture).toBe(1);
  });
  it("furniture no/yes -> 0/1", () => {
    expect(scoreTier2Report(answers({ furniture: "no" })).furniture).toBe(0);
    expect(scoreTier2Report(answers({ furniture: "yes" })).furniture).toBe(1);
  });
});

describe("scoreTier2Report — building damage, 0/0.5/0.75/2/3 (2026-08-15 flow restructure, [REVIEW — Peshawa])", () => {
  // Window 2's 5-grade typology picker (features/felt/damage.ts) supersedes
  // the old Q10 questionnaire answer (which was 0/0.75/2/3, D18 R6) as this
  // index's source — see cdi-scoring.ts's own doc comment on DAMAGE_INDEX.
  const cases: [Tier2Answers["buildingDamageLevel"], number][] = [
    [0, 0],
    [1, 0.5],
    [2, 0.75],
    [3, 2],
    [4, 3],
  ];
  it.each(cases)("grade %d -> %s", (level, expected) => {
    expect(scoreTier2Report(answers({ buildingDamageLevel: level })).damage).toBe(
      expected,
    );
  });
});

describe("scoreTier2Report — vehicle rule (D18 R17: drop Q4/Q6 from consensus)", () => {
  it("moving_car nulls out motion and stand even when answered, keeps everything else", () => {
    const scored = scoreTier2Report(
      answers({
        situation: "moving_car",
        felt: "yes",
        othersFelt: "everyone",
        motion: "violent",
        reaction: "extremely_frightened",
        stand: "fell",
        shelf: "many_fell",
        picture: "yes",
        furniture: "yes",
        buildingDamageLevel: 2,
      }),
    );
    expect(scored.motion).toBeNull();
    expect(scored.stand).toBeNull();
    // Unaffected fields keep their normal scored values.
    expect(scored.felt).toBe(1);
    expect(scored.reaction).toBe(5);
    expect(scored.shelf).toBe(1);
    expect(scored.picture).toBe(1);
    expect(scored.furniture).toBe(1);
    expect(scored.damage).toBe(0.75);
  });

  it("inside/outside/stopped_car situations do NOT null motion/stand", () => {
    for (const situation of ["inside", "outside", "stopped_car", "asleep"] as const) {
      const scored = scoreTier2Report(
        answers({ situation, motion: "strong", stand: "difficult" }),
      );
      expect(scored.motion).toBe(4);
      expect(scored.stand).toBe(1);
    }
  });
});

describe("scoreTier2Report — null-exclusion (never zero-counted)", () => {
  it("a fully-unanswered report scores every index null, not 0", () => {
    const scored = scoreTier2Report(EMPTY_TIER2_ANSWERS);
    expect(scored).toEqual({
      felt: null,
      motion: null,
      reaction: null,
      stand: null,
      shelf: null,
      picture: null,
      furniture: null,
      damage: null,
    });
  });
});

describe("CARTOON_TO_INTENSITY — §3.3 identity table (D18 R9)", () => {
  it("levels 1-9 map 1:1", () => {
    for (let level = 1; level <= 9; level++) {
      expect(CARTOON_TO_INTENSITY[level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9]).toBe(
        level,
      );
    }
  });
  it("levels 10-12 all cap at 9.0", () => {
    expect(CARTOON_TO_INTENSITY[10]).toBe(9);
    expect(CARTOON_TO_INTENSITY[11]).toBe(9);
    expect(CARTOON_TO_INTENSITY[12]).toBe(9);
  });
});
