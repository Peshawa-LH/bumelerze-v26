/**
 * "Tag my building" questionnaire v0. Layperson wording lives in the
 * locale catalogs (`building.q.<id>.title` / `building.q.<id>.options.<option>`);
 * this module owns ids, options and branching only.
 *
 * Every question ends with "dk" ("I don't know"). A question the user has not
 * reached is simply absent from the answers; the assessment treats absent and
 * "dk" the same.
 */

export const QUESTIONNAIRE_VERSION = "q-v0";
export const DONT_KNOW = "dk";

export type QuestionId =
  | "floors"
  | "age"
  | "builder"
  | "structure"
  | "stone"
  | "belts"
  | "roof"
  | "added"
  | "openGround"
  | "shape"
  | "strengthened"
  | "cracks"
  | "pastDamage";

export type Answers = Partial<Record<QuestionId, string>>;

export interface Question {
  id: QuestionId;
  options: readonly string[];
  /** Counts toward the confidence score (what the building IS made of). */
  structural: boolean;
  /** Only asked when this returns true for the answers so far. */
  appliesTo?: (answers: Answers) => boolean;
}

const WALLS = ["block", "brick"] as const;

export function isWallStructure(answers: Answers): boolean {
  return answers.structure === "block" || answers.structure === "brick";
}

export const QUESTIONS: readonly Question[] = [
  {
    id: "floors",
    options: ["f1", "f2", "f3", "f4_5", "f6_10", "f11p", DONT_KNOW],
    structural: true,
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
    appliesTo: isWallStructure,
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
];

/** The questions to ask given the answers so far, in order. */
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
 * from a newer or older app version). */
export function sanitizeAnswers(raw: unknown): Answers {
  const answers: Answers = {};
  if (typeof raw !== "object" || raw === null) {
    return answers;
  }
  const record = raw as Record<string, unknown>;
  for (const question of QUESTIONS) {
    const value = record[question.id];
    if (typeof value === "string" && question.options.includes(value)) {
      answers[question.id] = value;
    }
  }
  return pruneAnswers(answers);
}
