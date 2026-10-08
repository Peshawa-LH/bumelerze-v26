import type { TFunction } from "i18next";

import {
  formatClockTime,
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";

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
