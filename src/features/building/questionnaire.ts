import type { PictogramName } from "./pictograms.generated";

/**
 * "Tag my building" questionnaire q-v2. Layperson wording lives in the
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
 *  - q-v2 (this file) merges "what are you tagging" and "use" into one first
 *    question (`use`, five home types, no "I don't know"), shows structure and
 *    shape as picture choices, adds the corner-column follow-up for "I don't
 *    know" structures, replaces people day/night by one `people` question and
 *    ends with an optional free-text `remarks`. q-v1 answers still load:
 *    `sanitizeAnswers` maps `peopleNight` to `people` and every other q-v1
 *    answer id and option id is unchanged.
 */

export const QUESTIONNAIRE_VERSION = "q-v2";
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
  /** Asked on the first screen together with the home's name, not on its own. */
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

/** What kind of home: the answer also decides the tag's `kind`. */
export type HomeUse = "house" | "shared_house" | "apartments" | "shop_below" | "other";

/**
 * The server's `kind` for a home type. Single-family and "something else" are
 * a house; the three shared-building types are "apartment" tags, which the
 * server links into one building complex when they are within about 30 m.
 */
export function homeKindFromUse(use: string | undefined): "house" | "apartment" | null {
  switch (use) {
    case "house":
    case "other":
      return "house";
    case "shared_house":
    case "apartments":
    case "shop_below":
      return "apartment";
    default:
      return null;
  }
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
    options: ["house", "shared_house", "apartments", "shop_below", "other"],
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
 * first-screen home type) for the answers so far, in order. */
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
 * from a newer or older app version) and reads q-v1 answers: `peopleNight`
 * becomes `people`, `peopleDay` and the q-v1 "use: I don't know" are dropped. */
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
