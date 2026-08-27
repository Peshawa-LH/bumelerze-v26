// Per-field canonical derivation — source-and-ingestion-plan.md §5.1: "D4/D23
// ranked USGS > EMSC > GEOFON and picked one winner per event. Given [USGS
// authors ~3% of this region's events], that is backwards... Replace it with
// per-field derivation."
//
// THIS FILE IS THE ONE PLACE the preference order lives (wave brief: "so the
// science review can change it without a code hunt"). It is NOT duplicated
// in SQL: `events.origin_time_source_id` / `location_source_id` /
// `depth_source_id` / `magnitude_source_id` (migration 0002) are written by
// plain `UPDATE` statements from `db.ts`, using the pick this module
// computes — there is no second copy of `locationAuthorityRank`/
// `magnitudeAuthorityRank` anywhere else in this codebase. If a future
// SQL-only job (a backfill migration, say) ever needs to re-derive events
// without going through this Edge Function, PORT this file's two rank
// functions into SQL at that point (same "port, cross-reference, don't
// share a runtime" choice `matching.ts` documents) rather than assuming they
// already exist there.
//
// STATUS: PROVISIONAL pending owner (Peshawa) sign-off — source-and-
// ingestion-plan.md §7 item 1 lists "per-field preference order" as an open
// science decision, not yet a confirmed D-numbered decision. Ships now per
// D14 (Claude decides with recommended defaults; science-critical items go
// to the owner as a drafted confirm-review, never as an open question) —
// exactly the same "provisional-but-implemented" posture migration 0012
// already used for its own crowd-detection thresholds.

import type { StoredSourceRecord } from "./types.ts";

/**
 * Location/depth/origin-time preference (source-and-ingestion-plan.md §5.1):
 * "nearest authoritative network first (ISN, ISK, TEH, THR, AFAD), then ISC,
 * then IDC, then NEIC." The five nearest-network agencies are given the SAME
 * rank — the plan states them as one group ("nearest authoritative
 * network"), not a relative ordering among themselves; ties within a rank
 * are broken by `pickBest`'s own freshness/review tie-break below, not by
 * this function. Lower number = more preferred. `'US'`/`'USGS'` are treated
 * as aliases of NEIC (USGS's `properties.net` reports the lowercase network
 * code `'us'` for its own hypocenters, not the string "NEIC").
 *
 * Unranked/unknown agencies (GEOFON's own automatic `'GFZ'` solutions, EMSC
 * self-authored `'EMSC'`, a relayed agency the plan's evidence didn't cover
 * — e.g. RSSC/IIEES/KOERI, all observed authoring EMSC-relayed records in
 * the region per source-and-ingestion-plan.md §1) fall to the lowest
 * priority rather than being rejected — an event seen by ONLY an unranked
 * agency must still get a location, just the least-preferred one available.
 */
const LOCATION_AUTHORITY_RANK: Record<string, number> = {
  ISN: 1,
  ISK: 1,
  TEH: 1,
  THR: 1,
  AFAD: 1,
  ISC: 2,
  IDC: 3,
  NEIC: 4,
  US: 4,
  USGS: 4,
};
const LOCATION_AUTHORITY_FALLBACK_RANK = 100;

export function locationAuthorityRank(authorAgency: string | null): number {
  if (!authorAgency) {
    return LOCATION_AUTHORITY_FALLBACK_RANK;
  }
  return LOCATION_AUTHORITY_RANK[authorAgency.toUpperCase()] ?? LOCATION_AUTHORITY_FALLBACK_RANK;
}

/** True for a moment-magnitude-family type code (Mw, Mww, mB(?)... — the
 * FDSN convention is a leading "Mw"). Deliberately a prefix test, not an
 * exact-match allow-list: agencies spell the qualifier suffix differently
 * (Mww, Mwr, Mwc, Mwp) and the type is never silently converted regardless
 * (this module only ever picks a (magnitude, magType) PAIR from the same
 * source record — see `deriveCanonicalFields` below), so over-matching the
 * prefix costs nothing. */
function isMomentMagnitude(magType: string | null): boolean {
  return magType !== null && magType.toUpperCase().startsWith("MW");
}

/**
 * Magnitude preference (source-and-ingestion-plan.md §5.1): "prefer a
 * reviewed Mw ... where one exists, else the local ML ... recording the
 * type honestly rather than converting silently." Two explicit tiers from
 * the plan (rank 1, rank 2 below), plus two residual tiers so an event with
 * neither still resolves to its best available magnitude rather than none:
 *
 *   1. Reviewed moment magnitude (any agency, not just GCMT/NEIC — the
 *      plan names those as the common real-world source of a reviewed Mw
 *      in this catalog per source-and-ingestion-plan.md §2's authorship
 *      table, not as an exhaustive allow-list; gating on the TYPE plus
 *      review status, not the agency name, is what stays correct as new
 *      contributors appear).
 *   2. A local ML/mb from the nearest-network tier (`locationAuthorityRank`
 *      rank 1: ISN/ISK/TEH/THR/AFAD) — "the local ML from the nearest
 *      network", regardless of review status: for many of these agencies
 *      (e.g. ISN down to ML 0.4, source-and-ingestion-plan.md §3) a
 *      reviewed Mw will never exist at all, and an unreviewed local ML is
 *      still the right number to show, honestly typed.
 *   3. Any other reviewed magnitude (ISC's own preferred value, IDC, an
 *      unreviewed-elsewhere NEIC mb) — better than an unreviewed unknown.
 *   4. Any moment magnitude at all, even unreviewed/automatic.
 *   100. Everything else with a magnitude value at all.
 */
export function magnitudeAuthorityRank(
  magnitudeAuthor: string | null,
  magType: string | null,
  reviewStatus: "automatic" | "reviewed" | "deleted",
): number {
  const isMw = isMomentMagnitude(magType);
  const isReviewed = reviewStatus === "reviewed";
  const isNearestNetwork = locationAuthorityRank(magnitudeAuthor) === 1;

  if (isMw && isReviewed) return 1;
  if (isNearestNetwork) return 2;
  if (isReviewed) return 3;
  if (isMw) return 4;
  return 100;
}

interface RankedPick {
  record: StoredSourceRecord;
  rank: number;
}

/** Shared tie-break for both field groups: lower `rank` wins; among equal
 * ranks, a `reviewed` record beats an `automatic` one, then the
 * most-recently-fetched record wins (a later poll's revision supersedes an
 * earlier one), then `sourceRecordId` (stable, deterministic final
 * tie-break — never actually observed to matter, but removes any
 * dependence on array iteration order). */
function pickBest(candidates: RankedPick[]): StoredSourceRecord | null {
  let best: RankedPick | null = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.rank !== best.rank) {
      if (candidate.rank < best.rank) best = candidate;
      continue;
    }
    const candidateReviewed = candidate.record.reviewStatus === "reviewed";
    const bestReviewed = best.record.reviewStatus === "reviewed";
    if (candidateReviewed !== bestReviewed) {
      if (candidateReviewed) best = candidate;
      continue;
    }
    if (candidate.record.fetchedAtMs !== best.record.fetchedAtMs) {
      if (candidate.record.fetchedAtMs > best.record.fetchedAtMs) best = candidate;
      continue;
    }
    if (candidate.record.sourceRecordId < best.record.sourceRecordId) {
      best = candidate;
    }
  }
  return best?.record ?? null;
}

export interface DerivedFields {
  originTimeMs: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  place: string | null;
  locationSourceId: string;
  magnitude: number | null;
  magType: string | null;
  magnitudeSourceId: string | null;
}

/**
 * Computes the canonical per-field values for one event from ALL of its
 * (non-deleted) `event_source_records`. Two independent picks, matching the
 * plan's own framing exactly ("Origin time: follows location"): a LOCATION
 * pick supplies origin_time + lat/lon + depth + place together (they always
 * come from the same origin solution — never mixed across sources), and a
 * SEPARATE magnitude pick supplies (magnitude, magType) together (never a
 * magnitude value from one record paired with another record's type).
 *
 * Returns `null` for the whole result only when there are no eligible
 * source records at all (every one deleted) — the caller (`db.ts`) then
 * leaves the event's existing canonical fields untouched rather than
 * nulling out a NOT-NULL column.
 */
export function deriveCanonicalFields(sourceRecords: readonly StoredSourceRecord[]): DerivedFields | null {
  const eligible = sourceRecords.filter((r) => r.reviewStatus !== "deleted");
  if (eligible.length === 0) {
    return null;
  }

  const locationPick = pickBest(
    eligible.map((record) => ({ record, rank: locationAuthorityRank(record.authorAgency) })),
  );
  // `eligible.length > 0` guarantees `locationPick` is non-null.
  const location = locationPick as StoredSourceRecord;

  const magnitudeCandidates = eligible.filter((r) => r.parsedMagnitude !== null);
  const magnitudePick = pickBest(
    magnitudeCandidates.map((record) => ({
      record,
      rank: magnitudeAuthorityRank(record.magnitudeAuthor, record.parsedMagType, record.reviewStatus),
    })),
  );

  return {
    originTimeMs: location.parsedOriginTimeMs,
    lat: location.parsedLat,
    lon: location.parsedLon,
    depthKm: location.parsedDepthKm,
    place: location.parsedPlace,
    locationSourceId: location.sourceRecordId,
    magnitude: magnitudePick?.parsedMagnitude ?? null,
    magType: magnitudePick?.parsedMagType ?? null,
    magnitudeSourceId: magnitudePick?.sourceRecordId ?? null,
  };
}
