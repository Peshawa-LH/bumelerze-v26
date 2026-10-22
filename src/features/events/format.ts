import type { TFunction } from "i18next";

import {
  formatFixedLocalized,
  localizeDigits,
  toAsciiDigits,
} from "@/lib/format-numbers";

/** react-i18next's own `t` type — see `@/features/geo/place-line.ts`'s
 * identical `TranslateFn` alias doc comment for why this is imported
 * directly from `i18next` rather than re-exported from `features/geo`
 * (would create a require-cycle: `geo/place-line.ts` already imports this
 * concrete file for `formatIsolatedDistance`). */
type TranslateFn = TFunction;

/**
 * Unicode directional isolate (the design language §5 "bidi handling"):
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

const FIRST_STRONG_ISOLATE = "\u2068";

/**
 * First-strong isolate (U+2068 ... U+2069) for a LOCALIZED date or time
 * ("١٢ی تشرینی دووەمی ٢٠١٧، ٦:١٨ دوای نیوەڕۆ", "6:18 PM") interpolated into
 * a sentence: the chunk takes the direction of its own first letter.
 * `isolateNumeric` forces it left to right. For a date written wholly in
 * Sorani or Arabic script both render the same (the bidi algorithm still
 * orders its letters right to left), but a Latin run inside it then lands
 * at the wrong end: "کات: UTC ١٢ی تشرینی..." instead of "... دوای نیوەڕۆ UTC"
 * (checked in Chromium, 2026-10-21). A chunk with no letter at all (digits
 * and separators only) is isolated left to right, exactly as
 * `isolateNumeric` does it, so its digits never flip.
 */
export function isolateLocalizedTime(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * First-strong isolate for a value cell that is either a number or a short
 * phrase: "99%", "٩٩٪", "%<1", or the words Sorani and Arabic use for less
 * than one percent ("کەمتر لە ١٪", "أقل من ١٪"). `isolateNumeric` forced
 * the phrases left to right, which drew the ٪ at the wrong end
 * ("٪کەمتر لە ١"); a first-strong isolate lets a phrase keep the direction
 * of its first letter, while digits and signs alone (no letter) still run
 * left to right, exactly as `isolateNumeric` sets them.
 */
export function isolateValue(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * Magnitude numeral only, one decimal, digit-localized (the UI backlog wave
 * 5 item 1 — every numeral localizes, magnitude included; this reverses
 * the design language §3.2's earlier "always Latin" call for magnitude,
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
// unit (the UI backlog wave 5 item 2). "پلە" chosen over "ڕێختەر" for
// scientific correctness (modern magnitudes are Mw, not Richter); when
// intensity ships it gets a visually distinct label + its own numerals
// (`formatIntensity`: Roman in en/kmr, digits in ckb/ar) so
// the two "پلە"-like scales can't be confused (D7 education goal).
// The old `formatMagnitude` (hardcoded "M" prefix) was removed with it.

/**
 * Distance numeral only, one decimal, digit-localized km (the project's
 * TypeScript rule: "distances km (one decimal)"). Deliberately returns
 * just the numeral, no unit text — "km" is a localized string (the UI backlog
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
  return isolateNumeric(`${formatEventDistanceKm(distanceKm, locale)} ${unitLabel}`);
}

/**
 * Distance numeral for EVENT surfaces (place lines, nearest-city list, "from
 * you"): one rule everywhere (F6) — whole kilometres from 10 km up, one
 * decimal below it. A decimal on "142.3 km" claims a precision the location
 * does not have, and the same event used to read "30.7 km" in one list and
 * "55 km" in another. The threshold is tested on the ROUNDED value, so 9.96
 * reads "10", never "10.0". Engineering/handbook distances keep the plain
 * one-decimal `formatDistanceKm`.
 */
export function formatEventDistanceKm(distanceKm: number, locale: string): string {
  const rounded = Math.round(distanceKm * 10) / 10;
  return formatFixedLocalized(distanceKm, rounded >= 10 ? 0 : 1, locale);
}

/** Depth numeral only, one decimal, digit-localized km — same
 * numeral-only/unit-via-i18n split as `formatDistanceKm` above. */
export function formatDepthKm(depthKm: number, locale: string): string {
  return formatFixedLocalized(depthKm, 1, locale);
}

/** Lat/lon pair, three decimals, digit-localized. The comma separator is
 * plain punctuation, not a numeral, so it's never localized. The whole pair
 * is one left-to-right isolate: a coordinate pair is a notation, read
 * "latitude, longitude" in every script, and under an RTL paragraph the
 * bidi algorithm otherwise swaps the two numbers around the comma
 * ("٤٥.٩٥٩ ,٣٤.٩١١" — A-7). */
export function formatCoordinates(lat: number, lon: number, locale: string): string {
  return isolateNumeric(
    `${formatFixedLocalized(lat, 3, locale)}, ${formatFixedLocalized(lon, 3, locale)}`,
  );
}

export type RelativeTimeUnit = "justNow" | "minutes" | "hours" | "days";

export interface RelativeTimeResult {
  unit: RelativeTimeUnit;
  /** Unit count; always 0 for "justNow" (i18n key takes no count there). */
  value: number;
}

/**
 * Relative age of an event, clamped so it can never read as negative/
 * future ("Rasathane bug lesson", brief) — a client clock a few
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

/** Calendar and clock fields of one moment, as plain numbers. */
interface ZonedFields {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour24: number;
  minute: number;
}

/**
 * The calendar date and clock time of `date` in `timeZone`, read WITHOUT
 * any locale: the device's own zone (`undefined`) and UTC come straight
 * from `Date`'s getters, which every engine implements the same way.
 *
 * Never from `Intl` with the reader's locale. Hermes on iOS ignores the
 * `-u-nu-latn` extension and answers in the locale's own digits ("٢٠" for
 * Sorani), and it resolves Kurmanji, which it has no data for, to the
 * PHONE's language: on a Sorani phone `Number("٢٠")` gave NaN and every
 * event date read "NaN months.short.NaN" in Sorani and Kurmanji (seen on
 * the iOS Simulator, 2026-10-20). Browsers and Node honour the extension,
 * so the web and the tests never showed it. Any other IANA zone goes
 * through `Intl` with the fixed `en-US` locale, and its digits are folded
 * back to ASCII whatever the engine returns.
 */
function zonedFields(date: Date, timeZone: string | undefined): ZonedFields {
  if (timeZone === undefined) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour24: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  if (timeZone === "UTC" || timeZone === "Etc/UTC") {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour24: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(toAsciiDigits(parts.find((part) => part.type === type)?.value ?? ""));
  const fields: ZonedFields = {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some engines write midnight as "24" under h23.
    hour24: read("hour") % 24,
    minute: read("minute"),
  };
  // An engine that still answered with something unreadable: the UTC
  // reading is a real date, NaN never is.
  return Object.values(fields).every(Number.isFinite) ? fields : zonedFields(date, "UTC");
}

/** Hour:minute + a translated AM/PM-equivalent token (D22 "Kurdish
 * AM/PM": ckb MUST read پێش نیوەڕۆ/دوای نیوەڕۆ — before/after noon, owner
 * 2026-10-08, replacing ڕۆژانە/شەوانە "by day/at night" — never Latin "AM"/"PM"). Deliberately
 * does NOT read `Intl`'s own `dayPeriod` formatToParts value — Hermes/ICU
 * has no real Sorani/Kurmanji data for month names or day periods
 * (confirmed for dayPeriod too:
 * a device build without the real translation silently falls back to
 * Latin "AM"/"PM", which is exactly the bug this function exists to
 * prevent). Instead, the AM/PM CLASSIFICATION is derived purely from the
 * locale-independent 24-hour value (`zonedFields`) and the display
 * text comes entirely from this app's own `time.am`/`time.pm` i18n keys —
 * the same "own explicit map, never delegated to whatever ICU data shipped"
 * policy this module already applies to digits and month names. The
 * `time.template` key controls token order/spacing per locale (kept in the
 * catalog, not hardcoded here, even though every current locale happens to
 * order it the same way: time chunk first, period token after). */
function formatTimeOfDay(
  date: Date,
  timeZone: string | undefined,
  locale: string,
  t: TranslateFn,
): string {
  const { hour24, minute } = zonedFields(date, timeZone);
  const period: "am" | "pm" = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minuteStr = String(minute).padStart(2, "0");

  return t("events.timeTemplate", {
    time: localizeDigits(`${hour12}:${minuteStr}`, locale),
    period: t(`time.${period}`),
  });
}

/** Device-local clock time only ("2:21 PM"; Sorani before/after noon), with
 * the same digit and day-period rules as `formatAbsoluteDual`. For short
 * statements about a moment the reader saw today (the "I'm safe" check-in).
 * Callers wrap it with `isolateNumeric` inside RTL sentences. */
export function formatClockTime(timeMs: number, locale: string, t: TranslateFn): string {
  return formatTimeOfDay(new Date(timeMs), undefined, locale, t);
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
  const { day, month, year } = zonedFields(date, timeZone);

  return t("events.dateTemplate", {
    day: localizeDigits(String(day), locale),
    month: t(`months.short.${month}`),
    year: localizeDigits(String(year), locale),
    time: formatTimeOfDay(date, timeZone, locale, t),
  });
}

/**
 * Date-only (no time-of-day) localized display — day/month/year composed
 * via the `events.dateOnlyTemplate` i18n key, the same per-locale ordering
 * `formatAbsoluteOne` uses minus the time chunk. Exists for UI that shows a
 * DATE RANGE rather than a single moment (the Map tab's date-range filter,
 * `MapFilterPanel`) — appending a time-of-day to every slider-handle label
 * there would be noise the control doesn't need, and reusing
 * `formatAbsoluteDual`'s dual UTC+local shape would be actively wrong for a
 * plain calendar-date bound.
 */
export function formatDateOnly(
  originTimeMs: number,
  locale: string,
  t: TranslateFn,
  /** IANA zone; omitted = the device's local zone (the map filter). The
   * catalogue passes "UTC": its archival records have no meaningful local
   * zone, so the one unambiguous calendar date is the UTC one. */
  timeZone?: string,
): string {
  const { day, month, year } = zonedFields(new Date(originTimeMs), timeZone);

  return t("events.dateOnlyTemplate", {
    day: localizeDigits(String(day), locale),
    month: t(`months.short.${month}`),
    year: localizeDigits(String(year), locale),
  });
}

/** Dual UTC + local absolute time display (the v1 spec §4.5 event-detail
 * header requirement). The numbers come from `zonedFields` (no locale
 * involved, so no engine's locale data can break them); digits are
 * localized via our own map; month names via this app's own
 * `months.short.<n>` i18n table — never via `Intl`'s month-name
 * data or the digit-localizer (the UI backlog item 6: the old
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
