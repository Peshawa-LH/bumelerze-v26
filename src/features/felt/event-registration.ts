import type { Event } from "@/features/events";

import type { EventRegistration } from "./types";

/**
 * Pure mapper: `Event` (the client's already-normalized, already-cached feed
 * model) -> `EventRegistration` (the minimal snapshot `SupabaseTransport`
 * sends to `upsert_event_from_client`, migration 0011). Deliberately a
 * standalone pure function — callable from any screen that already has a
 * full `Event` in hand (Event Detail, Home's association lookup) without a
 * new data-fetch or React Query dependency, keeping the "no network call
 * before the durable local queue write" invariant `queue.ts`'s own doc
 * describes.
 */
export function toEventRegistration(event: Event): EventRegistration {
  return {
    provider: event.provenance.provider,
    providerId: event.provenance.providerId,
    originTime: event.originTime,
    lat: event.lat,
    lon: event.lon,
    depthKm: event.depthKm,
    magnitude: event.magnitude.value,
    magType: event.magnitude.type,
    placeName: event.placeName,
  };
}
