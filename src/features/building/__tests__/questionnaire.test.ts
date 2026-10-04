import { assessBuilding } from "../assessment";
import {
  DONT_KNOW,
  QUESTIONNAIRE_VERSION,
  QUESTIONS,
  isAnswered,
  pruneAnswers,
  sanitizeAnswers,
  visibleQuestions,
  type Answers,
} from "../questionnaire";
import { surveyPayload } from "../service";

const RESEARCH = ["use", "basement", "adjacency", "size", "peopleDay", "peopleNight"];

function question(id: string) {
  const found = QUESTIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no question ${id}`);
  return found;
}

describe("questionnaire version", () => {
  it("is bumped to q-v1 for the research questions", () => {
    expect(QUESTIONNAIRE_VERSION).toBe("q-v1");
  });
});

describe("research questions (q-v1)", () => {
  it("all exist, in the draft's order, each ending in 'I don't know'", () => {
    const ids = QUESTIONS.map((q) => q.id as string);
    for (const id of RESEARCH) {
      expect(ids).toContain(id);
      expect(question(id).options.at(-1)).toBe(DONT_KNOW);
    }
    expect(ids[0]).toBe("use");
    expect(ids.indexOf("basement")).toBe(ids.indexOf("floors") + 1);
    expect(ids.indexOf("adjacency")).toBeGreaterThan(ids.indexOf("shape"));
  });

  it("have the agreed answer shapes", () => {
    expect(question("use").options).toEqual([
      "house",
      "apartments",
      "shop_below",
      "other",
      "dk",
    ]);
    expect(question("basement").options).toEqual(["none", "part", "full", "dk"]);
    expect(question("adjacency").options).toEqual([
      "alone",
      "one_side",
      "both_sides",
      "dk",
    ]);
    expect(question("size").options).toEqual([
      "u100",
      "s100_200",
      "s200_400",
      "o400",
      "dk",
    ]);
    expect(question("peopleDay").options).toEqual([
      "p1_2",
      "p3_5",
      "p6_10",
      "p11_20",
      "p21p",
      "dk",
    ]);
    expect(question("peopleNight").options).toEqual(question("peopleDay").options);
  });

  it("size and the people questions are optional, the rest are not", () => {
    for (const id of RESEARCH) {
      expect(question(id).optional === true).toBe(
        ["size", "peopleDay", "peopleNight"].includes(id),
      );
    }
  });

  it("are asked for every structure and never count towards confidence", () => {
    for (const structure of ["frame", "block", "stone", "mud", "wood"]) {
      const ids = visibleQuestions({ structure }).map((q) => q.id as string);
      for (const id of RESEARCH) {
        expect(ids).toContain(id);
      }
    }
    for (const id of RESEARCH) {
      expect(question(id).structural).toBe(false);
    }
  });

  it("are kept by sanitizeAnswers and pruneAnswers; unknown options are dropped", () => {
    const stored = {
      use: "apartments",
      basement: "full",
      adjacency: "both_sides",
      size: "o400",
      peopleDay: "p3_5",
      peopleNight: "p21p",
      structure: "frame",
    };
    expect(sanitizeAnswers(stored)).toEqual(stored);
    expect(pruneAnswers(stored)).toEqual(stored);
    expect(sanitizeAnswers({ use: "castle", size: "huge" })).toEqual({});
  });

  it("are stored in the survey payload next to the location quality", () => {
    const answers: Answers = { use: "house", size: "s100_200", peopleNight: DONT_KNOW };
    expect(surveyPayload(answers, "pin")).toEqual({
      use: "house",
      size: "s100_200",
      peopleNight: "dk",
      location_quality: "pin",
    });
  });

  it("'I don't know' counts as unanswered for the research answers too", () => {
    expect(isAnswered({ size: "dk" }, "size")).toBe(false);
    expect(isAnswered({ size: "u100" }, "size")).toBe(true);
  });
});

describe("the assessment ignores the research answers", () => {
  const base: Answers = {
    floors: "f3",
    age: "a25_50",
    builder: "builder",
    structure: "block",
    belts: "no",
    roof: "slab",
    added: "no",
    openGround: "yes",
    shape: "box",
    strengthened: "no",
    cracks: "none",
    pastDamage: "none",
  };
  const research: Answers = {
    use: "shop_below",
    basement: "full",
    adjacency: "both_sides",
    size: "o400",
    peopleDay: "p21p",
    peopleNight: "p11_20",
  };

  it("gives the same type distribution, class, confidence and hazard", () => {
    const without = assessBuilding(base, 36.19, 44.01);
    const withResearch = assessBuilding({ ...base, ...research }, 36.19, 44.01);
    expect(withResearch).toEqual(without);
  });
});
