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

/**
 * Route-param codec for `EventRegistration`. Raw JSON in an expo-router
 * param does NOT survive the router's own URL serialization — verified live
 * 2026-08-16 on the deployed web build: the JSON's double quotes were
 * stripped in transit ("{ provider : emsc , ...}"), the defensive parse
 * rejected it, and every event-page report silently fell back to the
 * unassigned pool. Base64url over percent-encoded JSON keeps the param in
 * the URL-safe alphabet end to end (percent-encoding first also keeps
 * `btoa`'s Latin-1 limit away from Unicode place names).
 */
export function encodeEventRegistrationParam(reg: EventRegistration): string {
  return btoa(encodeURIComponent(JSON.stringify(reg)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Inverse of {@link encodeEventRegistrationParam}. Defensive: any
 * malformed/legacy value returns null (report proceeds unassigned — the
 * correct D26 fallback), never throws. */
export function decodeEventRegistrationParam(
  raw: string | undefined,
): EventRegistration | null {
  if (!raw) {
    return null;
  }
  try {
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(decodeURIComponent(atob(base64)));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "provider" in parsed &&
      "providerId" in parsed
    ) {
      return parsed as EventRegistration;
    }
    return null;
  } catch {
    return null;
  }
}
