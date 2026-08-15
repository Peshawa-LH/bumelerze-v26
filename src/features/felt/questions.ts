import type {
  DamageLevel,
  FeltAnswer,
  FurnitureAnswer,
  MotionAnswer,
  OthersFeltAnswer,
  PictureAnswer,
  ReactionAnswer,
  ShelfAnswer,
  SituationAnswer,
  StandAnswer,
  Tier2Answers,
} from "./types";

/**
 * Tier-2 question set — wording, order, and answer options are taken
 * VERBATIM from `felt-report-science-v1.md` PART 2 (Q1-Q11, confirmed D18),
 * MINUS Q10 (building damage): the 2026-08-15 flow-restructure (owner
 * directive) moved building damage to window 2's own typology/grade picker,
 * which supersedes Q10 as this answer set's damage-index source (science
 * addendum, same file). Q10's `questionNumber` is intentionally retired
 * (not renumbered onto Q11) — Q11 keeps `questionNumber: 11` so its
 * identity as "Q11" stays stable against the science pack even though it is
 * now the 10th (and last) step in the UI sequence. This is a science
 * artifact, not a UI convenience list: do not reorder, reword, or
 * add/remove options here without re-checking the science pack and the
 * `felt_report_details` CHECK constraints in
 * `supabase/migrations/0003_felt_reports.sql`/`0009_felt_damage_typology.sql`
 * they must stay in lockstep with.
 *
 * `i18nKey` values are the leaf under `felt.tier2.questions.<field>` in the
 * locale catalogs (title + one key per option).
 */

type StringField = Exclude<
  keyof Tier2Answers,
  "buildingDamageLevel" | "damageTypology" | "roadDamageLevel" | "comment"
>;

interface ChoiceQuestionDef<TAnswer extends string> {
  kind: "choice";
  field: StringField;
  questionNumber: number;
  i18nKey: string;
  options: readonly TAnswer[];
}

interface DamageQuestionDef {
  kind: "damage";
  field: "roadDamageLevel";
  questionNumber: number;
  i18nKey: string;
  options: readonly DamageLevel[];
}

export type Tier2QuestionDef = ChoiceQuestionDef<string> | DamageQuestionDef;

/** Q1-Q9 + Q11, in science-pack order (Q10 removed — see the module doc
 * comment above). Comment (free text) and building damage are both handled
 * earlier in the flow now (windows 2/3), not listed here. */
export const TIER2_QUESTIONS: readonly Tier2QuestionDef[] = [
  {
    kind: "choice",
    field: "situation",
    questionNumber: 1,
    i18nKey: "situation",
    options: [
      "inside",
      "outside",
      "stopped_car",
      "moving_car",
      "asleep",
    ] satisfies readonly SituationAnswer[],
  },
  {
    kind: "choice",
    field: "felt",
    questionNumber: 2,
    i18nKey: "felt",
    options: ["no", "yes"] satisfies readonly FeltAnswer[],
  },
  {
    kind: "choice",
    field: "othersFelt",
    questionNumber: 3,
    i18nKey: "othersFelt",
    options: [
      "dont_know",
      "no_one",
      "some",
      "most",
      "everyone",
    ] satisfies readonly OthersFeltAnswer[],
  },
  {
    kind: "choice",
    field: "motion",
    questionNumber: 4,
    i18nKey: "motion",
    options: [
      "not_felt",
      "weak",
      "mild",
      "moderate",
      "strong",
      "violent",
    ] satisfies readonly MotionAnswer[],
  },
  {
    kind: "choice",
    field: "reaction",
    questionNumber: 5,
    i18nKey: "reaction",
    options: [
      "no_reaction",
      "noticed",
      "excitement",
      "somewhat_frightened",
      "very_frightened",
      "extremely_frightened",
    ] satisfies readonly ReactionAnswer[],
  },
  {
    kind: "choice",
    field: "stand",
    questionNumber: 6,
    i18nKey: "stand",
    options: ["no", "difficult", "fell"] satisfies readonly StandAnswer[],
  },
  {
    kind: "choice",
    field: "shelf",
    questionNumber: 7,
    i18nKey: "shelf",
    options: ["no", "rattled", "few_fell", "many_fell"] satisfies readonly ShelfAnswer[],
  },
  {
    kind: "choice",
    field: "picture",
    questionNumber: 8,
    i18nKey: "picture",
    options: ["no", "yes"] satisfies readonly PictureAnswer[],
  },
  {
    kind: "choice",
    field: "furniture",
    questionNumber: 9,
    i18nKey: "furniture",
    options: ["no", "yes"] satisfies readonly FurnitureAnswer[],
  },
  {
    kind: "damage",
    field: "roadDamageLevel",
    questionNumber: 11,
    i18nKey: "roadDamageLevel",
    options: [0, 1, 2, 3],
  },
];

export const TIER2_QUESTION_COUNT = TIER2_QUESTIONS.length;
