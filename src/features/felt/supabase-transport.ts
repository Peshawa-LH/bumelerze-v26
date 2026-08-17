import type { SupabaseClient } from "@supabase/supabase-js";
import { File } from "expo-file-system";
import { Platform } from "react-native";

import { getSupabaseClient, signInAnonymously } from "@/lib/supabase";

import type { FeltTransport, PhotoUploadResult, TransportResult } from "./queue";
import type { EventRegistration, Tier1Report, Tier2Report } from "./types";

/** Private Storage bucket created by migration 0016 — see that file for the
 * bucket config (5 MB limit, jpeg/png/webp) and the storage.objects RLS
 * policies this upload path depends on. */
const FELT_PHOTOS_BUCKET = "felt-photos";

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
  user_id: string | null;
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
 *  - `event_id`        <- `resolvedEventId` (the CANONICAL server uuid,
 *                        NOT `report.eventId` — that field is the
 *                        client-side provider id string, e.g.
 *                        "us1000abcd", used for local queue matching only.
 *                        Migration 0011 fix: inserting `report.eventId`
 *                        directly used to send a non-uuid string into this
 *                        uuid column for every assigned report; the caller
 *                        (`submitTier1` below) resolves the real uuid via
 *                        `resolveEventUuid` first and passes it in here.
 *                        `null` is the correct value for a genuinely
 *                        unassociated report (D26 rapid/unassigned pool)
 *                        AND the safe fallback when resolution fails —
 *                        either way this function just inserts what it's
 *                        given, it makes no resolution decision itself)
 *  - `cartoon_level`   <- `cartoonLevel`
 *  - `lat` / `lon`     <- `location.lat` / `location.lon`
 *  - `location_quality`<- `location.quality` ("gps" | "manual")
 *  - `created_at`      <- `createdAt` (device capture time; ISO string)
 *  - `user_id`         <- `userId` (the third argument — 2026-08-16 storage
 *                        wave: this used to be permanently unsent, "D8:
 *                        future accounts column only". It is now populated
 *                        with the calling device's `auth.uid()` whenever an
 *                        anonymous Supabase Auth session exists, which is
 *                        exactly what migration 0015's `felt_reports_
 *                        select_own` policy and this wave's felt-photos
 *                        Storage path both need to become real. `null` is
 *                        still the correct, fully-supported value — see
 *                        `ensureAnonymousUserId` below, called by
 *                        `submitTier1` and degrading to `null` on any
 *                        sign-in failure without ever blocking the report.)
 * Deliberately NOT sent (left to the database):
 *  - `geohash_p5`      — `GENERATED ALWAYS AS ... STORED`, server-computed
 *  - `submitted_at`    — `default now()`, the server's own receipt time is
 *                        more truthful than a client clock guess
 */
export function buildFeltReportInsert(
  report: Tier1Report,
  resolvedEventId: string | null,
  userId: string | null = null,
): FeltReportInsert {
  return {
    report_id: report.reportId,
    device_id: report.deviceId,
    event_id: resolvedEventId,
    user_id: userId,
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
 * NOTE on `user_id` (2026-08-16 storage wave): unlike `felt_reports` and
 * `felt_comments`, `felt_report_details` has NO `user_id` column of its own
 * (migration 0003) — it is a 1:1 child of `felt_reports`, and migration
 * 0015's own header comment already establishes the pattern this transport
 * follows: ownership is proven by joining through `felt_report_id` to the
 * parent row's `user_id`, never by duplicating the column here. Adding one
 * would be schema growth with no RLS/ownership need it doesn't already
 * satisfy — so this function intentionally does NOT gain a `userId`
 * parameter the way `buildFeltReportInsert`/`buildFeltCommentInsert` did.
 *
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
 *                             2's 1-5 grade, 2026-08-15 flow restructure,
 *                             renumbered DG0-DG4 -> DG1-DG5 in the
 *                             2026-08-17 update wave — supersedes the old
 *                             Q10 questionnaire answer; the column itself is
 *                             unchanged, only its range widened 0-3 -> 0-4
 *                             (migration 0009) then shifted 0-4 -> 1-5
 *                             (migration 0018))
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
 * NOT mapped here: `report.answers.comment` (see `buildFeltCommentInsert`
 * below — it goes to the separate `felt_comments` stream table, not a
 * `felt_report_details` column) and `report.photoUri` (window 3's optional
 * photo). There is no `felt_report_details` column for a photo — it belongs
 * in the separate `felt_photos` table (`storage_path`, moderation-gated,
 * migration 0003), which requires an actual Supabase Storage upload this
 * transport does not attempt this wave (2026-08-15 flow restructure scope:
 * "do NOT attempt storage upload"). TODO(Phase 2 storage wave): once a real
 * upload path exists, add a `submitPhoto` step here (or a second transport
 * method) that uploads `report.photoUri` to Storage and inserts the
 * resulting `storage_path` into `felt_photos` — until then a queued photo
 * stays on the device only, same "never lost, just not yet sent" contract as
 * every other queued field.
 *
 * `raw_answers` DOES still include the verbatim `comment` string (jsonb, per
 * the column's own "authoritative source" comment in migration 0003) — that
 * is intentional duplication for the re-scoring audit trail, not a
 * substitute for the `felt_comments` row `buildFeltCommentInsert` produces.
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

export interface FeltCommentInsert {
  comment_id: string;
  report_id: string;
  device_id: string;
  user_id: string | null;
  body: string;
}

/**
 * Maps window 3's optional comment to a `felt_comments` insert row
 * (migration 0003) — the fix for the 2026-08-16 comment-upload gap: the
 * comment text used to be written ONLY into `felt_report_details.raw_answers`
 * (jsonb), which is never read back for display, so a submitted comment
 * silently never reached the public `felt_comments` stream. Returns `null`
 * when there is no comment to send (the common case — the field is
 * optional), so callers can skip the second insert entirely.
 *
 * Column mapping:
 *  - `comment_id`  <- `report.detailId`, reused (not a fresh uuid) so a
 *                     queue retry of the SAME Tier2Report submission hits
 *                     the same PK and is caught by the unique-violation
 *                     idempotency check below, exactly like `report_id` does
 *                     for `felt_reports` in `buildFeltReportInsert`.
 *  - `report_id`   <- `report.feltReportId` (FK to the tier-1 row this
 *                     comment is attached to — a comment always belongs to a
 *                     report, tier-1 or tier-2, per the migration's own
 *                     comment on `felt_comments`).
 *  - `device_id`   <- `report.deviceId` (copied from the tier-1 record at
 *                     enqueue time, see `Tier2Report.deviceId`'s own doc —
 *                     `felt_comments.device_id` is `not null`).
 *  - `user_id`     <- `userId` (2026-08-16 storage wave: same
 *                     `ensureAnonymousUserId` value `buildFeltReportInsert`
 *                     receives — `null` when no anonymous session exists,
 *                     never blocking the comment).
 *  - `body`        <- `report.answers.comment`.
 * Deliberately NOT sent (left to the database):
 *  - `moderation_status` — `default 'pending'` (D15: comments are moderated
 *    before public display; this transport never sets it to anything else).
 *  - `moderated_at`, `moderated_by` — unused at write time (D15's
 *    moderation UPDATE happens via the service_role key, not this client).
 */
export function buildFeltCommentInsert(
  report: Tier2Report,
  userId: string | null = null,
): FeltCommentInsert | null {
  const body = report.answers.comment;
  if (!body) {
    return null;
  }
  return {
    comment_id: report.detailId,
    report_id: report.feltReportId,
    device_id: report.deviceId,
    user_id: userId,
    body,
  };
}

/** True for any Postgres/PostgREST error that isn't a known "this was
 * already inserted" case — the safe default for an offline-queue transport
 * is "retry" (queue.ts's own doc: "no report is ever lost"), never "give up
 * silently" on an error shape we don't specifically recognize. */
function isRetryableInsertError(errorCode: string | undefined): boolean {
  return errorCode !== POSTGRES_UNIQUE_VIOLATION;
}

/**
 * Ensures an anonymous Supabase Auth session exists and returns its
 * `auth.uid()`, or `null` on ANY failure — sign-in rejection, no network,
 * misconfigured project. Every caller in this file treats `null` as "degrade
 * gracefully", never as a reason to fail the surrounding report/comment/
 * photo write (2026-08-16 storage wave brief: "Reports must STILL submit
 * fine if the anonymous sign-in fails").
 *
 * `signInAnonymously()` (`src/lib/supabase.ts`) already memoizes the
 * in-flight sign-in promise AND short-circuits when a session is already
 * persisted (AsyncStorage-backed, survives app restarts) — this wrapper adds
 * nothing beyond "read the uid back out afterwards, or return null instead
 * of throwing". `client.auth.getSession()` reads the SDK's in-memory/
 * persisted session directly (no network round-trip of its own), so calling
 * this on every submit/upload attempt is cheap once a session exists.
 */
async function ensureAnonymousUserId(client: SupabaseClient): Promise<string | null> {
  try {
    await signInAnonymously();
  } catch {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    return null;
  }
  return data.session.user.id;
}

/** `image/jpeg` unless the local URI's own extension says otherwise — the
 * picker (`app/felt-report/details.tsx`) forces JPEG re-encoding at
 * quality 0.4 for the common case, but the storage path this wave writes to
 * is always suffixed `.jpg` regardless (see `uploadFeltPhoto` below), so
 * this only affects the `Content-Type` header, not the object key; kept
 * narrow to the three mime types migration 0016's bucket actually allows. */
function inferPhotoContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

/**
 * Reads a LOCAL photo uri's bytes into whatever body shape `@supabase/
 * storage-js`'s `upload()` accepts directly — no manual base64 decoding,
 * on either platform. Two different reads because a single strategy can't
 * cover both (wave brief: "pick what works on BOTH native and web; the web
 * build is the primary live channel right now, so WEB MUST WORK"):
 *  - **web**: `expo-image-picker`'s web implementation returns a `blob:`/
 *    `data:` uri, not a real filesystem path — `fetch(uri).blob()` is the
 *    standard, well-documented way to turn either back into a `Blob`
 *    (which `storage-js` uploads via `FormData`, see its own `upload()`).
 *  - **native**: `expo-file-system`'s new `File` class (SDK 52+, replacing
 *    the deprecated `readAsStringAsync`/base64 pattern) exposes
 *    `arrayBuffer()` directly against a real `file://` uri — no base64
 *    round-trip, no extra dependency (`expo-file-system` is already an
 *    Expo-bundled package, added to `package.json` this wave to match every
 *    other `expo-*` module this repo declares explicitly rather than relying
 *    on it staying a transitive dependency of `expo` itself).
 */
async function readPhotoBody(uri: string): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    return await response.blob();
  }
  return await new File(uri).arrayBuffer();
}

export interface FeltPhotoInsert {
  report_id: string;
  storage_path: string;
}

/**
 * Maps a resolved storage path to a `felt_photos` upsert row (migration
 * 0003 + 0016's added `felt_photos_report_id_uq`). Deliberately NOT sent
 * (left to the database, or to whatever the row already has on a retry):
 *  - `photo_id`          — `default gen_random_uuid()`, only meaningful on
 *                          a true first insert
 *  - `moderation_status` — `default 'pending'` on insert; on an upsert
 *                          conflict this column is simply absent from the
 *                          payload, so Postgres leaves it untouched rather
 *                          than resetting an already-moderated row (see
 *                          migration 0016's own comment on
 *                          `felt_photos_report_id_uq`)
 *  - `moderated_at`, `moderated_by` — same reasoning, D15's moderation
 *                          UPDATE happens via service_role, not this client
 *  - `created_at`         — `default now()`
 */
export function buildFeltPhotoInsert(reportId: string, storagePath: string): FeltPhotoInsert {
  return { report_id: reportId, storage_path: storagePath };
}

/**
 * Uploads a window-3 photo (`Tier2Report.photoUri`) to the private
 * `felt-photos` Storage bucket (migration 0016) at
 * `<auth.uid()>/<felt_report_id>.jpg`, then upserts the matching
 * `felt_photos` row (moderation stays whatever it already was — see
 * migration 0016's own comment on why `moderation_status` is never sent
 * here). Never throws: every failure path returns `{ outcome: "failed" }`
 * so `queue.ts`'s photo-retry pass can safely re-attempt on the next drain
 * without the surrounding report ever being affected (photo upload is
 * always a step AFTER the report/detail rows already landed — see
 * `queue.ts`'s own gating comment).
 */
export async function uploadFeltPhoto(
  client: SupabaseClient,
  report: Tier2Report,
): Promise<PhotoUploadResult> {
  const photoUri = report.photoUri;
  if (!photoUri) {
    // Nothing to upload — not a failure, just a no-op the caller shouldn't
    // have invoked (queue.ts only calls this when photoUri is set); kept
    // defensive rather than asserting, since it costs nothing.
    return { outcome: "uploaded" };
  }

  const userId = await ensureAnonymousUserId(client);
  if (!userId) {
    // No provable identity -> no safe storage path to write to (migration
    // 0016's RLS predicate requires the path's first segment to equal
    // auth.uid()). Defer, never drop: the report itself already succeeded
    // independently of this call.
    return { outcome: "failed" };
  }

  try {
    const body = await readPhotoBody(photoUri);
    const storagePath = `${userId}/${report.feltReportId}.jpg`;

    const { error: uploadError } = await client.storage
      .from(FELT_PHOTOS_BUCKET)
      .upload(storagePath, body, {
        upsert: true, // retry-idempotent: re-running this on the same path overwrites, never duplicates
        contentType: inferPhotoContentType(photoUri),
      });
    if (uploadError) {
      return { outcome: "failed" };
    }

    // onConflict: 'report_id' targets migration 0016's new unique
    // constraint — a retry after a dropped response upserts the SAME row
    // rather than erroring or duplicating (see `buildFeltPhotoInsert`'s own
    // doc for why `moderation_status` is safe to omit here).
    const { error: rowError } = await client
      .from("felt_photos")
      .upsert(buildFeltPhotoInsert(report.feltReportId, storagePath), {
        onConflict: "report_id",
      });
    if (rowError) {
      return { outcome: "failed" };
    }

    return { outcome: "uploaded" };
  } catch {
    return { outcome: "failed" };
  }
}

/**
 * Session-lifetime cache of `EventRegistration -> canonical event uuid`
 * (migration 0011's own "cache the mapping locally" ask) — module-level, so
 * every `Tier1Report` filed against the SAME event within one app session
 * (common case: several people's devices reporting the same quake, or one
 * device browsing back to the same event page) reuses the first RPC's
 * result instead of round-tripping again. Resets on app restart, which is
 * fine: the RPC itself is idempotent (a cache miss just re-resolves the
 * same uuid), this is purely a network-cost optimization, never a
 * correctness dependency.
 */
const eventUuidCache = new Map<string, string>();

function eventRegistrationCacheKey(registration: EventRegistration): string {
  return `${registration.provider}:${registration.providerId}`;
}

/**
 * Resolves an `EventRegistration` snapshot to the canonical server
 * `events.event_id` uuid via the `upsert_event_from_client` RPC (migration
 * 0011), consulting/populating `eventUuidCache` first. Returns `null` — the
 * safe "leave this report unassigned" fallback, never a thrown error — for
 * any RPC failure (network drop, validation rejection from the guard rails
 * in the SQL function, misconfigured project): a resolution failure must
 * never block or drop the felt report itself, only degrade it into the D26
 * unassigned pool, which a later server-side association pass can still
 * pick up from the report's own stored lat/lon/created_at.
 */
async function resolveEventUuid(
  client: SupabaseClient,
  registration: EventRegistration,
): Promise<string | null> {
  const cacheKey = eventRegistrationCacheKey(registration);
  const cached = eventUuidCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Param names MUST carry the `p_` prefix — they match migration 0011's
    // PL/pgSQL parameter names exactly (PostgREST resolves rpc args by
    // name; unprefixed names fail with "function not found", which this
    // resolver then silently degrades to unassigned — verified live
    // 2026-08-16).
    const { data, error } = await client.rpc("upsert_event_from_client", {
      p_provider: registration.provider,
      p_provider_event_id: registration.providerId,
      p_origin_time: new Date(registration.originTime).toISOString(),
      p_lat: registration.lat,
      p_lon: registration.lon,
      p_depth_km: registration.depthKm,
      p_magnitude: registration.magnitude,
      p_mag_type: registration.magType,
      p_place_name: registration.placeName,
    });

    if (error || typeof data !== "string" || data.length === 0) {
      return null;
    }

    eventUuidCache.set(cacheKey, data);
    return data;
  } catch {
    // Same "degrade to unassigned, never throw" contract as the
    // error-response branch above — a network exception from `.rpc()`
    // itself (as opposed to a typed PostgREST error response) must not
    // propagate out of this resolver.
    return null;
  }
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

    // Resolve the client-side provider id to the canonical server uuid
    // BEFORE inserting (migration 0011) — only when this report actually
    // carries a registration snapshot (Event Detail's pill); a Home
    // rapid/unassigned report has none and stays `event_id: null`, which is
    // correct (D26), not a fallback.
    const resolvedEventId = report.eventRegistration
      ? await resolveEventUuid(client, report.eventRegistration)
      : null;

    // 2026-08-16 storage wave: ensure (or reuse) an anonymous auth session
    // and populate `user_id` from it. `null` on any failure — never blocks
    // the insert (see `ensureAnonymousUserId`'s own doc).
    const userId = await ensureAnonymousUserId(client);

    const { error } = await client
      .from("felt_reports")
      .insert(buildFeltReportInsert(report, resolvedEventId, userId));

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

    if (error && error.code !== POSTGRES_UNIQUE_VIOLATION) {
      return { outcome: "failed", retryable: isRetryableInsertError(error.code) };
    }

    // 2026-08-16 comment-upload-gap fix: window 3's optional comment gets
    // its own row in the moderated felt_comments stream, not just the
    // raw_answers jsonb blob above. A queue retry re-runs this whole
    // function, so both inserts must independently tolerate hitting an
    // already-succeeded unique key (see each build function's own doc).
    const commentInsert = buildFeltCommentInsert(report, await ensureAnonymousUserId(client));
    if (commentInsert) {
      const { error: commentError } = await client
        .from("felt_comments")
        .insert(commentInsert);

      if (commentError && commentError.code !== POSTGRES_UNIQUE_VIOLATION) {
        return {
          outcome: "failed",
          retryable: isRetryableInsertError(commentError.code),
        };
      }
    }

    return { outcome: "submitted", serverReportId: report.detailId };
  },

  /**
   * 2026-08-16 storage wave: window 3's optional photo, uploaded AFTER the
   * report/detail rows already landed (`queue.ts`'s photo-upload pass only
   * calls this once the surrounding queue item's `state` is "submitted" —
   * see that file's own gating comment, which is also what satisfies
   * `felt_photos.report_id`'s foreign key to `felt_reports.report_id`
   * before this ever runs). See `uploadFeltPhoto`'s own doc for the upload
   * itself; this method is only the `getSupabaseClient() -> null` guard
   * every other method here already has.
   */
  async uploadPhoto(report: Tier2Report): Promise<PhotoUploadResult> {
    const client = getSupabaseClient();
    if (!client) {
      return { outcome: "failed" };
    }
    return uploadFeltPhoto(client, report);
  },
};
