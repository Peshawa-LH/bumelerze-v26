// Cross-provider dedup match + change-detection, this function's own
// (Deno-flavored, `.ts`-suffixed) pure-logic module — no npm:/Deno-only
// import in this file, so it is directly `require`-able from this repo's
// Jest suite exactly like aggregate-felt-cells's `aggregate-event.ts`.
//
// PORTED, not imported, from `src/features/events/merge.ts` /
// `config.ts`'s DEDUP_* constants. Reuse-by-import was considered and
// rejected: `merge.ts`'s `isSameEarthquake` is pure and dependency-light
// (only `haversineDistanceKm`), but Deno's module resolution requires
// explicit file extensions on relative imports and the client's own
// `./distance` import omits one (Metro's resolver, not Deno's, fills that
// in) — a direct cross-runtime import would need either a rewritten client
// import graph or a Deno import-map shim, more machinery than this single
// three-constant comparison is worth. This is exactly the choice this
// repo already made for the SAME thresholds inside
// `upsert_event_from_client`/`detect_possible_events` (migrations
// 0011/0012), which re-declare the numbers as literal SQL constants with a
// "MUST mirror src/features/events/config.ts DEDUP_*... keep in sync"
// comment — this module is a third copy of that same rule, in the same
// spirit, not new debt. If a fourth copy is ever needed, that is the
// moment to extract `fdsn-dedup.ts` into a package Metro, Jest AND Deno can
// all resolve unmodified — not before (YAGNI, same as
// provider-architecture.md §3's own "factor it out when the second real use
// arrives" rule for `fdsn-text.ts`).
//
// KEEP IN SYNC: src/features/events/config.ts (DEDUP_MAX_TIME_DELTA_MS,
// DEDUP_MAX_DISTANCE_KM, DEDUP_MAX_MAG_DELTA), src/features/events/merge.ts
// (isSameEarthquake), supabase/migrations/0011_event_registry_and_assignment.sql
// (upsert_event_from_client step 2), supabase/migrations/0012_crowd_detection.sql
// (detect_possible_events' cooldown query and upsert_event_from_client's
// reconciliation query).

import type { CandidateEvent, RawSourceRecord, StoredSourceRecord } from "./types.ts";

export const DEDUP_MAX_TIME_DELTA_MS = 16_000;
export const DEDUP_MAX_DISTANCE_KM = 100;
export const DEDUP_MAX_MAG_DELTA = 1.5;

/** Mean earth radius in km — same value implicitly used by PostGIS's
 * `geography` distance calculations the SQL side relies on (WGS84 mean
 * radius, ~6371.0088 km; the small sub-0.01% difference from a sphere never
 * matters at a 100 km dedup threshold). */
const EARTH_RADIUS_KM = 6371.0088;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance, km. Ported from
 * `src/features/events/distance.ts` for the same cross-runtime reason as
 * this module's own header comment. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Same physical earthquake test as `merge.ts`'s `isSameEarthquake`, but
 * against a `CandidateEvent` (this ingester's minimal canonical-event shape)
 * rather than the client's `Event`, and with the magnitude guard made
 * OPTIONAL: a candidate event or incoming record with no magnitude on file
 * (e.g. a crowd-detected `status = 'possible'` event, which is created with
 * `magnitude = null`) still matches on time+distance alone rather than being
 * unconditionally rejected — the client's own `Event` model never has this
 * case (its normalizers already drop magnitude-less features), but this
 * ingester's candidate set includes crowd events, which the design brief
 * (source-and-ingestion-plan.md §5.2) explicitly wants to be reconcilable
 * through the SAME dedup path.
 *
 * HONEST DIVERGENCE from the real SQL this is ported from: standard SQL
 * NULL semantics mean `upsert_event_from_client`'s own tight step-2 match
 * (`abs(e.magnitude - p_magnitude) <= 1.5`) evaluates to NULL — i.e. FALSE
 * in a WHERE clause — whenever `e.magnitude` is NULL, so in PRODUCTION a
 * magnitude-less `status = 'possible'` event is NEVER matched by that tight
 * query; reconciling it only ever happens through that same function's
 * WIDER step-3 query (600s/100km, no magnitude term at all). This function
 * makes the tight match ALSO null-tolerant, which is a closer analogue of
 * step-3's rule than step-2's — a deliberate choice for this ingester's own
 * candidate-matching, not a byte-for-byte port of `upsert_event_from_client`.
 * Kept null-tolerant here because this module's candidate set can include
 * `status = 'possible'` events and the smaller/tighter window is still the
 * right one to try first when a magnitude genuinely cannot be compared.
 */
export function isSameEarthquake(candidate: CandidateEvent, record: RawSourceRecord): boolean {
  if (Math.abs(candidate.originTimeMs - record.originTimeMs) > DEDUP_MAX_TIME_DELTA_MS) {
    return false;
  }
  if (
    candidate.magnitude !== null &&
    Math.abs(candidate.magnitude - record.magnitude) > DEDUP_MAX_MAG_DELTA
  ) {
    return false;
  }
  return (
    haversineDistanceKm(candidate.lat, candidate.lon, record.lat, record.lon) <=
    DEDUP_MAX_DISTANCE_KM
  );
}

/**
 * Finds the best-matching candidate event for an incoming record, or `null`
 * if none is within threshold — the ingester's own equivalent of
 * `upsert_event_from_client` step 2's SQL match query (`order by abs(Δt)
 * asc limit 1`), used ONLY to decide whether to call that RPC at all (see
 * `ingest-channel.ts`): if a match already exists we skip straight to
 * attaching a source record via the existing (provider, provider_event_id)
 * short-circuit rather than re-running dedup server-side redundantly.
 * Ties broken by closest in time first, then closest in distance — same
 * tie-break order as the SQL query's own `order by abs(time delta) asc`
 * (that query has no secondary distance tie-break either; this mirrors it
 * exactly rather than inventing a stricter one).
 */
export function findMatchingEvent(
  candidates: readonly CandidateEvent[],
  record: RawSourceRecord,
): CandidateEvent | null {
  let best: CandidateEvent | null = null;
  let bestDeltaMs = Infinity;
  let bestDistanceKm = Infinity;

  for (const candidate of candidates) {
    if (!isSameEarthquake(candidate, record)) {
      continue;
    }
    const deltaMs = Math.abs(candidate.originTimeMs - record.originTimeMs);
    const distanceKm = haversineDistanceKm(candidate.lat, candidate.lon, record.lat, record.lon);
    if (deltaMs < bestDeltaMs || (deltaMs === bestDeltaMs && distanceKm < bestDistanceKm)) {
      best = candidate;
      bestDeltaMs = deltaMs;
      bestDistanceKm = distanceKm;
    }
  }

  return best;
}

/**
 * Idempotency's other half (alongside the DB's own (provider,
 * provider_event_id) unique index): true when a freshly-fetched record
 * differs from what is already stored for that exact provider sighting, so
 * a re-fetch of an UNCHANGED record writes nothing — same "skip-if-
 * unchanged" idiom as aggregate-felt-cells's `cellRowUnchanged`.
 *
 * Deliberately compares the PARSED FIELDS directly rather than trusting
 * `providerUpdatedAtMs` alone: GEOFON and ISC (FDSN text) carry no real
 * revision timestamp, so their adapters fall back to `originTimeMs` for
 * `providerUpdatedAtMs`, which never changes even when the upstream record
 * genuinely IS revised (e.g. ISC promotes a bulletin row from 'automatic'
 * review status, or a later contributor supplies a better magnitude for the
 * same EventID). A structural compare catches that; a timestamp-only compare
 * would not.
 */
export function sourceRecordChanged(
  existing: StoredSourceRecord,
  incoming: RawSourceRecord,
): boolean {
  return (
    existing.parsedOriginTimeMs !== incoming.originTimeMs ||
    existing.parsedLat !== incoming.lat ||
    existing.parsedLon !== incoming.lon ||
    existing.parsedDepthKm !== incoming.depthKm ||
    existing.parsedMagnitude !== incoming.magnitude ||
    existing.parsedMagType !== incoming.magType ||
    existing.parsedPlace !== incoming.place ||
    existing.authorAgency !== incoming.authorAgency ||
    existing.magnitudeAuthor !== incoming.magnitudeAuthor ||
    existing.reviewStatus !== incoming.reviewStatus
  );
}
