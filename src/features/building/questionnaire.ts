import type { PictogramName } from "./pictograms.generated";

/**
 * "Tag my building" questionnaire q-v3. Layperson wording lives in the
 * locale catalogs (`building.q.<id>.title` / `building.q.<id>.options.<option>`);
 * this module owns ids, options and branching only.
 *
 * Every structural question ends with "dk" ("I don't know"). A question the
 * user has not reached is simply absent from the answers; the assessment
 * treats absent and "dk" the same.
 *
 * Versions:
 *  - q-v1 added five research-only questions (use, basement, adjacency, size,
 *    people day/night). They are not `structural` and the assessment does not
 *    read them: they are stored with the survey for the research database.
 *  - q-v2 merged "what are you tagging" and "use" into one first question
 *    (`use`), shows structure and shape as picture choices, adds the
 *    corner-column follow-up for "I don't know" structures, replaces people
 *    day/night by one `people` question and ends with an optional free-text
 *    `remarks`. Its first question offered five home types only.
 *  - q-v3 (this file) makes the first question "What kind of building is it?":
 *    eight options that say both what the building is used for and what type
 *    of building it is (house, apartment in a complex, shop, warehouse, ...).
 *    The answer is stored as `use`; `kind` for the server and `occupancy` for
 *    research are derived from it. Older answers still load:
 *    `sanitizeAnswers` maps `peopleNight` to `people` (q-v1) and the q-v1/q-v2
 *    `use` ids to the q-v3 ids (see `LEGACY_USE`).
 */

export const QUESTIONNAIRE_VERSION = "q-v3";
export const DONT_KNOW = "dk";
/** Characters allowed in the free-text remarks. */
export const REMARKS_MAX = 1000;

export type QuestionId =
  | "use"
  | "floors"
  | "basement"
  | "age"
  | "builder"
  | "structure"
  | "cornerColumns"
  | "stone"
  | "belts"
  | "roof"
  | "added"
  | "openGround"
  | "shape"
  | "adjacency"
  | "strengthened"
  | "cracks"
  | "pastDamage"
  | "size"
  | "people"
  | "remarks";

export type Answers = Partial<Record<QuestionId, string>>;

export interface Question {
  id: QuestionId;
  options: readonly string[];
  /** "text" questions take free text (up to `maxLength`) instead of an option. */
  input?: "text";
  maxLength?: number;
  /** Counts toward the confidence score (what the building IS made of). */
  structural: boolean;
  /** The screen can be passed without choosing (not even "I don't know"). */
  optional?: boolean;
  /** Asked on the first screen together with the building's name, not on its own. */
  firstScreen?: boolean;
  /** Only asked when this returns true for the answers so far. */
  appliesTo?: (answers: Answers) => boolean;
  /** A drawing for each option (the options are then shown as pictures). */
  pictograms?: Readonly<Record<string, PictogramName>>;
  /** A drawing under the title, with the text `building.q.<id>.helper`. */
  helperPictogram?: PictogramName;
}

const WALLS = ["block", "brick"] as const;

/** People who live in this home (one family's home). */
const PEOPLE_OPTIONS = ["p1_2", "p3_5", "p6_10", "p11p", DONT_KNOW] as const;

/** q-v1 asked the same question twice with 5 bands; the night one means "live
 * here". The two top bands collapse into "more than 10". */
const LEGACY_PEOPLE: Readonly<Record<string, string>> = {
  p1_2: "p1_2",
  p3_5: "p3_5",
  p6_10: "p6_10",
  p11_20: "p11p",
  p21p: "p11p",
  [DONT_KNOW]: DONT_KNOW,
};

/** What kind of building (its function and its type): the answer is stored as
 * `use` and also decides the tag's `kind` and the research `occupancy`. */
export const BUILDING_USES = [
  "house_single",
  "house_multi",
  "apartment",
  "mixed",
  "commercial",
  "industrial",
  "public",
  "other",
] as const;
export type BuildingUse = (typeof BUILDING_USES)[number];

/** What the building is used for, for research. */
export type Occupancy = "residential" | "commercial" | "industrial" | "public" | "other";

/** q-v1 and q-v2 `use` ids and the q-v3 id each one means. The q-v1 ids were
 * house / apartments / shop_below / other; q-v2 added shared_house. */
export const LEGACY_USE: Readonly<Record<string, BuildingUse>> = {
  house: "house_single",
  shared_house: "house_multi",
  apartments: "apartment",
  shop_below: "mixed",
  other: "other",
};

function isBuildingUse(value: string | undefined): value is BuildingUse {
  return (BUILDING_USES as readonly string[]).includes(value ?? "");
}

/**
 * The server's `kind` for a building type. Units in a shared building (a house
 * for several families, an apartment, homes above shops) are "apartment" tags,
 * which the server links into one building complex when they are within about
 * 30 m. Everything else is a standalone "house" tag.
 */
export function buildingKindFromUse(
  use: string | undefined,
): "house" | "apartment" | null {
  if (!isBuildingUse(use)) {
    return null;
  }
  switch (use) {
    case "house_multi":
    case "apartment":
    case "mixed":
      return "apartment";
    default:
      return "house";
  }
}

/** The occupancy class of a building type (null before it is chosen). The
 * first four types are lived in; the others name their own class. */
export function occupancyFromUse(use: string | undefined): Occupancy | null {
  if (!isBuildingUse(use)) {
    return null;
  }
  switch (use) {
    case "commercial":
    case "industrial":
    case "public":
    case "other":
      return use;
    default:
      return "residential";
  }
}

/** Whether the building is a home. Unknown or missing counts as a home (the
 * assessment's calibration), so only a chosen non-residential type is false. */
export function isResidentialUse(use: string | undefined): boolean {
  const occupancy = occupancyFromUse(use);
  return occupancy === null || occupancy === "residential";
}

/** Locale key of a question's title; the people question asks about "inside"
 * instead of "live in this home" for a non-residential building. */
export function questionTitleKey(id: QuestionId, answers: Answers): string {
  if (id === "people" && !isResidentialUse(answers.use)) {
    return "building.q.people.titleBuilding";
  }
  return `building.q.${id}.title`;
}

/**
 * The structure the assessment should use. "I don't know" plus a visible
 * concrete column at the corners means a frame; no visible columns means
 * walls (unconfined concrete block, the commonest wall here). Any other
 * structure answer is used as given.
 */
export function effectiveStructure(answers: Answers): string | undefined {
  if (answers.structure === DONT_KNOW) {
    if (answers.cornerColumns === "yes") return "frame";
    if (answers.cornerColumns === "no") return "block";
  }
  return answers.structure;
}

/** The answers as the assessment reads them: the structure routed through
 * `effectiveStructure`, and "no columns at the corners" standing in for "no
 * belts" because the belts question is not asked on that path. Identical to
 * the input for every answer set without the corner-column follow-up. */
export function routeAnswers(answers: Answers): Answers {
  const structure = effectiveStructure(answers);
  if (structure === answers.structure) {
    return answers;
  }
  const routed: Answers = { ...answers };
  if (structure !== undefined) {
    routed.structure = structure;
  }
  if (structure === "block" && routed.belts === undefined) {
    routed.belts = "no";
  }
  return routed;
}

export function isWallStructure(answers: Answers): boolean {
  const structure = effectiveStructure(answers);
  return structure === "block" || structure === "brick";
}

export const QUESTIONS: readonly Question[] = [
  {
    id: "use",
    options: BUILDING_USES,
    structural: false,
    firstScreen: true,
  },
  {
    id: "floors",
    options: ["f1", "f2", "f3", "f4_5", "f6_10", "f11p", DONT_KNOW],
    structural: true,
  },
  {
    id: "basement",
    options: ["none", "part", "full", DONT_KNOW],
    structural: false,
  },
  {
    id: "age",
    options: ["under10", "a10_25", "a25_50", "over50", DONT_KNOW],
    structural: true,
  },
  {
    id: "builder",
    options: ["eng_full", "eng_plans", "builder", "self", DONT_KNOW],
    structural: true,
  },
  {
    id: "structure",
    options: ["frame", ...WALLS, "stone", "mud", "steel", "wood", DONT_KNOW],
    structural: true,
    helperPictogram: "structure-corner-column",
    pictograms: {
      frame: "structure-frame",
      block: "structure-block-walls",
      brick: "structure-brick-walls",
      stone: "structure-stone-walls",
      mud: "structure-mud-walls",
      steel: "structure-steel-frame",
      wood: "structure-wood",
      [DONT_KNOW]: "structure-dont-know",
    },
  },
  {
    id: "cornerColumns",
    options: ["yes", "no", DONT_KNOW],
    // Not counted: the assessment's confidence must not change for an answer
    // set that never saw this follow-up.
    structural: false,
    helperPictogram: "structure-corner-column",
    appliesTo: (answers) => answers.structure === DONT_KNOW,
  },
  {
    id: "stone",
    options: ["dressed", "rough", DONT_KNOW],
    structural: true,
    appliesTo: (answers) => answers.structure === "stone",
  },
  {
    id: "belts",
    options: ["yes", "no", DONT_KNOW],
    structural: true,
    appliesTo: (answers) =>
      answers.structure === "block" || answers.structure === "brick",
  },
  {
    id: "roof",
    options: ["slab", "jack_arch", "wood", "metal", DONT_KNOW],
    structural: true,
    appliesTo: isWallStructure,
  },
  { id: "added", options: ["yes", "no", DONT_KNOW], structural: false },
  { id: "openGround", options: ["yes", "no", DONT_KNOW], structural: false },
  {
    id: "shape",
    options: ["box", "irregular", "overhang", DONT_KNOW],
    structural: false,
    pictograms: {
      box: "shape-rectangle",
      irregular: "shape-wing",
      overhang: "shape-overhang",
      [DONT_KNOW]: "shape-dont-know",
    },
  },
  {
    id: "adjacency",
    options: ["alone", "one_side", "both_sides", DONT_KNOW],
    structural: false,
  },
  {
    id: "strengthened",
    options: ["no", "repairs", "strengthening", DONT_KNOW],
    structural: false,
  },
  { id: "cracks", options: ["none", "hairline", "large", DONT_KNOW], structural: false },
  {
    id: "pastDamage",
    options: ["none", "cracks", "heavy", DONT_KNOW],
    structural: false,
  },
  {
    id: "size",
    options: ["u100", "s100_200", "s200_400", "o400", DONT_KNOW],
    structural: false,
    optional: true,
  },
  {
    id: "people",
    options: PEOPLE_OPTIONS,
    structural: false,
    optional: true,
  },
  {
    id: "remarks",
    options: [],
    input: "text",
    maxLength: REMARKS_MAX,
    structural: false,
    optional: true,
  },
];

/** Questions of the one-per-screen part of the flow (everything except the
 * first-screen building type) for the answers so far, in order. */
export function visibleQuestions(answers: Answers): Question[] {
  return QUESTIONS.filter(
    (question) => !question.appliesTo || question.appliesTo(answers),
  );
}

export function isAnswered(answers: Answers, id: QuestionId): boolean {
  const value = answers[id];
  return value !== undefined && value !== DONT_KNOW;
}

/** Drops answers to questions that no longer apply (the user went back and
 * changed the structure), so stale branch answers never reach the method. */
export function pruneAnswers(answers: Answers): Answers {
  const visible = new Set(visibleQuestions(answers).map((question) => question.id));
  const pruned: Answers = {};
  for (const question of QUESTIONS) {
    const value = answers[question.id];
    if (value !== undefined && visible.has(question.id)) {
      pruned[question.id] = value;
    }
  }
  return pruned;
}

/** Accepts only known question ids and option ids (a stored survey may come
 * from a newer or older app version). Reads q-v1 and q-v2 answers: an old
 * `use` id becomes its q-v3 id, `peopleNight` becomes `people`, `peopleDay` and
 * the q-v1 "use: I don't know" are dropped. */
export function sanitizeAnswers(raw: unknown): Answers {
  const answers: Answers = {};
  if (typeof raw !== "object" || raw === null) {
    return answers;
  }
  const record = raw as Record<string, unknown>;
  for (const question of QUESTIONS) {
    const value = record[question.id];
    if (typeof value !== "string") {
      continue;
    }
    if (question.input === "text") {
      const text = value.trim().slice(0, question.maxLength ?? REMARKS_MAX);
      if (text) {
        answers[question.id] = text;
      }
    } else if (question.options.includes(value)) {
      answers[question.id] = value;
    } else if (question.id === "use" && LEGACY_USE[value]) {
      answers.use = LEGACY_USE[value];
    }
  }
  const legacyNight = record.peopleNight;
  if (answers.people === undefined && typeof legacyNight === "string") {
    const mapped = LEGACY_PEOPLE[legacyNight];
    if (mapped) {
      answers.people = mapped;
    }
  }
  return pruneAnswers(answers);
}
