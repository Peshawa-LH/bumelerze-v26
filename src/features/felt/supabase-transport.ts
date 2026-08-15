import { getSupabaseClient } from "@/lib/supabase";

import type { FeltTransport, TransportResult } from "./queue";
import type { Tier1Report, Tier2Report } from "./types";

/**
 * `SupabaseTransport` — the real `FeltTransport` (see `queue.ts`'s own
 * `FeltTransport` doc + TODO), wired in once a Supabase project exists
 * (Supabase-ready wiring wave). Column-for-column mapping against
 * `supabase/migrations/0003_felt_reports.sql`; kept in two small pure
 * `build*Insert` functions specifically so a test can assert the exact
 * payload shape without touching the network (see
 * `__tests__/supabase-transport.test.ts`, which also greps the migration
 * SQL itself so the two can never silently drift apart).
 */

/** Postgres unique-violation error code (felt_reports.report_id PK / the
 * felt_reports_device_event_uq partial index / felt_report_details'
 * felt_report_id unique constraint) — used below to make retries of an
 * already-succeeded insert idempotent instead of a user-visible failure. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export interface FeltReportInsert {
  report_id: string;
  device_id: string;
  event_id: string | null;
  cartoon_level: number;
  lat: number;
  lon: number;
  location_quality: string;
  created_at: string;
}

/**
 * Maps a `Tier1Report` to a `felt_reports` insert row.
 * Column mapping (migration 0003):
 *  - `report_id`      <- `reportId` (client UUID reused as the PK — see the
 *                        idempotency note in `submitTier1` below)
 *  - `device_id`       <- `deviceId`
 *  - `event_id`        <- `eventId` (nullable — pre-association, matches
 *                        the column's own nullability)
 *  - `cartoon_level`   <- `cartoonLevel`
 *  - `lat` / `lon`     <- `location.lat` / `location.lon`
 *  - `location_quality`<- `location.quality` ("gps" | "manual")
 *  - `created_at`      <- `createdAt` (device capture time; ISO string)
 * Deliberately NOT sent (left to the database):
 *  - `user_id`         — unused in v1 (D8: future accounts column only)
 *  - `geohash_p5`      — `GENERATED ALWAYS AS ... STORED`, server-computed
 *  - `submitted_at`    — `default now()`, the server's own receipt time is
 *                        more truthful than a client clock guess
 */
export function buildFeltReportInsert(report: Tier1Report): FeltReportInsert {
  return {
    report_id: report.reportId,
    device_id: report.deviceId,
    event_id: report.eventId,
    cartoon_level: report.cartoonLevel,
    lat: report.location.lat,
    lon: report.location.lon,
    location_quality: report.location.quality,
    created_at: new Date(report.createdAt).toISOString(),
  };
}

export interface FeltReportDetailInsert {
  detail_id: string;
  felt_report_id: string;
  situation: string | null;
  felt_answer: string | null;
  others_felt_answer: string | null;
  motion_answer: string | null;
  reaction_answer: string | null;
  stand_answer: string | null;
  shelf_answer: string | null;
  picture_answer: string | null;
  furniture_answer: string | null;
  building_damage_level: number | null;
  damage_typology: string | null;
  road_damage_level: number | null;
  raw_answers: Record<string, unknown>;
}

/**
 * Maps a `Tier2Report` to a `felt_report_details` insert row.
 * Column mapping (migration 0003, extended by 0009 for `damage_typology` +
 * the widened `building_damage_level` check) — one column per Q2-Q9/Q11
 * answer plus the window-2 damage grade/typology, matching the
 * CHECK-constraint enum strings 1:1 (`types.ts` defines the same union
 * literals the DB constrains to, so no translation step exists to drift):
 *  - `detail_id`            <- `detailId`
 *  - `felt_report_id`       <- `feltReportId` (FK to the tier-1 row's
 *                             `report_id`, which is `buildFeltReportInsert`'s
 *                             client-generated `reportId` above)
 *  - `situation`             <- `answers.situation`               (Q1)
 *  - `felt_answer`           <- `answers.felt`                    (Q2)
 *  - `others_felt_answer`    <- `answers.othersFelt`               (Q3)
 *  - `motion_answer`         <- `answers.motion`                  (Q4)
 *  - `reaction_answer`       <- `answers.reaction`                (Q5)
 *  - `stand_answer`          <- `answers.stand`                   (Q6)
 *  - `shelf_answer`          <- `answers.shelf`                   (Q7)
 *  - `picture_answer`        <- `answers.picture`                 (Q8)
 *  - `furniture_answer`      <- `answers.furniture`                (Q9)
 *  - `building_damage_level` <- `answers.buildingDamageLevel`      (window
 *                             2's 0-4 grade, 2026-08-15 flow restructure —
 *                             supersedes the old Q10 questionnaire answer;
 *                             the column itself is unchanged, only its
 *                             range widened 0-3 -> 0-4, migration 0009)
 *  - `damage_typology`       <- `answers.damageTypology` (NEW, migration
 *                             0009 — which of window 2's two rows the grade
 *                             came from; null for the generic "no damage"
 *                             shortcut)
 *  - `road_damage_level`     <- `answers.roadDamageLevel`          (Q11)
 *  - `raw_answers`           <- the full `answers` object (jsonb) — the
 *                             column's own comment says this is the
 *                             "authoritative source for IMS-25 re-scoring"
 *                             (migration 0003). This is also where the
 *                             free-text `comment` field lives: the
 *                             migration has no discrete `comment` column on
 *                             `felt_report_details` (only the separate,
 *                             moderated `felt_comments` stream table, which
 *                             this wave does not write to), so `comment`
 *                             would otherwise be silently dropped — flagging
 *                             this as a deliberate choice, not an oversight,
 *                             consistent with the migration's own stated
 *                             purpose for `raw_answers`.
 *
 * NOT mapped here: `report.photoUri` (window 3's optional photo). There is
 * no `felt_report_details` column for it — a photo belongs in the separate
 * `felt_photos` table (`storage_path`, moderation-gated, migration 0003),
 * which requires an actual Supabase Storage upload this transport does not
 * attempt this wave (2026-08-15 flow restructure scope: "do NOT attempt
 * storage upload"). TODO(Phase 2 storage wave): once a real upload path
 * exists, add a `submitPhoto` step here (or a second transport method) that
 * uploads `report.photoUri` to Storage and inserts the resulting
 * `storage_path` into `felt_photos` — until then a queued photo stays on
 * the device only, same "never lost, just not yet sent" contract as every
 * other queued field.
 */
export function buildFeltReportDetailInsert(report: Tier2Report): FeltReportDetailInsert {
  const { answers } = report;
  return {
    detail_id: report.detailId,
    felt_report_id: report.feltReportId,
    situation: answers.situation,
    felt_answer: answers.felt,
    others_felt_answer: answers.othersFelt,
    motion_answer: answers.motion,
    reaction_answer: answers.reaction,
    stand_answer: answers.stand,
    shelf_answer: answers.shelf,
    picture_answer: answers.picture,
    furniture_answer: answers.furniture,
    building_damage_level: answers.buildingDamageLevel,
    damage_typology: answers.damageTypology,
    road_damage_level: answers.roadDamageLevel,
    raw_answers: { ...answers },
  };
}

/** True for any Postgres/PostgREST error that isn't a known "this was
 * already inserted" case — the safe default for an offline-queue transport
 * is "retry" (queue.ts's own doc: "no report is ever lost"), never "give up
 * silently" on an error shape we don't specifically recognize. */
function isRetryableInsertError(errorCode: string | undefined): boolean {
  return errorCode !== POSTGRES_UNIQUE_VIOLATION;
}

export const SupabaseTransport: FeltTransport = {
  async submitTier1(report: Tier1Report): Promise<TransportResult> {
    const client = getSupabaseClient();
    if (!client) {
      // Defensive only — queue.ts selects this transport exclusively when
      // `isSupabaseConfigured()` is true, so this branch shouldn't run in
      // practice. Matches PendingTransport's own "nothing was attempted,
      // nothing was lost" semantics rather than a confusing hard failure.
      return { outcome: "awaiting-backend" };
    }

    const { error } = await client
      .from("felt_reports")
      .insert(buildFeltReportInsert(report));

    if (!error) {
      return { outcome: "submitted", serverReportId: report.reportId };
    }
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      // report_id is the client-generated UUID reused as the row's PK
      // specifically so this case is detectable: a retry after a dropped
      // response (the insert actually succeeded server-side, the client
      // just never saw the confirmation) hits this same PK again — that's
      // success, not a failure, and must never surface as one.
      return { outcome: "submitted", serverReportId: report.reportId };
    }
    return { outcome: "failed", retryable: isRetryableInsertError(error.code) };
  },

  async submitTier2(report: Tier2Report): Promise<TransportResult> {
    const client = getSupabaseClient();
    if (!client) {
      return { outcome: "awaiting-backend" };
    }

    const { error } = await client
      .from("felt_report_details")
      .insert(buildFeltReportDetailInsert(report));

    if (!error) {
      return { outcome: "submitted", serverReportId: report.detailId };
    }
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return { outcome: "submitted", serverReportId: report.detailId };
    }
    return { outcome: "failed", retryable: isRetryableInsertError(error.code) };
  },
};
