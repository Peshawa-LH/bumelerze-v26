/**
 * Per-report index extraction — felt-report-science-v1.md PART 2 answer→
 * index-value tables, verbatim. Pure functions: one `Tier2Answers` object in,
 * one `IndexScores` object out (each of the 8 fields either a number or
 * `null` for "unanswered / excluded from this index's mean" — §3.2 step 1:
 * "Indices with no value are not counted. They DO NOT have zero value!").
 *
 * See `types.ts` for the portability constraint (no RN/Expo imports here).
 */

import type {
  BuildingDamageGrade,
  FeltAnswer,
  FurnitureAnswer,
  MotionAnswer,
  OthersFeltAnswer,
  PictureAnswer,
  ReactionAnswer,
  ShelfAnswer,
  StandAnswer,
  Tier2Answers,
} from "@/features/felt/types";

/** One report's contribution to each of the 8 CWS indices — `null` means
 * "this question wasn't answered (or was masked out), exclude from the
 * mean's denominator", never 0. */
export interface IndexScores {
  felt: number | null;
  motion: number | null;
  reaction: number | null;
  stand: number | null;
  shelf: number | null;
  picture: number | null;
  furniture: number | null;
  damage: number | null;
}

function assertNever(x: never): never {
  throw new Error(`felt-aggregation: unreachable answer value: ${String(x)}`);
}

// ---------------------------------------------------------------------------
// Q2 (felt) x Q3 (othersFelt) — DYFI v4 getFeltFromOther, quoted verbatim in
// the science pack (§2 Q3): "other_felt<2 → felt unchanged; ==2 → felt 0.36
// (0 if respondent felt nothing); ==3 → 0.72; >=4 → 1." Codes: dont_know=0,
// no_one=1, some=2, most=3, everyone=4 (D18 R2: implement the 0.36/0.72 code
// values, not the 0.33/0.66 background-page prose).
//
// Reading applied for the felt===null case (not explicit in the science
// pack): if the respondent didn't answer Q2 at all, there is no base value
// for Q3 to "modify" — the report contributes nothing to the `felt` index,
// regardless of what Q3 says. This matches the general null-exclusion rule
// (§3.2 step 1) rather than treating "unanswered Q2 + high Q3" as an
// implicit "yes".
// ---------------------------------------------------------------------------
function scoreFelt(
  felt: FeltAnswer | null,
  othersFelt: OthersFeltAnswer | null,
): number | null {
  if (felt === null) {
    return null;
  }
  const base = felt === "yes" ? 1 : 0;
  if (othersFelt === null) {
    return base;
  }
  switch (othersFelt) {
    case "dont_know": // code 0
    case "no_one": // code 1
      return base; // other_felt < 2 → unchanged
    case "some": // code 2
      return felt === "no" ? 0 : 0.36; // "(0 if respondent felt nothing)"
    case "most": // code 3
      return 0.72;
    case "everyone": // code 4
      return 1;
    default:
      return assertNever(othersFelt);
  }
}

// Q4 — motion, 0-5 (Wald 1999 questionnaire values, D18 R4: keep pending
// verification, code them as specified).
const MOTION_INDEX: Record<MotionAnswer, number> = {
  not_felt: 0,
  weak: 1,
  mild: 2,
  moderate: 3,
  strong: 4,
  violent: 5,
};

// Q5 — reaction, 0-5.
const REACTION_INDEX: Record<ReactionAnswer, number> = {
  no_reaction: 0,
  noticed: 1,
  excitement: 2,
  somewhat_frightened: 3,
  very_frightened: 4,
  extremely_frightened: 5,
};

// Q6 — stand, 0-1. "fell" is capped at the published 0-1 range per D18 R3
// ("fell→1"); IX+ diagnostic use is reserved for the (out-of-scope-here)
// EMS/IMS path.
const STAND_INDEX: Record<StandAnswer, number> = {
  no: 0,
  difficult: 1,
  fell: 1,
};

// Q7 — shelf, 0/0.5/0.75/1 (D18 R1: keep the drafted values, pending a
// DYFI-form verification pass before backend freeze — out of scope for
// this wave, implemented as specified).
const SHELF_INDEX: Record<ShelfAnswer, number> = {
  no: 0,
  rattled: 0.5,
  few_fell: 0.75,
  many_fell: 1,
};

// Q8/Q9 — picture, furniture: both plain 0/1 booleans.
const BOOLEAN_INDEX: Record<PictureAnswer | FurnitureAnswer, number> = {
  no: 0,
  yes: 1,
};

// Building damage, 0/0.5/0.75/2/3 — 2026-08-15 flow restructure (owner
// directive): window 2's two-typology 5-grade picker supersedes the old
// Q10 questionnaire answer (which was 0/0.75/2/3, D18 R6) as this index's
// source. PROPOSED mapping, [REVIEW — Peshawa] — see
// `docs/research/felt-report-science-v1.md`'s 2026-08-15 addendum:
// implemented pending that review, same "provisional but wired in" pattern
// this pack already uses for other interpolated values (R1's shelf steps,
// the old R6 itself).
const DAMAGE_INDEX: Record<BuildingDamageGrade, number> = {
  0: 0,
  1: 0.5,
  2: 0.75,
  3: 2,
  4: 3,
};

/**
 * Extracts the 8 CWS index contributions from one tier-2 report.
 *
 * Vehicle rule (§2 Q1, D18 R17): a "moving_car" situation answer drops
 * `motion` and `stand` (Q4/Q6) from this report's contribution — the report
 * is otherwise kept (felt/reaction/shelf/picture/furniture/damage still
 * count).
 */
export function scoreTier2Report(answers: Tier2Answers): IndexScores {
  const isMovingVehicle = answers.situation === "moving_car";

  return {
    felt: scoreFelt(answers.felt, answers.othersFelt),
    motion:
      isMovingVehicle || answers.motion === null ? null : MOTION_INDEX[answers.motion],
    reaction: answers.reaction === null ? null : REACTION_INDEX[answers.reaction],
    stand: isMovingVehicle || answers.stand === null ? null : STAND_INDEX[answers.stand],
    shelf: answers.shelf === null ? null : SHELF_INDEX[answers.shelf],
    picture: answers.picture === null ? null : BOOLEAN_INDEX[answers.picture],
    furniture: answers.furniture === null ? null : BOOLEAN_INDEX[answers.furniture],
    damage:
      answers.buildingDamageLevel === null
        ? null
        : DAMAGE_INDEX[answers.buildingDamageLevel],
  };
}

// ---------------------------------------------------------------------------
// §3.3 tier-1-only path: cartoon (1-12) → CDI-compatible decimal intensity,
// capped at 9.0 for levels 10-12 (identity mapping, D18 R9 — no EMSC-style
// iraw→icorr correction at launch).
// ---------------------------------------------------------------------------
export const CARTOON_TO_INTENSITY: Record<
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12,
  number
> = {
  1: 1.0,
  2: 2.0,
  3: 3.0,
  4: 4.0,
  5: 5.0,
  6: 6.0,
  7: 7.0,
  8: 8.0,
  9: 9.0,
  10: 9.0,
  11: 9.0,
  12: 9.0,
};
