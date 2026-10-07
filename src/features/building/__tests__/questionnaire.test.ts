import { assessAnswers, assessBuilding, confidence } from "../assessment";
import {
  DONT_KNOW,
  QUESTIONNAIRE_VERSION,
  QUESTIONS,
  REMARKS_MAX,
  effectiveStructure,
  BUILDING_USES,
  LEGACY_USE,
  buildingKindFromUse,
  isResidentialUse,
  occupancyFromUse,
  questionTitleKey,
  isAnswered,
  pruneAnswers,
  routeAnswers,
  sanitizeAnswers,
  visibleQuestions,
  type Answers,
} from "../questionnaire";
import { saveSurveyAndAssessment, surveyPayload } from "../service";
import golden from "./fixtures/q-v1-golden.json";

/** Questions the assessment never reads (stored with the survey for research). */
const RESEARCH = ["use", "basement", "adjacency", "size", "people", "remarks"];

function question(id: string) {
  const found = QUESTIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no question ${id}`);
  return found;
}

describe("questionnaire version", () => {
  it("is q-v3", () => {
    expect(QUESTIONNAIRE_VERSION).toBe("q-v3");
  });

  it("is stored with the survey as q-v3", async () => {
    const saveSurvey = jest.fn().mockResolvedValue("s1");
    await saveSurveyAndAssessment(
      "t1",
      { lat: 36.19, lon: 44.01 },
      { use: "house_single" },
      {
        transport: {
          saveSurvey,
          saveAssessment: jest.fn().mockResolvedValue(undefined),
        } as never,
      },
    );
    expect(saveSurvey.mock.calls[0]?.[0]).toMatchObject({ version: "q-v3" });
  });
});

describe("q-v3: the first question is what kind of building it is", () => {
  const TABLE: [string, "house" | "apartment", string][] = [
    ["house_single", "house", "residential"],
    ["house_multi", "apartment", "residential"],
    ["apartment", "apartment", "residential"],
    ["mixed", "apartment", "residential"],
    ["commercial", "house", "commercial"],
    ["industrial", "house", "industrial"],
    ["public", "house", "public"],
    ["other", "house", "other"],
  ];

  it("has the eight building types and no 'I don't know'", () => {
    expect(question("use").options).toEqual(TABLE.map(([id]) => id));
    expect([...BUILDING_USES]).toEqual(TABLE.map(([id]) => id));
    expect(QUESTIONS[0]?.id).toBe("use");
    expect(question("use").firstScreen).toBe(true);
    expect(question("use").options).not.toContain(DONT_KNOW);
  });

  it.each(TABLE)("%s gives kind %s and occupancy %s", (use, kind, occupancy) => {
    expect(buildingKindFromUse(use)).toBe(kind);
    expect(occupancyFromUse(use)).toBe(occupancy);
    expect(isResidentialUse(use)).toBe(occupancy === "residential");
    // The survey payload carries the answer as `use` and the occupancy class.
    expect(surveyPayload({ use })).toEqual({ use, occupancy });
  });

  it("knows nothing about a missing or foreign answer", () => {
    for (const value of [undefined, "dk", "house", "castle"]) {
      expect(buildingKindFromUse(value)).toBeNull();
      expect(occupancyFromUse(value)).toBeNull();
    }
    // Unknown counts as a home: the assessment's calibration, no extra note.
    expect(isResidentialUse(undefined)).toBe(true);
    expect(surveyPayload({ floors: "f2" })).toEqual({ floors: "f2" });
  });

  it("asks the people question about 'inside' for a non-residential building only", () => {
    const home = "building.q.people.title";
    const building = "building.q.people.titleBuilding";
    for (const use of ["house_single", "house_multi", "apartment", "mixed"]) {
      expect(questionTitleKey("people", { use })).toBe(home);
    }
    for (const use of ["commercial", "industrial", "public", "other"]) {
      expect(questionTitleKey("people", { use })).toBe(building);
    }
    expect(questionTitleKey("people", {})).toBe(home);
    expect(questionTitleKey("floors", { use: "commercial" })).toBe(
      "building.q.floors.title",
    );
  });

  it("reads q-v2 answers with the same meaning", () => {
    const q2: [string, string][] = [
      ["house", "house_single"],
      ["shared_house", "house_multi"],
      ["apartments", "apartment"],
      ["shop_below", "mixed"],
      ["other", "other"],
    ];
    for (const [old, now] of q2) {
      expect(sanitizeAnswers({ use: old })).toEqual({ use: now });
      // the tag kind each old answer produced is unchanged
      expect(buildingKindFromUse(now)).toBe(
        old === "house" || old === "other" ? "house" : "apartment",
      );
    }
    expect(LEGACY_USE).toEqual(Object.fromEntries(q2));
  });

  it("reads q-v1 answers: house, apartments, shop_below, other; 'I don't know' is unanswered", () => {
    expect(sanitizeAnswers({ use: "house" })).toEqual({ use: "house_single" });
    expect(sanitizeAnswers({ use: "apartments" })).toEqual({ use: "apartment" });
    expect(sanitizeAnswers({ use: "shop_below" })).toEqual({ use: "mixed" });
    expect(sanitizeAnswers({ use: "other" })).toEqual({ use: "other" });
    expect(sanitizeAnswers({ use: "dk" })).toEqual({});
  });

  it("keeps q-v3 ids as they are", () => {
    for (const use of BUILDING_USES) {
      expect(sanitizeAnswers({ use })).toEqual({ use });
    }
  });
});

describe("N8: what holds the building up", () => {
  const ids = ["frame", "block", "brick", "stone", "mud", "steel", "wood", "dk"];

  it("keeps the existing answer ids, each with a picture", () => {
    expect(question("structure").options).toEqual(ids);
    expect(Object.keys(question("structure").pictograms ?? {}).sort()).toEqual(
      [...ids].sort(),
    );
  });

  it("shows the corner-column helper picture", () => {
    expect(question("structure").helperPictogram).toBe("structure-corner-column");
  });

  it("asks the corner-column follow-up only for 'I don't know'", () => {
    const ask = (answers: Answers) =>
      visibleQuestions(answers).some((q) => q.id === "cornerColumns");
    expect(ask({ structure: "dk" })).toBe(true);
    expect(ask({ structure: "frame" })).toBe(false);
    expect(ask({ structure: "block" })).toBe(false);
    expect(ask({})).toBe(false);
  });

  it("drops a follow-up answer when the structure changes to a known one", () => {
    expect(pruneAnswers({ structure: "frame", cornerColumns: "yes" })).toEqual({
      structure: "frame",
    });
  });

  it("routes 'columns at the corners: yes' to the frame, exactly like the frame answer", () => {
    expect(effectiveStructure({ structure: "dk", cornerColumns: "yes" })).toBe("frame");
    const context = { region: "kurdistan", settlement: "urban" } as const;
    const base = { floors: "f3", age: "a10_25", builder: "eng_full" };
    const viaFollowUp = assessAnswers(
      { ...base, structure: "dk", cornerColumns: "yes" },
      context,
    );
    const direct = assessAnswers({ ...base, structure: "frame" }, context);
    expect(viaFollowUp).toEqual(direct);
  });

  it("routes 'no columns' to unconfined walls and asks for the roof, not the belts", () => {
    expect(effectiveStructure({ structure: "dk", cornerColumns: "no" })).toBe("block");
    const ids = visibleQuestions({ structure: "dk", cornerColumns: "no" }).map(
      (q) => q.id,
    );
    expect(ids).toContain("roof");
    expect(ids).not.toContain("belts");
    const context = { region: "kurdistan", settlement: "urban" } as const;
    const base = { floors: "f2", age: "a25_50", builder: "builder", roof: "slab" };
    const viaFollowUp = assessAnswers(
      { ...base, structure: "dk", cornerColumns: "no" },
      context,
    );
    const direct = assessAnswers({ ...base, structure: "block", belts: "no" }, context);
    expect(viaFollowUp).toEqual(direct);
    expect(viaFollowUp.ims_type_probs.M6).toBeCloseTo(1, 2);
  });

  it("'I don't know' twice stays on the regional prior", () => {
    const context = { region: "kurdistan", settlement: "urban" } as const;
    const base = { floors: "f2", age: "a25_50", builder: "builder" };
    expect(effectiveStructure({ structure: "dk", cornerColumns: "dk" })).toBe("dk");
    expect(
      assessAnswers({ ...base, structure: "dk", cornerColumns: "dk" }, context),
    ).toEqual(assessAnswers({ ...base, structure: "dk" }, context));
  });

  it("does not change the confidence of answers that never saw the follow-up", () => {
    expect(question("cornerColumns").structural).toBe(false);
    const answers: Answers = { floors: "f2", structure: "dk" };
    expect(confidence(routeAnswers(answers))).toBe(confidence(answers));
    expect(routeAnswers(answers)).toBe(answers);
  });

  it("keeps the stone and belts follow-ups", () => {
    expect(visibleQuestions({ structure: "stone" }).map((q) => q.id)).toContain("stone");
    expect(visibleQuestions({ structure: "brick" }).map((q) => q.id)).toEqual(
      expect.arrayContaining(["belts", "roof"]),
    );
  });
});

describe("N9: the shape question", () => {
  it("has the four shapes, each drawn", () => {
    expect(question("shape").options).toEqual(["box", "irregular", "overhang", "dk"]);
    expect(question("shape").pictograms).toEqual({
      box: "shape-rectangle",
      irregular: "shape-wing",
      overhang: "shape-overhang",
      dk: "shape-dont-know",
    });
  });
});

describe("N10: one 'how many people live here' question", () => {
  it("replaces the day and night questions", () => {
    const ids = QUESTIONS.map((q) => q.id as string);
    expect(ids).toContain("people");
    expect(ids).not.toContain("peopleDay");
    expect(ids).not.toContain("peopleNight");
    expect(question("people").options).toEqual(["p1_2", "p3_5", "p6_10", "p11p", "dk"]);
    expect(question("people").optional).toBe(true);
  });

  it("reads a q-v1 survey: peopleNight becomes 'live here', peopleDay is dropped", () => {
    expect(sanitizeAnswers({ peopleNight: "p3_5", peopleDay: "p21p" })).toEqual({
      people: "p3_5",
    });
    expect(sanitizeAnswers({ peopleNight: "p11_20" })).toEqual({ people: "p11p" });
    expect(sanitizeAnswers({ peopleNight: "p21p" })).toEqual({ people: "p11p" });
    expect(sanitizeAnswers({ peopleNight: "dk" })).toEqual({ people: "dk" });
    expect(sanitizeAnswers({ peopleDay: "p3_5" })).toEqual({});
  });

  it("prefers a q-v2 answer over an old night answer", () => {
    expect(sanitizeAnswers({ people: "p6_10", peopleNight: "p1_2" })).toEqual({
      people: "p6_10",
    });
  });
});

describe("N12: remarks", () => {
  it("is the last question, optional free text of up to 1000 characters", () => {
    const last = QUESTIONS.at(-1);
    expect(last?.id).toBe("remarks");
    expect(last?.input).toBe("text");
    expect(last?.optional).toBe(true);
    expect(last?.maxLength).toBe(1000);
    expect(REMARKS_MAX).toBe(1000);
  });

  it("is stored in the survey answers, trimmed and capped", () => {
    const long = "x".repeat(1500);
    expect(sanitizeAnswers({ remarks: "  big crack by the door  " })).toEqual({
      remarks: "big crack by the door",
    });
    expect(sanitizeAnswers({ remarks: long }).remarks).toHaveLength(1000);
    expect(sanitizeAnswers({ remarks: "   " })).toEqual({});
    expect(surveyPayload({ remarks: "hello" }, "gps")).toEqual({
      remarks: "hello",
      location_quality: "gps",
    });
  });
});

describe("research questions", () => {
  it("all exist and every choice among them ends in 'I don't know' (except the home type)", () => {
    const ids = QUESTIONS.map((q) => q.id as string);
    for (const id of RESEARCH) {
      expect(ids).toContain(id);
    }
    for (const id of ["basement", "adjacency", "size", "people"]) {
      expect(question(id).options.at(-1)).toBe(DONT_KNOW);
    }
    expect(ids.indexOf("basement")).toBe(ids.indexOf("floors") + 1);
    expect(ids.indexOf("adjacency")).toBeGreaterThan(ids.indexOf("shape"));
  });

  it("have the agreed answer shapes", () => {
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
  });

  it("size, people and remarks are optional, the rest are not", () => {
    for (const id of RESEARCH) {
      expect(question(id).optional === true).toBe(
        ["size", "people", "remarks"].includes(id),
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
      use: "apartment",
      basement: "full",
      adjacency: "both_sides",
      size: "o400",
      people: "p3_5",
      structure: "frame",
    };
    expect(sanitizeAnswers(stored)).toEqual(stored);
    expect(pruneAnswers(stored)).toEqual(stored);
    expect(sanitizeAnswers({ use: "castle", size: "huge" })).toEqual({});
  });

  it("are stored in the survey payload next to the location quality", () => {
    const answers: Answers = {
      use: "house_single",
      size: "s100_200",
      people: DONT_KNOW,
    };
    expect(surveyPayload(answers, "pin")).toEqual({
      use: "house_single",
      occupancy: "residential",
      size: "s100_200",
      people: "dk",
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
    use: "mixed",
    basement: "full",
    adjacency: "both_sides",
    size: "o400",
    people: "p11p",
    remarks: "A shop below, lots of glass.",
  };

  it("gives the same type distribution, class, confidence and hazard", () => {
    const without = assessBuilding(base, 36.19, 44.01);
    const withResearch = assessBuilding({ ...base, ...research }, 36.19, 44.01);
    expect(withResearch).toEqual(without);
  });
});

describe("q-v1 compatibility: the assessment is unchanged for equivalent answers", () => {
  // The golden file holds 160 random q-v1 answer sets (every question, with
  // gaps and "I don't know") and the full assessment the q-v1 code produced
  // for each, at two places. Equivalent q-v2 answers must give the same output.
  interface Case {
    answers: Record<string, string>;
    lat: number;
    lon: number;
    result: unknown;
  }
  const cases = golden as unknown as Case[];

  it("gives identical output for every golden case", () => {
    expect(cases.length).toBeGreaterThan(100);
    for (const entry of cases) {
      expect(assessBuilding(entry.answers as Answers, entry.lat, entry.lon)).toEqual(
        entry.result,
      );
    }
  });

  it("gives identical output after the answers are read back through q-v2 (sanitize)", () => {
    for (const entry of cases) {
      const readBack = sanitizeAnswers(entry.answers);
      expect(assessBuilding(readBack, entry.lat, entry.lon)).toEqual(entry.result);
    }
  });
});

describe("q-v3: the assessment does not depend on the building type", () => {
  const cases = golden as unknown as {
    answers: Record<string, string>;
    lat: number;
    lon: number;
    result: unknown;
  }[];

  it("every residential answer set gives the identical golden output for every residential type", () => {
    for (const entry of cases) {
      for (const use of ["house_single", "house_multi", "apartment", "mixed"]) {
        const answers = { ...entry.answers, use } as Answers;
        expect(assessBuilding(answers, entry.lat, entry.lon)).toEqual(entry.result);
      }
    }
  });

  it("uses the same calculation for non-residential types (same class, range, confidence)", () => {
    for (const entry of cases) {
      for (const use of ["commercial", "industrial", "public", "other"]) {
        const answers = { ...entry.answers, use } as Answers;
        expect(assessBuilding(answers, entry.lat, entry.lon)).toEqual(entry.result);
      }
    }
  });
});
