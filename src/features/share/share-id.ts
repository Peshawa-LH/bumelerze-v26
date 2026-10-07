import type { Event } from "@/features/events";

/**
 * The id a shared link carries: the Bumelerze (`bml`) id whenever one is
 * known, from the event itself or from the route it was opened with, else the
 * event's own id. The event route accepts either and redirects a provider id
 * to the `bml` one, so a feed event we have not registered still shares.
 */
export function shareIdFor(
  event: Pick<Event, "id" | "bumelerzeId">,
  knownBumelerzeId: string | null | undefined,
): string {
  return event.bumelerzeId ?? knownBumelerzeId ?? event.id;
}
