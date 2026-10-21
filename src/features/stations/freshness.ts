import type { LiveStation, StationFreshness } from "./types";

export const LIVE_MAX_AGE_MS = 10 * 60 * 1000;
export const RECENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Raspberry Shake's public FDSN archive serves "T minus 30 minutes and
 * older" (data.raspberryshake.org/fdsnws/dataselect/1/; 30 min behind when
 * measured on 2026-10-21), and its real-time feed is not open to browsers
 * or apps, so a Raspberry Shake counts as live for an hour. The "last
 * sample N min ago" line then states the delay. */
export const RASPBERRY_SHAKE_LIVE_MAX_AGE_MS = 60 * 60 * 1000;

/** How old the last sample may be for a station of each service to count as
 * live. Exhaustive on purpose: a new service has to choose. */
const LIVE_MAX_AGE_BY_SERVICE: Record<LiveStation["service"], number> = {
  earthscope: LIVE_MAX_AGE_MS,
  koeri: LIVE_MAX_AGE_MS,
  geofon: LIVE_MAX_AGE_MS,
  raspberryshake: RASPBERRY_SHAKE_LIVE_MAX_AGE_MS,
};

export function liveMaxAgeMs(service: LiveStation["service"]): number {
  return LIVE_MAX_AGE_BY_SERVICE[service] ?? LIVE_MAX_AGE_MS;
}

/** Tier of a station whose last known sample is `lastSampleMs` (null =
 * nothing known). `now` is injectable for tests; `liveMaxAge` is the
 * station's service allowance (`liveMaxAgeMs`), ten minutes by default. */
export function classifyFreshness(
  lastSampleMs: number | null,
  now: number = Date.now(),
  liveMaxAge: number = LIVE_MAX_AGE_MS,
): StationFreshness {
  if (lastSampleMs === null) return "silent";
  const age = now - lastSampleMs;
  if (age <= liveMaxAge) return "live";
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
