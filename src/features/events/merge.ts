import {
  DEDUP_MAX_DISTANCE_KM,
  DEDUP_MAX_MAG_DELTA,
  DEDUP_MAX_TIME_DELTA_MS,
} from "./config";
import { haversineDistanceKm } from "./distance";
import type { Event } from "./types";

/**
 * Cross-provider completeness merge for the region feed
 * (event-pipeline-design.md §2, applied client-side).
 *
 * WHY THIS EXISTS — a real missed earthquake: 2026-08-13 22:28 UTC, M4.0 mb,
 * Iran–Iraq border region. Present in EMSC's fdsnws catalog, absent from
 * USGS entirely (below NEIC's regional completeness threshold, ~M4.5 for
 * this area). Under the previous availability-FAILOVER semantics EMSC was
 * only consulted when USGS *failed*, so an EMSC-only event could never
 * surface while USGS was healthy — a felt regional M4.0 simply never
 * appeared in the app. The region feed now fetches ALL providers (USGS,
 * EMSC, GEOFON) in parallel and merges: the highest-authority catalog is
 * canonical where they overlap (D4 order: USGS > EMSC > GEOFON), each
 * lower-authority catalog fills the completeness gaps of the ones above it.
 *
 * Pure function — no I/O, no clock; queries.ts owns the parallel fetch
 * orchestration around it.
 */

/**
 * §2 step-3 spatial-temporal match: same physical earthquake when
 * |Δ origin time| <= 16 s AND epicentral distance <= 50 km AND
 * |ΔM| <= 1.5. All three thresholds are inclusive (<=) and live in
 * config.ts. The |ΔM| guard is defined "when both magnitudes exist" in the
 * design doc; in the normalized `Event` model a magnitude value always
 * exists (normalize.ts drops magnitude-less features), so it is applied
 * unconditionally here.
 */
export function isSameEarthquake(a: Event, b: Event): boolean {
  if (Math.abs(a.originTime - b.originTime) > DEDUP_MAX_TIME_DELTA_MS) {
    return false;
  }
  if (Math.abs(a.magnitude.value - b.magnitude.value) > DEDUP_MAX_MAG_DELTA) {
    return false;
  }
  return haversineDistanceKm(a.lat, a.lon, b.lat, b.lon) <= DEDUP_MAX_DISTANCE_KM;
}

/**
 * Merge one region-poll's per-provider event lists into a single
 * deduplicated list. N-way, ordered-priority: `providerLists` is given in
 * CANONICAL AUTHORITY ORDER (§2 "canonical parameter derivation" per D4 —
 * queries.ts passes [USGS, EMSC, GEOFON]; a future provider slots into the
 * list at its authority position, nothing here changes —
 * provider-architecture.md documents that contract):
 *
 * - Every event in the FIRST list passes through unchanged — nothing
 *   outranks it.
 * - An event in a later list that spatial-temporally matches (per
 *   `isSameEarthquake`) a surviving event from ANY EARLIER list is dropped
 *   entirely; the earlier provider's `Event` is kept as-is. Nothing from
 *   the dropped record needs carrying (the client model has no per-field
 *   provenance to enrich — that's the future server-side ingestion
 *   worker's concern). §2's tie-break for multiple candidates — closest in
 *   (|Δt|, distance) lexicographic order — selects WHICH earlier record
 *   absorbs the duplicate; since the absorbed record contributes nothing
 *   client-side, an any-match test is outcome-equivalent here, and the
 *   worker's `find_cross_provider_match` (feed_watcher.py) implements the
 *   full tie-break where state attribution makes it observable.
 * - An event matching NO earlier-list survivor passes through as-is, its
 *   `provenance.provider` untouched (normalize.ts set it) — the
 *   completeness path that surfaces events the higher-authority catalogs
 *   missed. Events are never matched against their OWN provider's list
 *   (each catalog is trusted to be internally deduplicated).
 * - Degenerate inputs are natural special cases, not branches: one
 *   non-empty list → that list; all lists empty → empty.
 *
 * The guarantee, in one line: the same physical earthquake never appears
 * twice, and where providers overlap the highest-authority record wins.
 *
 * Result ordering: origin time descending (newest first), matching the
 * `orderby=time` ordering every provider query already requests — a merged
 * list must not interleave providers' orderings arbitrarily.
 *
 * Complexity: the region window holds at most a few hundred events per
 * provider, so a pairwise scan is fine. Feeds arrive time-ordered and the
 * match window is ±16 s, so the inner loop early-breaks on the time axis
 * rather than scanning every pair — O(n·m) worst case, ~O(Σn) in practice.
 * No fancier indexing is warranted at this scale.
 */
export function mergeProviderEvents(providerLists: Event[][]): Event[] {
  // Survivors from all already-processed (higher-priority) lists, kept
  // newest-first so the inner loop's time-axis early-break stays valid.
  const merged: Event[] = [];

  for (const list of providerLists) {
    // Defensive copy + sort (newest first). Every provider query requests
    // orderby=time already, so this is usually a no-op pass.
    const sorted = [...list].sort((a, b) => b.originTime - a.originTime);

    const survivors: Event[] = [];
    for (const event of sorted) {
      let matched = false;
      for (const canonical of merged) {
        // `merged` is newest-first: once a canonical event is older than
        // this event by more than the time window, every later one is too.
        if (event.originTime - canonical.originTime > DEDUP_MAX_TIME_DELTA_MS) {
          break;
        }
        if (isSameEarthquake(canonical, event)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        survivors.push(event);
      }
    }

    // Appended only AFTER the whole list is processed, so events are never
    // deduplicated against their own provider's list (see doc comment).
    merged.push(...survivors);
    merged.sort((a, b) => b.originTime - a.originTime);
  }

  return merged;
}
