// VENDORED — hand-synced copy of the answer-enum unions from
// `src/features/felt/types.ts` (the RN app's own felt-report client types).
//
// WHY THIS FILE EXISTS: `src/lib/felt-aggregation/types.ts` and
// `cdi-scoring.ts` import these unions via `import type { ... } from
// "@/features/felt/types"` — a Metro/TS path alias into the Expo app's
// source tree. Deno (this Edge Function's runtime) has no equivalent alias
// and cannot resolve into the RN app's module graph, so the source lib
// cannot be imported unchanged. Per the wave brief's "prefer verbatim
// vendoring with a sync note," this whole `felt-aggregation/` folder is a
// verbatim copy of `src/lib/felt-aggregation/` with exactly one mechanical
// change: the `@/features/felt/types` import is replaced by this file
// (plus Deno-required `.ts` extensions on relative imports). No aggregation
// LOGIC differs between the two copies.
//
// KEEPING THIS IN SYNC: these are `type`-only declarations (string-literal
// unions), not runtime logic — they cannot silently drift the CDI MATH the
// way a copy-pasted function could, but a schema change (e.g. a new
// `MotionAnswer` value) that updates `src/features/felt/types.ts` without
// updating this file would make the DB accept a value this vendored copy's
// scoring tables (`cdi-scoring.ts`) don't recognize, throwing at runtime
// (`assertNever`) instead of silently mis-scoring — a loud failure, not a
// silent one, but still worth catching in review. Grep the repo for
// "VENDORED — hand-synced copy" to find this file if
// `src/features/felt/types.ts` changes its Q1-Q11/damage answer unions.

/** Mirrors `felt_reports.cartoon_level` (1-of-12 EMS-98 cartoon pick). */
export type CartoonLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Q1 — situation (context only, CDI weight 0). */
export type SituationAnswer = "inside" | "outside" | "stopped_car" | "moving_car" | "asleep";

/** Q2 — felt (CDI index `felt`). */
export type FeltAnswer = "no" | "yes";

/** Q3 — others felt it (modifies `felt` per DYFI `getFeltFromOther`, D18 R2). */
export type OthersFeltAnswer = "dont_know" | "no_one" | "some" | "most" | "everyone";

/** Q4 — motion (CDI index `motion`). */
export type MotionAnswer = "not_felt" | "weak" | "mild" | "moderate" | "strong" | "violent";

/** Q5 — reaction (CDI index `reaction`). */
export type ReactionAnswer =
  | "no_reaction"
  | "noticed"
  | "excitement"
  | "somewhat_frightened"
  | "very_frightened"
  | "extremely_frightened";

/** Q6 — standing (CDI index `stand`; "fell" capped at index 1, D18 R3). */
export type StandAnswer = "no" | "difficult" | "fell";

/** Q7 — shelf objects (CDI index `shelf`, weight 5, D18 R1). */
export type ShelfAnswer = "no" | "rattled" | "few_fell" | "many_fell";

/** Q8 — pictures (CDI index `picture`). */
export type PictureAnswer = "no" | "yes";

/** Q9 — furniture (CDI index `furniture`). */
export type FurnitureAnswer = "no" | "yes";

/** Q11 — structured 4-level road/ground damage answer (MyShake pattern). */
export type DamageLevel = 0 | 1 | 2 | 3;

/** Window-2 building-damage grade (2026-08-15 flow restructure) — 0 ("no
 * visible damage") through 4 (partial/full collapse). Replaces the old Q10
 * 4-level `buildingDamageLevel` answer as of migration 0009. */
export type BuildingDamageGrade = 0 | 1 | 2 | 3 | 4;

/** Which of window 2's two building rows a damage grade was picked from. */
export type DamageTypology = "highrise" | "lowrise";

/** The full Q1-Q9 + Q11 answer set (Q10 removed) plus the window-2/3 fields
 * (`comment`, `damageTypology`, `buildingDamageLevel`) — mirrors
 * `felt_report_details` columns. */
export interface Tier2Answers {
  situation: SituationAnswer | null;
  felt: FeltAnswer | null;
  othersFelt: OthersFeltAnswer | null;
  motion: MotionAnswer | null;
  reaction: ReactionAnswer | null;
  stand: StandAnswer | null;
  shelf: ShelfAnswer | null;
  picture: PictureAnswer | null;
  furniture: FurnitureAnswer | null;
  buildingDamageLevel: BuildingDamageGrade | null;
  damageTypology: DamageTypology | null;
  roadDamageLevel: DamageLevel | null;
  comment: string | null;
}
