// Supabase (service-role) data access for this function. Kept separate from
// `ingest-channel.ts`'s orchestration and `matching.ts`/`derivation.ts`'s
// pure decision logic so the interesting logic stays unit-testable without
// a live Postgres connection — same split as
// `supabase/functions/aggregate-felt-cells/db.ts`.
//
// WRITE PATH DESIGN: this module deliberately has NO custom SQL function of
// its own for "find-or-create the canonical event". It reuses the EXISTING
// `upsert_event_from_client` RPC (migrations 0011/0012) for that step —
// which already gives this ingester, for free: an advisory-lock-serialized,
// transactional dedup match (the same 16s/100km/1.5-mag thresholds this
// wave's brief asks for), brand-new-event creation, AND the D26 crowd-event
// reconciliation (a genuinely new agency event absorbing a nearby
// `status = 'possible'` crowd-detected event). Writing a second SQL
// function that duplicated that logic would both violate "reuse where
// possible" and risk drifting out of sync with the one the client's own
// felt-report flow already depends on. The only NEW SQL this wave adds
// (migration 0023) is columns, a CHECK widening, RLS, and a read view — no
// new plpgsql.
//
// This does mean event CREATION only happens through a call this module
// controls the parameters of, never a raw `insert into events`, and that
// the field-level derivation this function's `derivation.ts` computes is
// applied via a SEPARATE, plain `update events ...` afterward
// (`applyDerivedFields`) — see that function's own comment for the accepted,
// documented, low-probability concurrent-derivation race this implies
// (same posture the SQL functions themselves already accept for
// cross-provider event-creation races).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";

import { REGION_BBOX } from "./channels.ts";
import type { DerivedFields } from "./derivation.ts";
import type { RawSourceRecord, StoredSourceRecord } from "./types.ts";

export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error(
      "ingest-events: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the " +
        "function's environment — standard Supabase Edge Function env vars, never " +
        "hardcoded here; check the project's function secrets.",
    );
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

function isInRegionBbox(lat: number, lon: number): boolean {
  return (
    lat >= REGION_BBOX.minLat &&
    lat <= REGION_BBOX.maxLat &&
    lon >= REGION_BBOX.minLon &&
    lon <= REGION_BBOX.maxLon
  );
}

interface SourceRecordRow {
  source_record_id: string;
  event_id: string;
  provider: string;
  provider_event_id: string;
  parsed_origin_time: string;
  parsed_lat: number;
  parsed_lon: number;
  parsed_depth_km: number | null;
  parsed_magnitude: number | null;
  parsed_mag_type: string | null;
  parsed_place: string | null;
  author_agency: string | null;
  magnitude_author: string | null;
  review_status: "automatic" | "reviewed" | "deleted";
  fetched_at: string;
}

const SOURCE_RECORD_COLUMNS =
  "source_record_id, event_id, provider, provider_event_id, parsed_origin_time, " +
  "parsed_lat, parsed_lon, parsed_depth_km, parsed_magnitude, parsed_mag_type, " +
  "parsed_place, author_agency, magnitude_author, review_status, fetched_at";

function mapSourceRecordRow(row: SourceRecordRow): StoredSourceRecord {
  return {
    sourceRecordId: row.source_record_id,
    eventId: row.event_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    parsedOriginTimeMs: Date.parse(row.parsed_origin_time),
    parsedLat: row.parsed_lat,
    parsedLon: row.parsed_lon,
    parsedDepthKm: row.parsed_depth_km,
    parsedMagnitude: row.parsed_magnitude,
    parsedMagType: row.parsed_mag_type,
    parsedPlace: row.parsed_place,
    authorAgency: row.author_agency,
    magnitudeAuthor: row.magnitude_author,
    reviewStatus: row.review_status,
    fetchedAtMs: Date.parse(row.fetched_at),
  };
}

/** Looks up the ALREADY-KNOWN `event_source_records` row for an exact
 * (provider, provider_event_id) pair — the idempotent-retry / re-fetch
 * path. `null` when this is genuinely the first time this ingester has
 * seen this provider sighting. */
export async function findSourceRecord(
  client: SupabaseClient,
  provider: string,
  providerEventId: string,
): Promise<StoredSourceRecord | null> {
  const { data, error } = await client
    .from("event_source_records")
    .select(SOURCE_RECORD_COLUMNS)
    .eq("provider", provider)
    .eq("provider_event_id", providerEventId)
    .maybeSingle();
  if (error) {
    throw new Error(`findSourceRecord(${provider}, ${providerEventId}): ${error.message}`);
  }
  return data ? mapSourceRecordRow(data as SourceRecordRow) : null;
}

/** Updates an already-known source record in place with a freshly-fetched
 * revision — the "record changed since last poll" path
 * (`matching.ts`'s `sourceRecordChanged`). Never touches `event_id`: which
 * canonical event a given (provider, provider_event_id) belongs to is
 * decided once, at first sight, never re-litigated on a later revision. */
export async function updateSourceRecord(
  client: SupabaseClient,
  sourceRecordId: string,
  record: RawSourceRecord,
): Promise<void> {
  const { error } = await client
    .from("event_source_records")
    .update({
      raw_payload: record.rawPayload,
      parsed_origin_time: new Date(record.originTimeMs).toISOString(),
      parsed_lat: record.lat,
      parsed_lon: record.lon,
      parsed_depth_km: record.depthKm,
      parsed_magnitude: record.magnitude,
      parsed_mag_type: record.magType,
      parsed_place: record.place,
      author_agency: record.authorAgency,
      magnitude_author: record.magnitudeAuthor,
      review_status: record.reviewStatus,
      provider_updated_at: new Date(record.providerUpdatedAtMs).toISOString(),
      fetched_at: new Date().toISOString(),
    })
    .eq("source_record_id", sourceRecordId);
  if (error) {
    throw new Error(`updateSourceRecord(${sourceRecordId}): ${error.message}`);
  }
}

/**
 * First sight of a (provider, provider_event_id) pair: resolves (via the
 * existing `upsert_event_from_client` RPC — see this file's header comment)
 * which canonical event it belongs to, then fills in this ingester's own
 * richer columns (`raw_payload`, `author_agency`, `magnitude_author`,
 * `review_status`, `provider_updated_at`) that the RPC's own signature does
 * not accept — the RPC inserts a bare row (`raw_payload: '{}'`,
 * `author_agency`/`magnitude_author` left NULL) either onto a matched
 * existing event or a brand-new one; this function's second call finds that
 * exact row (now guaranteed to exist by (provider, provider_event_id)) and
 * upgrades it in one UPDATE.
 */
export async function createSourceRecordViaEventRegistry(
  client: SupabaseClient,
  record: RawSourceRecord,
): Promise<string> {
  const { data, error } = await client.rpc("upsert_event_from_client", {
    p_provider: record.provider,
    p_provider_event_id: record.providerEventId,
    p_origin_time: new Date(record.originTimeMs).toISOString(),
    p_lat: record.lat,
    p_lon: record.lon,
    p_depth_km: record.depthKm,
    p_magnitude: record.magnitude,
    p_mag_type: record.magType,
    p_place_name: record.place,
  });
  if (error) {
    throw new Error(
      `upsert_event_from_client(${record.provider}, ${record.providerEventId}): ${error.message}`,
    );
  }
  const eventId = data as string;

  const inserted = await findSourceRecord(client, record.provider, record.providerEventId);
  if (!inserted) {
    // Should be unreachable: the RPC guarantees a row exists for this exact
    // key once it returns successfully. Surfaced loudly rather than
    // silently skipping the enrichment UPDATE.
    throw new Error(
      `createSourceRecordViaEventRegistry(${record.provider}, ${record.providerEventId}): ` +
        `RPC returned event ${eventId} but no matching event_source_records row was found`,
    );
  }
  await updateSourceRecord(client, inserted.sourceRecordId, record);

  return eventId;
}

/** All non-deleted `event_source_records` for one event — the derivation
 * input (`derivation.ts`'s `deriveCanonicalFields`). */
export async function fetchSourceRecordsForEvent(
  client: SupabaseClient,
  eventId: string,
): Promise<StoredSourceRecord[]> {
  const { data, error } = await client
    .from("event_source_records")
    .select(SOURCE_RECORD_COLUMNS)
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`fetchSourceRecordsForEvent(${eventId}): ${error.message}`);
  }
  return ((data ?? []) as SourceRecordRow[]).map(mapSourceRecordRow);
}

/**
 * Writes `derivation.ts`'s per-field pick onto the canonical `events` row.
 * `null` (every attached source record is `review_status = 'deleted'`,
 * see that module's own doc comment) is a deliberate no-op — never clears a
 * NOT-NULL column. Magnitude/depth are only included in the UPDATE when the
 * derivation actually found a value, so an event that temporarily has no
 * eligible magnitude source keeps its last-known one rather than being
 * nulled out (`events_magnitude_required_when_published`, migration 0012,
 * would reject a null write on a published event outright).
 *
 * NOT wrapped in the same transaction as the source-record write it follows
 * — a concurrent second channel's tick touching the SAME event between
 * those two calls could interleave with this one. Accepted and documented,
 * same posture as `upsert_event_from_client`'s own header comment on the
 * two-different-providers-race-to-create case: low-probability at this
 * app's real polling cadence/volume, and self-healing — the NEXT
 * derivation run (triggered by either channel's next tick) recomputes from
 * the full, by-then-settled set of source records and converges on the same
 * answer regardless of which run "won" the interleaving.
 */
export async function applyDerivedFields(
  client: SupabaseClient,
  eventId: string,
  derived: DerivedFields | null,
): Promise<void> {
  if (derived === null) {
    return;
  }

  const update: Record<string, unknown> = {
    origin_time: new Date(derived.originTimeMs).toISOString(),
    lat: derived.lat,
    lon: derived.lon,
    place: derived.place,
    origin_time_source_id: derived.locationSourceId,
    location_source_id: derived.locationSourceId,
    depth_source_id: derived.locationSourceId,
    region_flag: isInRegionBbox(derived.lat, derived.lon),
  };
  if (derived.depthKm !== null) {
    update.depth_km = derived.depthKm;
  }
  if (derived.magnitude !== null) {
    update.magnitude = derived.magnitude;
    update.mag_type = derived.magType;
    update.magnitude_source_id = derived.magnitudeSourceId;
  }

  const { error } = await client.from("events").update(update).eq("event_id", eventId);
  if (error) {
    throw new Error(`applyDerivedFields(${eventId}): ${error.message}`);
  }
}
