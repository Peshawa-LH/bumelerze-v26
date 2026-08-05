import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";

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
 * (lite or full) reliably honors — never the final rendering: the caller
 * below still runs the result through `localizeDigits` for `ckb`/`ar`.
 * Two-step approach exists specifically because the wave-5 brief forbids
 * relying on Intl/ICU's own numbering-system locale extension for the
 * *localized* digits (Hermes ICU support for `-u-nu-arab` is inconsistent
 * across build variants), while `Intl` is still perfectly fine for the
 * calendar/date structure itself. */
function withLatinDigits(locale: string): string {
  return `${locale}-u-nu-latn`;
}

/** Dual UTC + local absolute time display (spec-v1.md §4.5 event-detail
 * header requirement). Falls back gracefully if `Intl` doesn't recognize a
 * locale tag (e.g. `ckb`/`kmr` on older ICU data) — `Intl.DateTimeFormat`
 * only throws on a syntactically invalid BCP-47 tag, never on an
 * unrecognized-but-valid one, so this never crashes across our four
 * locales. Digits are localized via our own map (see `withLatinDigits`
 * comment above), not via Intl's numbering-system extension. */
export function formatAbsoluteDual(originTimeMs: number, locale: string): DualTime {
  const date = new Date(originTimeMs);
  const latinLocale = withLatinDigits(locale);

  const utc = new Intl.DateTimeFormat(latinLocale, {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  const local = new Intl.DateTimeFormat(latinLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  return {
    utc: localizeDigits(`${utc} UTC`, locale),
    local: localizeDigits(local, locale),
  };
}
