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

/**
 * The minimal event-identity snapshot needed to resolve a felt report's
 * `eventId` (a client-side provider id, e.g. `event.provenance.providerId`)
 * to a canonical server `events.event_id` uuid via the
 * `upsert_event_from_client` RPC (migration 0011) — captured from the
 * already-cached `Event` at the moment a report is filed against a specific
 * event (Event Detail's pill), NOT fetched fresh, so building this snapshot
 * is a pure/local operation with no network call of its own (preserves the
 * one-tap panic-time promise). `null` on a `Tier1Report` means either an
 * unassociated (Home rapid) report, or — defensively — a resolution
 * snapshot that failed to build; either way the transport falls back to
 * `event_id: null` (D26: "that is CORRECT" for the unassigned pool), it
 * never blocks or drops the report.
 */
export interface EventRegistration {
  provider: string;
  providerId: string;
  /** Origin time, UTC ms — same unit as `Event.originTime`. */
  originTime: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  magnitude: number;
  magType: string | null;
  placeName: string;
}

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
   * (Home pill with no recent regional event; D18 §3.1/§3.2). This is the
   * client-side provider id (`event.id`/`event.provenance.providerId`),
   * used for LOCAL matching (`useOwnQueueItemForEvent`) — never sent
   * directly as `felt_reports.event_id` (see `eventRegistration` below,
   * migration 0011's fix for the bug where this string used to be inserted
   * as-is into a `uuid` column). */
  eventId: string | null;
  /** The snapshot `SupabaseTransport` resolves to a canonical server
   * `events.event_id` uuid at submit time (migration 0011
   * `upsert_event_from_client`) — see the type's own doc. Null exactly
   * when `eventId` is null (no event context at all, D26 rapid/unassigned
   * report) or when a registration snapshot couldn't be built. */
  eventRegistration: EventRegistration | null;
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

/** Q11 — structured 4-level road/ground damage answer (MyShake pattern, D8).
 * Q10 (building damage) used to share this same 4-level type; as of the
 * 2026-08-15 flow-restructure (owner directive) building damage is now
 * captured by window 2's two-typology 5-grade picker instead — see
 * `BuildingDamageGrade` below — so this type is Q11-only now. */
export type DamageLevel = 0 | 1 | 2 | 3;

/**
 * Window-2 building-damage grade (2026-08-15 flow restructure, owner
 * directive; renumbered DG0-DG4 -> DG1-DG5 in the 2026-08-17 update wave to
 * align with the official EMS-98 damage grades 1-5, "no more DG0") — 1 ("no
 * visible damage") through 5 (partial/full collapse), one severity ramp
 * shared by both typology rows (`DamageTypology` below picks which row's
 * grade text/artwork applies). Replaces the old Q10 4-level
 * `buildingDamageLevel` answer; see
 * `docs/research/felt-report-science-v1.md`'s 2026-08-15 addendum for the
 * proposed damage-index mapping this feeds (grade → CDI `damage` index),
 * flagged [REVIEW — Peshawa] there like the pack's other interpolated
 * values (R1, R6) — implemented pending that review, not blocking on it.
 */
export type BuildingDamageGrade = 1 | 2 | 3 | 4 | 5;

/** Which of window 2's two building rows a damage grade was picked from —
 * a vulnerability-class hint (science addendum: highrise ≈ RC frame,
 * lowrise ≈ masonry/RC mix), not itself a CDI/EMS index. `null` when the
 * user took the generic "I didn't see damage" shortcut instead of picking a
 * row (grade is still 0 in that case — see `EMPTY_TIER2_ANSWERS`'s note). */
export type DamageTypology = "highrise" | "lowrise";

/**
 * The full Q1-Q9 + Q11 answer set (Q10 removed, 2026-08-15 flow restructure
 * — see `BuildingDamageGrade` above), every field independently skippable
 * (spec-v1 §4.6: "every question skippable") — `null` means "not answered",
 * not "no". `comment` and `damageTypology`/`buildingDamageLevel` are all
 * collected earlier in the flow now (windows 2/3, not question-numbered)
 * but still live on this same answer set — they are stored via the exact
 * same tier-2/`felt_report_details` supersede mechanism (`queue.ts`), just
 * populated before "add more detail" is ever reached rather than only after.
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
  /** Window 2 pick (or the generic "no damage" shortcut, which sets this to
   * 0 with `damageTypology` left null — see that field's own doc). */
  buildingDamageLevel: BuildingDamageGrade | null;
  damageTypology: DamageTypology | null;
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
  damageTypology: null,
  roadDamageLevel: null,
  comment: null,
};

/**
 * Tier-2 record — mirrors `felt_report_details` (migration 0003, extended by
 * 0009 for `damage_typology` + the widened building-damage check).
 * One-to-one with a `Tier1Report`; submitting this SUPERSEDES the device's
 * tier-1 pick in place (D18 §3.2), it never creates a second felt_reports
 * row — the client-side queue models this as "attach tier2 to the existing
 * queue item", see `queue.ts`.
 */
export interface Tier2Report {
  /** Client-generated UUID; becomes `felt_report_details.detail_id`. Also
   * reused as `felt_comments.comment_id` when `answers.comment` is set (see
   * `supabase-transport.ts`'s `buildFeltCommentInsert`) — same
   * client-generated-PK idempotency trick as `Tier1Report.reportId`, so a
   * queue retry of the same Tier2Report can never double-insert a comment. */
  detailId: string;
  /** FK to the tier-1 record this supersedes; becomes `felt_report_id`. */
  feltReportId: string;
  /** The tier-1 report's own `deviceId` (copied in at enqueue time, see
   * `queue.ts`'s `enqueueTier2Report`) — needed because `felt_comments` has
   * its own `device_id` column (2026-08-16 comment-upload-gap fix) that
   * isn't derivable from `felt_report_id` alone without a DB round-trip. */
  deviceId: string;
  answers: Tier2Answers;
  /**
   * Window 3's optional photo attachment (2026-08-15 flow restructure) —
   * a LOCAL file path/URI from `expo-image-picker`, never a remote URL at
   * capture time. Not a `Tier2Answers` field on purpose: it is transport
   * metadata (destined for `felt_photos.storage_path` once a real upload
   * exists), not a survey answer that belongs in `raw_answers`. No upload
   * happens this wave — see `supabase-transport.ts`'s TODO — so this stays
   * queued locally, same "never lost, just not yet sent" contract as every
   * other field here.
   */
  photoUri: string | null;
  createdAt: number;
}
