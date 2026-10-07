import type { TranslateFn } from "@/features/geo";
import { placeLine } from "@/features/geo";
import { formatAbsoluteDual, formatMagnitudeValue } from "@/features/events/format";
import type { Event } from "@/features/events/types";
import { isRTLLocale } from "@/i18n";

import {
  LEFT_TO_RIGHT_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
  SHARE_EVENT_URL_BASE,
} from "./config";

/**
 * The public link for one event. `eventId` is the Bumelerze `bml` id whenever
 * one is known; a provider id also works (the route resolves it and redirects
 * to the `bml` id), so a feed event we have not registered yet still shares.
 */
export function buildShareUrl(eventId: string): string {
  return `${SHARE_EVENT_URL_BASE}/${encodeURIComponent(eventId)}`;
}

/**
 * The link wrapped in a left-to-right isolate, for use inside a right-to-left
 * sentence: without it the bidi algorithm can pull the `/` and `:` of the URL
 * to the wrong side of the surrounding Arabic-script words. Left-to-right
 * captions need no wrapper, so they carry the bare URL (keeps autolinking
 * simple in messengers that dislike invisible characters).
 */
export function isolateUrlForLocale(url: string, locale: string): string {
  return isRTLLocale(locale)
    ? `${LEFT_TO_RIGHT_ISOLATE}${url}${POP_DIRECTIONAL_ISOLATE}`
    : url;
}

/** Directional isolates: invisible, and only useful inside a right-to-left sentence. */
const ISOLATE_MARKS = /[\u2066-\u2069]/g;

export interface ShareCaptionInput {
  event: Pick<Event, "originTime" | "lat" | "lon" | "magnitude">;
  /** Id for the link: the `bml` id when known, else the event's own id. */
  shareId: string;
  locale: string;
  t: TranslateFn;
}

/**
 * The automatic caption (owner note N14): one short line with the magnitude,
 * our own place line (the same rule as every screen), the local date and time
 * in the reader's locale, the event link and a hashtag. Editable before it is
 * shared.
 */
export function buildShareCaption({
  event,
  shareId,
  locale,
  t,
}: ShareCaptionInput): string {
  const rtl = isRTLLocale(locale);
  const composed = t("share.caption.line", {
    magnitude: formatMagnitudeValue(event.magnitude.value, locale),
    place: placeLine(event, locale, t),
    time: formatAbsoluteDual(event.originTime, locale, t).local,
  });
  // The place line guards its numerals with isolates for right-to-left text;
  // in a left-to-right caption they would only be invisible clutter in the
  // pasted message.
  const line = rtl ? composed : composed.replace(ISOLATE_MARKS, "");
  const url = isolateUrlForLocale(buildShareUrl(shareId), locale);
  return `${line} · ${url} ${t("share.caption.hashtag")}`;
}

/**
 * The text a "share link" action sends. The caption already carries the link;
 * if the user deleted it while editing, put it back, because sharing the link
 * is the point of this action.
 */
export function ensureLinkInText(text: string, url: string): string {
  const trimmed = text.trim();
  if (trimmed.includes(url)) {
    return trimmed;
  }
  return trimmed === "" ? url : `${trimmed}\n${url}`;
}
