import type { TFunction } from "i18next";

import {
  formatClockTime,
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";

/** "2:21 PM", isolated so it never flips inside Sorani/Arabic text. */
export function clockText(t: TFunction, locale: string, timeMs: number): string {
  return isolateNumeric(formatClockTime(timeMs, locale, t));
}

/** "2h ago" with the app's own digits. */
export function agoText(
  t: TFunction,
  locale: string,
  timeMs: number,
  now: number,
): string {
  const relative = getRelativeTime(timeMs, now);
  return relative.unit === "justNow"
    ? t("events.relativeTime.justNow")
    : t(`events.relativeTime.${relative.unit}`, {
        value: formatRelativeTimeValue(relative.value, locale),
      });
}

/** "After the earthquake M 5.1 at 2:21 PM". No place: the check-in is about
 * an earthquake and a time. */
export function eventLineText(
  t: TFunction,
  locale: string,
  magnitude: number,
  originTime: number,
): string {
  return t("imSafe.eventLine", {
    magnitude: t("events.magnitudeDisplay", {
      value: isolateNumeric(formatMagnitudeValue(magnitude, locale)),
    }),
    time: clockText(t, locale, originTime),
  });
}

/** Who a check-in reaches, as words (review note 3.3): "Your family and 3 of
 * your mutual follows". `follows` counts mutual follows or all followers,
 * depending on the person's choice. Null when nobody would be told. Counts
 * are written "N of your ..." so one word form fits 1 and many. */
export function reachWho(
  t: TFunction,
  locale: string,
  counts: { family: number; follows: number },
  audience: "family" | "mutual" | "followers",
): string | null {
  const family = counts.family > 0;
  const follows = audience === "family" ? 0 : counts.follows;
  const count = localizeDigits(String(follows), locale);
  const kind = audience === "followers" ? "Followers" : "Mutual";
  if (family && follows > 0) return t(`imSafe.who.family${kind}`, { count });
  if (family) return t("imSafe.who.family");
  if (follows > 0) return t(`imSafe.who.${kind.toLowerCase()}`, { count });
  return null;
}
