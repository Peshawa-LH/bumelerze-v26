/**
 * Felt-report client types (spec-v1.md §4.6/§5.2; D8/D18).
 * Mirrors `supabase/migrations/0003_felt_reports.sql` field-for-field —
 * every column in `felt_reports`/`felt_report_details` has a matching field
 * here, and every tier-2 answer is stored as the RAW enumerated string the
 * science pack defines (`felt-report-science-v1.md` PART 2), never a
 * precomputed CDI/EMS index — the schema's own comment says why: "so the
 * CWS/CDI math can be re-run/corrected later without re-asking users".
 */

/** 1-of-12 EMS-98 cartoon pick (felt-report-science-v1.md PART 1). */
export type CartoonLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const CARTOON_LEVELS: readonly CartoonLevel[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
];

/** Science pack §1.2: levels 1-9 render full-size, 10-12 are grouped under a
 * "severe destruction" sub-header — but every level stays selectable, none
 * disabled ("an aid worker or a user at the damage edge must be able to
 * report IX-XII"). */
export const SEVERE_DESTRUCTION_THRESHOLD: CartoonLevel = 10;

/** Mirrors `felt_reports.location_quality` (D18 §3.1). */
export type LocationQuality = "gps" | "manual";

export interface FeltLocation {
  lat: number;
  lon: number;
  quality: LocationQuality;
  /**
   * Local-only bookkeeping — NOT a migration column. When `quality` is
   * "manual" via the inline town picker (spec-v1.md §4.6 "never block the
   * one-tap promise on a permission grant"), this records which gazetteer
   * town produced the lat/lon so the UI can show/re-open the right
   * selection; the server only ever sees lat/lon + quality.
   */
  townId?: string;
}

/**
 * Tier-1 record — mirrors `felt_reports` (migration 0003).
 * Three timestamps per the wave brief: `feltAt` (when the shaking/tap
 * happened, from the user's point of view), `createdAt` (when this record
 * was captured on-device — maps 1:1 to the migration's `created_at`, "may
 * be backdated by the offline queue"), and `submittedAt` (when it reached
 * the server, maps to `submitted_at`; null while still queued). Tier 1 is a
 * single one-tap action today so `feltAt` and `createdAt` are always equal
 * at creation — the fields are kept distinct for forward-compatibility
 * (e.g. a future "report a quake I felt earlier" flow) rather than
 * collapsed into one.
 */
export interface Tier1Report {
  /** Client-generated UUID; becomes `felt_reports.report_id` once synced. */
  reportId: string;
  deviceId: string;
  /** Null until associated to an event — either explicitly (Event Detail
   * entry point) or left null for the server-side association job
   * (Home pill with no recent regional event; D18 §3.1/§3.2). */
  eventId: string | null;
  cartoonLevel: CartoonLevel;
  location: FeltLocation;
  feltAt: number;
  createdAt: number;
  submittedAt: number | null;
}

// ---------------------------------------------------------------------------
// Tier 2 — felt-report-science-v1.md PART 2, Q1-Q11. Every union below is
// the exact answer-option set from the science pack; the CHECK constraint
// values in 0003_felt_reports.sql are these same strings.
// ---------------------------------------------------------------------------

/** Q1 — situation (context only, CDI weight 0). */
export type SituationAnswer =
  "inside" | "outside" | "stopped_car" | "moving_car" | "asleep";

/** Q2 — felt (CDI index `felt`). */
export type FeltAnswer = "no" | "yes";

/** Q3 — others felt it (modifies `felt` per DYFI `getFeltFromOther`, D18 R2). */
export type OthersFeltAnswer = "dont_know" | "no_one" | "some" | "most" | "everyone";

/** Q4 — motion (CDI index `motion`). */
export type MotionAnswer =
  "not_felt" | "weak" | "mild" | "moderate" | "strong" | "violent";

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

/** Q7 — shelf objects (CDI index `shelf`, weight 5 — highest-priority
 * unverified value per D18 R1, DYFI-form check still pending). */
export type ShelfAnswer = "no" | "rattled" | "few_fell" | "many_fell";

/** Q8 — pictures (CDI index `picture`). */
export type PictureAnswer = "no" | "yes";

/** Q9 — furniture (CDI index `furniture`). */
export type FurnitureAnswer = "no" | "yes";

/** Q10/Q11 — structured 4-level damage answers (MyShake pattern, D8). */
export type DamageLevel = 0 | 1 | 2 | 3;

/**
 * The full Q1-Q11 answer set, every field independently skippable (spec-v1
 * §4.6: "every question skippable") — `null` means "not answered", not "no".
 * `comment` is the optional free-text field at the end of tier 2 (not
 * question-numbered).
 */
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
  buildingDamageLevel: DamageLevel | null;
  roadDamageLevel: DamageLevel | null;
  comment: string | null;
}

export const EMPTY_TIER2_ANSWERS: Tier2Answers = {
  situation: null,
  felt: null,
  othersFelt: null,
  motion: null,
  reaction: null,
  stand: null,
  shelf: null,
  picture: null,
  furniture: null,
  buildingDamageLevel: null,
  roadDamageLevel: null,
  comment: null,
};

/**
 * Tier-2 record — mirrors `felt_report_details` (migration 0003).
 * One-to-one with a `Tier1Report`; submitting this SUPERSEDES the device's
 * tier-1 pick in place (D18 §3.2), it never creates a second felt_reports
 * row — the client-side queue models this as "attach tier2 to the existing
 * queue item", see `queue.ts`.
 */
export interface Tier2Report {
  /** Client-generated UUID; becomes `felt_report_details.detail_id`. */
  detailId: string;
  /** FK to the tier-1 record this supersedes; becomes `felt_report_id`. */
  feltReportId: string;
  answers: Tier2Answers;
  createdAt: number;
}
