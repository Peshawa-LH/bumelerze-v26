import { isSameEarthquake } from "@/features/events/merge";
import type { Event } from "@/features/events/types";
import {
  NOTICE_LANGUAGES,
  type HomeExtras,
  type HomeNotice,
  type NoticeLanguage,
  type NoticeTexts,
} from "./transport";

/** The message Home shows now: not ended (by the phone's clock, so an
 * offline phone also stops) and not hidden by this person. */
export function visibleNotice(
  extras: HomeExtras,
  now: number,
  hiddenId: string | null,
): HomeNotice | null {
  const notice = extras.notice;
  if (!notice || notice.endsAt <= now || notice.id === hiddenId) {
    return null;
  }
  return notice;
}

/** The text for a phone in `language`: its own, else English, else the first
 * one filled in (owner choice 3). */
export function pickNoticeText(
  texts: NoticeTexts,
  language: string,
): { text: string; language: NoticeLanguage } | null {
  const own = NOTICE_LANGUAGES.find((code) => code === language);
  if (own && texts[own]) {
    return { text: texts[own], language: own };
  }
  for (const code of NOTICE_LANGUAGES) {
    const value = texts[code];
    if (value) {
      return { text: value, language: code };
    }
  }
  return null;
}

function matches(feedEvent: Event, pin: HomeExtras["pins"][number]): boolean {
  if (
    pin.providerIds.includes(feedEvent.id) ||
    pin.providerIds.includes(feedEvent.provenance.providerId)
  ) {
    return true;
  }
  if (feedEvent.bumelerzeId && feedEvent.bumelerzeId === pin.event.bumelerzeId) {
    return true;
  }
  return isSameEarthquake(feedEvent, pin.event);
}

/**
 * The earthquakes chosen by Bumelerze, for the top of Home, and the list
 * below without them (never shown twice). A chosen earthquake the phone also
 * has in its own feed (`pool`: region feed plus the notable tail, before the
 * Home policy) is shown as that copy, so it opens like any other card; one
 * the feed does not have (older, smaller, farther away) is drawn from the
 * registry row and opens by its Bumelerze id. Ended ones are left out.
 */
export function applyHomePins(
  pool: readonly Event[],
  shown: readonly Event[],
  extras: HomeExtras,
  now: number,
): { chosen: Event[]; rest: Event[] } {
  const pins = extras.pins.filter((pin) => pin.endsAt > now).slice(0, 3);
  if (pins.length === 0) {
    return { chosen: [], rest: [...shown] };
  }
  const chosen = pins.map(
    (pin) => pool.find((event) => matches(event, pin)) ?? pin.event,
  );
  const chosenIds = new Set(chosen.map((event) => event.id));
  const rest = shown.filter(
    (event) => !chosenIds.has(event.id) && !pins.some((pin) => matches(event, pin)),
  );
  return { chosen, rest };
}
