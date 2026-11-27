import type { HiddenEarthquake } from "./transport";

/**
 * The earthquakes Bumelerze hid for everyone (Admin > Hidden earthquakes,
 * migration 0085), ready to look up. Found by id ONLY: every provider id
 * the registry knows for a hidden earthquake, and its Bumelerze id. Never
 * by the merge rule (`isSameEarthquake`): a hidden second card is the same
 * earthquake as the card that stays, so the rule would hide that one too.
 *
 * Applied where the phone shows earthquakes, after `mergeProviderEvents`:
 * Home (list, chosen ones, "Are you safe?", the felt-report pill), possible
 * earthquakes, Significant, World, Map, the "I'm safe" screen; and on the
 * event page and the Event hub, which open the card that stays instead, or
 * say "Earthquake removed".
 */
export interface HiddenIndex {
  readonly size: number;
  readonly byId: ReadonlyMap<string, HiddenEarthquake>;
}

export const NO_HIDDEN: HiddenIndex = { size: 0, byId: new Map() };

/** `list` may be missing: a copy saved by 26.5.0-26.5.1 has no `hidden`. */
export function indexHidden(
  list: readonly HiddenEarthquake[] | null | undefined,
): HiddenIndex {
  if (!list || list.length === 0) {
    return NO_HIDDEN;
  }
  const byId = new Map<string, HiddenEarthquake>();
  for (const entry of list) {
    for (const id of entry.providerIds) {
      byId.set(id, entry);
    }
    if (entry.bumelerzeId) {
      byId.set(entry.bumelerzeId, entry);
    }
  }
  return { size: list.length, byId };
}

/** The hidden earthquake one of `ids` names (a provider id or a Bumelerze
 * id), else null. */
export function findHidden(
  index: HiddenIndex,
  ids: Iterable<string | null | undefined>,
): HiddenEarthquake | null {
  if (index.size === 0) {
    return null;
  }
  for (const id of ids) {
    const entry = id ? index.byId.get(id) : undefined;
    if (entry) {
      return entry;
    }
  }
  return null;
}

/** What an earthquake card carries that can name it. */
export interface HiddenLookupEvent {
  id: string;
  bumelerzeId: string | null;
  provenance: { providerId: string };
}

/** The card's own ids only: a merged card does not carry the ids of the
 * agency copies it absorbed, so the card that stays is never matched. */
export function hiddenEntryForEvent(
  index: HiddenIndex,
  event: HiddenLookupEvent,
): HiddenEarthquake | null {
  return findHidden(index, [event.id, event.provenance.providerId, event.bumelerzeId]);
}

/** `events` without the hidden ones; the same array when nothing is hidden,
 * so memoised lists are not rebuilt. */
export function withoutHidden<T extends HiddenLookupEvent>(
  events: T[],
  index: HiddenIndex,
): T[] {
  if (index.size === 0) {
    return events;
  }
  return events.filter((event) => !hiddenEntryForEvent(index, event));
}

/** A crowd-detected possible earthquake is found by its crowd source id
 * (`crowd-<cell>-<bucket>`); a copy saved before 26.5.2 has none. */
export function withoutHiddenPossible<T extends { providerIds?: readonly string[] }>(
  events: T[],
  index: HiddenIndex,
): T[] {
  if (index.size === 0) {
    return events;
  }
  return events.filter((event) => !findHidden(index, event.providerIds ?? []));
}

/** Where a link to a hidden second card goes: the card that stays, by its
 * Bumelerze id when it has one. Null for a removed earthquake. */
export function keptRouteId(entry: HiddenEarthquake): string | null {
  if (entry.reasonKind !== "duplicate" || !entry.kept) {
    return null;
  }
  return entry.kept.bumelerzeId ?? entry.kept.providerIds[0] ?? null;
}
