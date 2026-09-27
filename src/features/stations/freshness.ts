import type { StationFreshness } from "./types";

export const LIVE_MAX_AGE_MS = 10 * 60 * 1000;
export const RECENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Tier of a station whose last known sample is `lastSampleMs` (null =
 * nothing known). `now` is injectable for tests. */
export function classifyFreshness(
  lastSampleMs: number | null,
  now: number = Date.now(),
): StationFreshness {
  if (lastSampleMs === null) return "silent";
  const age = now - lastSampleMs;
  if (age <= LIVE_MAX_AGE_MS) return "live";
  if (age <= RECENT_MAX_AGE_MS) return "recent";
  return "silent";
}

/** What the catalogue's 24 h probe lets the map say before any fetch:
 * a station with a recent build-time sighting is at least "recent". */
export function freshnessFromCatalog(
  lastSeenAt: string | null,
  now: number = Date.now(),
): StationFreshness {
  if (!lastSeenAt) return "silent";
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return "silent";
  return now - seen <= RECENT_MAX_AGE_MS ? "recent" : "silent";
}
