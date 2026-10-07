import type { Event } from "@/features/events";

const HOUR_MS = 3_600_000;

function sample(
  id: string,
  now: number,
  hoursAgo: number,
  lat: number,
  lon: number,
  magnitude: number,
  depthKm: number,
  provider: "usgs" | "emsc" | "geofon",
): Event {
  const originTime = now - hoursAgo * HOUR_MS;
  return {
    id,
    bumelerzeId: null,
    originTime,
    lat,
    lon,
    depthKm,
    magnitude: { value: magnitude, type: "ml" },
    placeName: "",
    provenance: {
      provider,
      providerId: id,
      fetchedAt: now,
      providerUpdatedAt: originTime,
    },
    sig: 0,
    isRegional: true,
    url: "",
  };
}

/**
 * Two made-up earthquakes for the tour's Home preview: a small one north of
 * Urmia and a moderate one near Baneh. Built in memory (no network, nothing
 * stored) with the real `Event` shape so the real `EventCard` draws them, the
 * place line included.
 */
export function buildSampleEvents(now: number): readonly [Event, Event] {
  return [
    sample("tour-sample-1", now, 2, 38.275, 45.187, 3.2, 10, "geofon"),
    sample("tour-sample-2", now, 7, 36.3, 45.9, 4.1, 8, "usgs"),
  ];
}
