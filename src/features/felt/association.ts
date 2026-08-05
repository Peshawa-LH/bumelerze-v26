import type { Event } from "@/features/events";

/** Home pill's event-association window (spec-v1.md §4.6 wave brief, point
 * 4): "associated to the most recent regional event within the last hour if
 * one exists, else stored unassociated". */
const HOME_ASSOCIATION_WINDOW_MS = 60 * 60_000;

/**
 * Resolves which event (if any) a felt report tapped from the HOME pill
 * should attach to. Event Detail's pill never calls this — it always
 * associates to the event the screen is already showing.
 *
 * Returns `null` when there is no sufficiently-recent regional event; the
 * report is then submitted with `eventId: null` (the migration's `event_id`
 * column is nullable exactly for this case) and a server-side association
 * job attaches it later — this function only ever picks the best *client-side*
 * guess, it never blocks submission on there being a match.
 */
export function resolveHomeFeltAssociation(
  events: readonly Event[],
  now: number = Date.now(),
): string | null {
  let mostRecentRegional: Event | null = null;

  for (const event of events) {
    if (!event.isRegional) {
      continue;
    }
    if (!mostRecentRegional || event.originTime > mostRecentRegional.originTime) {
      mostRecentRegional = event;
    }
  }

  if (!mostRecentRegional) {
    return null;
  }

  const age = now - mostRecentRegional.originTime;
  if (age < 0 || age > HOME_ASSOCIATION_WINDOW_MS) {
    return null;
  }

  return mostRecentRegional.id;
}
