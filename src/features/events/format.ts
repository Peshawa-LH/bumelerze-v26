import type { TFunction } from "i18next";

import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";

/** react-i18next's own `t` type — see `@/features/geo/place-line.ts`'s
 * identical `TranslateFn` alias doc comment for why this is imported
 * directly from `i18next` rather than re-exported from `features/geo`
 * (would create a require-cycle: `geo/place-line.ts` already imports this
 * concrete file for `formatIsolatedDistance`). */
type TranslateFn = TFunction;

/**
 * Unicode directional isolate (design-language.md §5 "bidi handling"):
 * wraps a numeral+unit chunk (e.g. "120.0 km") so the bidi algorithm never
 * reorders its digits or misattaches the unit when it sits inside a
 * right-to-left sentence. Use this on every numeric string interpolated
 * into a translated template — never on a whole translated sentence.
 */
const LEFT_TO_RIGHT_ISOLATE = "⁦";
const POP_DIRECTIONAL_ISOLATE = "⁩";

export function isolateNumeric(text: string): string {
  return `${LEFT_TO_RIGHT_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * Magnitude numeral only, one decimal, digit-localized (ui-backlog.md wave
 * 5 item 1 — every numeral localizes, magnitude included; this reverses
 * design-language.md §3.2's earlier "always Latin" call for magnitude,
 * per Peshawa's direct native-speaker review). Split out from
 * `formatMagnitude` so the accessibility label (which shouldn't repeat the
 * "M" prefix — the label already says "Magnitude ...") can reuse the bare
 * numeral.
 */
export function formatMagnitudeValue(value: number, locale: string): string {
  return formatFixedLocalized(value, 1, locale);
}

// NOTE (2026-08-06, Peshawa's native-speaker correction): the magnitude
// PREFIX is prose, not a universal symbol — "M" reads as nothing to a
// Sorani reader. The display string is therefore an i18n template
// (`events.magnitudeDisplay`: en "M {{value}}", ckb "{{value}} پلە", …)
// composed by callers with `formatMagnitudeValue`, exactly like the km
// unit (ui-backlog wave 5 item 2). "پلە" chosen over "ڕێختەر" for
// scientific correctness (modern magnitudes are Mw, not Richter); when
// intensity ships it gets a visually distinct label + Roman numerals so
// the two "پلە"-like scales can't be confused (D7 education goal).
// The old `formatMagnitude` (hardcoded "M" prefix) was removed with it.

/**
 * Distance numeral only, one decimal, digit-localized km (typescript-
 * react-native rule: "distances km (one decimal)"). Deliberately returns
 * just the numeral, no unit text — "km" is a localized string (ui-backlog
 * wave 5 item 2: "کم"/"كم"/"km") that lives in the i18n catalogs
 * (`units.km`), not in this scientific-formatting module. Callers compose
 * `${formatDistanceKm(...)} ${t("units.km")}` and wrap the whole chunk
 * with `isolateNumeric` before interpolating it into a translated
 * sentence — see EventCard/event/[id].tsx/features/geo/place-line.ts.
 */
export function formatDistanceKm(distanceKm: number, locale: string): string {
  return formatFixedLocalized(distanceKm, 1, locale);
}

/**
 * Distance numeral + localized unit, isolated as one chunk for safe
 * embedding inside a translated RTL sentence (see `isolateNumeric`'s doc
 * comment). The single place every "{{distance}}" interpolation value
 * across the app (feed-card place line, event-detail nearest-cities list,
 * event-detail "from you" line) should be built from, so the
 * numeral-format + unit-compose + bidi-isolate sequence exists in exactly
 * one spot.
 */
export function formatIsolatedDistance(
  distanceKm: number,
  locale: string,
  unitLabel: string,
): string {
  return isolateNumeric(`${formatDistanceKm(distanceKm, locale)} ${unitLabel}`);
}

/** Depth numeral only, one decimal, digit-localized km — same
 * numeral-only/unit-via-i18n split as `formatDistanceKm` above. */
export function formatDepthKm(depthKm: number, locale: string): string {
  return formatFixedLocalized(depthKm, 1, locale);
}

/** Lat/lon pair, three decimals, digit-localized. The comma separator is
 * plain punctuation, not a numeral, so it's never localized. */
export function formatCoordinates(lat: number, lon: number, locale: string): string {
  return `${formatFixedLocalized(lat, 3, locale)}, ${formatFixedLocalized(lon, 3, locale)}`;
}

export type RelativeTimeUnit = "justNow" | "minutes" | "hours" | "days";

export interface RelativeTimeResult {
  unit: RelativeTimeUnit;
  /** Unit count; always 0 for "justNow" (i18n key takes no count there). */
  value: number;
}

/**
 * Relative age of an event, clamped so it can never read as negative/
 * future ("Rasathane bug lesson", wave brief) — a client clock a few
 * seconds behind the event's origin time (or a just-published event) must
 * never render "in -3 seconds" or similar nonsense; it floors to "just now".
 */
export function getRelativeTime(originTimeMs: number, nowMs: number): RelativeTimeResult {
  const diffMs = Math.max(0, nowMs - originTimeMs);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return { unit: "justNow", value: 0 };
  }
  if (diffMinutes < 60) {
    return { unit: "minutes", value: diffMinutes };
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return { unit: "hours", value: diffHours };
  }

  const diffDays = Math.floor(diffHours / 24);
  return { unit: "days", value: diffDays };
}

/** Localizes the integer count embedded in a relative-time phrase (the "5"
 * in "5m ago"). Deliberately passed to i18next as a pre-formatted string
 * under a plain `{{value}}` placeholder rather than i18next's own `count`
 * interpolation (which some versions back with `Intl.NumberFormat`) — this
 * keeps digit choice entirely inside our own explicit map, never delegated
 * to whatever ICU data happens to ship with a given Hermes build. */
export function formatRelativeTimeValue(value: number, locale: string): string {
  return localizeDigits(String(value), locale);
}

export interface DualTime {
  utc: string;
  local: string;
}

/** Forces Western/Latin digits out of `Intl.DateTimeFormat` regardless of
 * locale, via the `-u-nu-latn` Unicode locale extension. This is only a
 * baseline — Latin digits are the one numbering system every ICU build
 * (lite or full) reliably honors — never the final rendering: callers below
 * still run the result through `localizeDigits` for `ckb`/`ar`.
 * Two-step approach exists specifically because the wave-5 brief forbids
 * relying on Intl/ICU's own numbering-system locale extension for the
 * *localized* digits (Hermes ICU support for `-u-nu-arab` is inconsistent
 * across build variants), while `Intl` is still perfectly fine for the
 * calendar/date structure itself. */
function withLatinDigits(locale: string): string {
  return `${locale}-u-nu-latn`;
}

/** Builds `Intl.DateTimeFormatOptions` with an optional IANA time zone,
 * never assigning `timeZone: undefined` explicitly (the project's
 * `exactOptionalPropertyTypes: true` tsconfig setting forbids that) —
 * `undefined` means "use the device's local zone", same as omitting the key
 * entirely. */
function dateTimeOptions(
  timeZone: string | undefined,
  extra: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  return timeZone === undefined ? extra : { ...extra, timeZone };
}

/** Day/month/year as plain numbers, read via `Intl.DateTimeFormat` so the
 * given time zone (UTC vs. device-local) is respected without doing
 * calendar math by hand — `formatToParts` is used (not the combined
 * `dateStyle` string) specifically so the month renders as a bare number:
 * this module never asks `Intl` for a month NAME, because Hermes/ICU has no
 * real Sorani/Kurmanji month-name data and silently falls back to English
 * (ui-backlog.md item 6 — the bug this whole rewrite exists to fix). The
 * month index is looked up in this app's own `months.short.<n>` i18n table
 * instead (see `formatAbsoluteOne`), the same "own explicit map, never
 * delegated to whatever ICU data shipped" policy `lib/format-numbers.ts`
 * already uses for digits. */
function dateComponents(
  date: Date,
  timeZone: string | undefined,
  locale: string,
): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat(
    withLatinDigits(locale),
    dateTimeOptions(timeZone, { day: "numeric", month: "numeric", year: "numeric" }),
  ).formatToParts(date);

  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;

  // `formatToParts` always includes day/month/year when all three were
  // requested — the `?? "1"`/`?? "1970"` fallbacks exist only to satisfy
  // strict typing, never expected to trigger in practice.
  return {
    day: Number(day ?? "1"),
    month: Number(month ?? "1"),
    year: Number(year ?? "1970"),
  };
}

/** Hour:minute only, locale-appropriate 12h/24h convention (unchanged from
 * this module's pre-rewrite behavior) — the one piece of `Intl`'s own
 * locale-aware formatting this module keeps relying on, since clock-format
 * convention (not month names) isn't the localization gap ui-backlog item 6
 * is about. */
function timeOfDay(date: Date, timeZone: string | undefined, locale: string): string {
  return new Intl.DateTimeFormat(
    withLatinDigits(locale),
    dateTimeOptions(timeZone, { timeStyle: "short" }),
  ).format(date);
}

/** One locale-templated absolute date+time string (day/month/year/time
 * composed via the `events.dateTemplate` i18n key so each locale can order
 * the pieces naturally — Sorani/Arabic day-month-year with their own
 * connective punctuation, English month-day-year) — the shared building
 * block both `utc` and `local` in `formatAbsoluteDual` are built from. */
function formatAbsoluteOne(
  date: Date,
  timeZone: string | undefined,
  locale: string,
  t: TranslateFn,
): string {
  const { day, month, year } = dateComponents(date, timeZone, locale);

  return t("events.dateTemplate", {
    day: localizeDigits(String(day), locale),
    month: t(`months.short.${month}`),
    year: localizeDigits(String(year), locale),
    time: localizeDigits(timeOfDay(date, timeZone, locale), locale),
  });
}

/** Dual UTC + local absolute time display (spec-v1.md §4.5 event-detail
 * header requirement). Falls back gracefully if `Intl` doesn't recognize a
 * locale tag (e.g. `ckb`/`kmr` on older ICU data) — `Intl.DateTimeFormat`
 * only throws on a syntactically invalid BCP-47 tag, never on an
 * unrecognized-but-valid one, so this never crashes across our four
 * locales. Digits are localized via our own map (see `withLatinDigits`
 * comment above); month names via this app's own `months.short.<n>` i18n
 * table (see `dateComponents`' comment) — never via `Intl`'s month-name
 * data or the digit-localizer (ui-backlog.md item 6: the old
 * implementation ran the *whole* `Intl`-produced string, English month
 * abbreviation included, through the digit localizer, which only ever
 * touches digit characters — hence "Aug ٣:١٢ ,٢٠٢٦", an English month
 * glued to Kurdish digits). `t` is the caller's `useTranslation()` `t`
 * function — every call site already has one in scope. */
export function formatAbsoluteDual(
  originTimeMs: number,
  locale: string,
  t: TranslateFn,
): DualTime {
  const date = new Date(originTimeMs);

  const local = formatAbsoluteOne(date, undefined, locale, t);
  const utc = `${formatAbsoluteOne(date, "UTC", locale, t)} UTC`;

  return { utc, local };
}
