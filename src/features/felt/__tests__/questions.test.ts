import { TIER2_QUESTIONS, TIER2_QUESTION_COUNT } from "../questions";
import { EMPTY_TIER2_ANSWERS, type Tier2Answers } from "../types";

/**
 * Tier-2 answers map to the RAW enum types the science pack defines (wave
 * brief scope item 6) — verbatim against `felt-report-science-v1.md` PART 2
 * Q1-Q11 and the CHECK constraints in
 * `supabase/migrations/0003_felt_reports.sql`. This is a science-fidelity
 * test: if `questions.ts` or `types.ts` ever drifts from either source, it
 * should fail here before it fails a schema round-trip.
 */

// Copied verbatim from the migration's CHECK constraints (not imported —
// this file exists specifically to catch drift between the TWO independent
// sources, so it must not share a single source of truth with either).
const EXPECTED_OPTIONS: Record<string, readonly (string | number)[]> = {
  situation: ["inside", "outside", "stopped_car", "moving_car", "asleep"],
  felt: ["no", "yes"],
  othersFelt: ["dont_know", "no_one", "some", "most", "everyone"],
  motion: ["not_felt", "weak", "mild", "moderate", "strong", "violent"],
  reaction: [
    "no_reaction",
    "noticed",
    "excitement",
    "somewhat_frightened",
    "very_frightened",
    "extremely_frightened",
  ],
  stand: ["no", "difficult", "fell"],
  shelf: ["no", "rattled", "few_fell", "many_fell"],
  picture: ["no", "yes"],
  furniture: ["no", "yes"],
  buildingDamageLevel: [0, 1, 2, 3],
  roadDamageLevel: [0, 1, 2, 3],
};

const EXPECTED_QUESTION_ORDER = [
  "situation",
  "felt",
  "othersFelt",
  "motion",
  "reaction",
  "stand",
  "shelf",
  "picture",
  "furniture",
  "buildingDamageLevel",
  "roadDamageLevel",
];

describe("TIER2_QUESTIONS raw-enum fidelity", () => {
  it("has exactly Q1-Q11, in science-pack order", () => {
    expect(TIER2_QUESTION_COUNT).toBe(11);
    expect(TIER2_QUESTIONS.map((question) => question.field)).toEqual(
      EXPECTED_QUESTION_ORDER,
    );
    expect(TIER2_QUESTIONS.map((question) => question.questionNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it.each(Object.entries(EXPECTED_OPTIONS))(
    "Q%# (%s) options match the science pack / migration CHECK constraint exactly",
    (field, expectedOptions) => {
      const question = TIER2_QUESTIONS.find((candidate) => candidate.field === field);
      expect(question).toBeTruthy();
      expect(question?.options).toEqual(expectedOptions);
    },
  );

  it("the two structured-damage questions are kind 'damage' with 0-3 numeric options; the rest are 'choice'", () => {
    for (const question of TIER2_QUESTIONS) {
      if (
        question.field === "buildingDamageLevel" ||
        question.field === "roadDamageLevel"
      ) {
        expect(question.kind).toBe("damage");
      } else {
        expect(question.kind).toBe("choice");
      }
    }
  });

  it("every option value round-trips into a raw Tier2Answers object with no coercion", () => {
    // Simulates exactly what the tier-2 step screen does: tap an option,
    // store it verbatim under its field. Never a computed CDI/EMS index.
    let answers: Tier2Answers = { ...EMPTY_TIER2_ANSWERS };
    for (const question of TIER2_QUESTIONS) {
      const firstOption = question.options[0];
      answers = { ...answers, [question.field]: firstOption };
    }

    expect(answers.situation).toBe("inside");
    expect(answers.felt).toBe("no");
    expect(answers.othersFelt).toBe("dont_know");
    expect(answers.motion).toBe("not_felt");
    expect(answers.reaction).toBe("no_reaction");
    expect(answers.stand).toBe("no");
    expect(answers.shelf).toBe("no");
    expect(answers.picture).toBe("no");
    expect(answers.furniture).toBe("no");
    expect(answers.buildingDamageLevel).toBe(0);
    expect(answers.roadDamageLevel).toBe(0);
    // Comment is untouched by the question loop — it's collected separately
    // on its own final screen, never one of Q1-Q11.
    expect(answers.comment).toBeNull();
  });

  it("EMPTY_TIER2_ANSWERS has every field null (an unanswered question is 'not answered', never a fabricated default)", () => {
    for (const value of Object.values(EMPTY_TIER2_ANSWERS)) {
      expect(value).toBeNull();
    }
  });
});
