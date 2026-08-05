import type { Event } from "./types";

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
 * Magnitude display, one decimal, USGS convention (typescript-react-native
 * rule: "magnitude one decimal with type label... one module owns
 * scientific formatting"). "M" prefix stays untranslated — it is the
 * international scientific symbol, not prose.
 */
export function formatMagnitude(magnitude: Event["magnitude"]): string {
  return `M ${magnitude.value.toFixed(1)}`;
}

/** Distance display, one decimal km (typescript-react-native rule: "distances
 * km (one decimal)"). Kept as a plain numeral+unit string — callers wrap it
 * with `isolateNumeric` when composing a translated sentence around it. */
export function formatDistanceKm(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km`;
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
export function getRelativeTime(
  originTimeMs: number,
  nowMs: number,
): RelativeTimeResult {
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

/** Forces Western/Latin digits regardless of locale (design-language.md §2:
 * "always render Western/Latin digits, never Eastern Arabic-Indic digits" —
 * matters most for `ar`, whose default numbering system in some ICU data is
 * Eastern Arabic-Indic). Appends the `-u-nu-latn` Unicode locale extension,
 * which every `Intl` constructor honors. */
function withLatinDigits(locale: string): string {
  return `${locale}-u-nu-latn`;
}

export interface DualTime {
  utc: string;
  local: string;
}

/** Dual UTC + local absolute time display (spec-v1.md §4.5 event-detail
 * header requirement). Falls back gracefully if `Intl` doesn't recognize a
 * locale tag (e.g. `ckb`/`kmr` on older ICU data) — `Intl.DateTimeFormat`
 * only throws on a syntactically invalid BCP-47 tag, never on an
 * unrecognized-but-valid one, so this never crashes across our four
 * locales. */
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

  return { utc: `${utc} UTC`, local };
}
