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
 * appeared in the app. The region feed now fetches BOTH providers and
 * merges: USGS is the canonical catalog where the two overlap, EMSC fills
 * USGS's regional completeness gap.
 *
 * Pure function — no I/O, no clock; queries.ts owns the parallel fetch
 * orchestration around it.
 */

/**
 * §2 step-3 spatial-temporal match: same physical earthquake when
 * |Δ origin time| <= 16 s AND epicentral distance <= 100 km AND
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
 * Merge one region-poll's USGS and EMSC event lists into a single
 * deduplicated list:
 *
 * - Every USGS event passes through unchanged — USGS is the canonical
 *   provider (§2 "canonical parameter derivation": USGS ahead of EMSC in
 *   the authority order). When an EMSC record matches a USGS record, the
 *   USGS `Event` is kept as-is and the EMSC record is dropped entirely;
 *   nothing from the EMSC record needs carrying (the client model has no
 *   per-field provenance to enrich — that's the future server-side
 *   ingestion worker's concern).
 * - An EMSC event matching NO USGS event passes through as-is, with its
 *   `provenance.provider: "emsc"` untouched (normalize.ts set it) — this is
 *   the completeness path that surfaces USGS-missed regional events.
 * - Degenerate inputs are natural special cases, not branches: empty EMSC
 *   list → the USGS list; empty USGS list → the EMSC list (the old
 *   failover outcome).
 *
 * Result ordering: origin time descending (newest first), matching the
 * `orderby=time` ordering both provider queries already request — a merged
 * list must not interleave two providers' orderings arbitrarily.
 *
 * Complexity: the region window holds at most a few hundred events per
 * provider, so a pairwise scan is fine. Both feeds arrive time-ordered and
 * the match window is ±16 s, so the inner loop early-breaks on the time
 * axis rather than scanning every pair — O(n·m) worst case, ~O(n+m) in
 * practice. No fancier indexing is warranted at this scale.
 */
export function mergeProviderEvents(usgsEvents: Event[], emscEvents: Event[]): Event[] {
  // Defensive copy + sort (newest first). Both provider queries request
  // orderby=time already, so this is usually a no-op pass.
  const usgsSorted = [...usgsEvents].sort((a, b) => b.originTime - a.originTime);
  const emscSorted = [...emscEvents].sort((a, b) => b.originTime - a.originTime);

  const emscOnly: Event[] = [];
  for (const emscEvent of emscSorted) {
    let matched = false;
    for (const usgsEvent of usgsSorted) {
      // usgsSorted is newest-first: once a USGS event is older than the
      // EMSC event by more than the time window, every later one is too.
      if (emscEvent.originTime - usgsEvent.originTime > DEDUP_MAX_TIME_DELTA_MS) {
        break;
      }
      if (isSameEarthquake(usgsEvent, emscEvent)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      emscOnly.push(emscEvent);
    }
  }

  return [...usgsSorted, ...emscOnly].sort((a, b) => b.originTime - a.originTime);
}
