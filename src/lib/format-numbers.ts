/**
 * Locale-aware digit rendering (ui-backlog.md wave 5, item 1 — Peshawa's
 * native-speaker correction of the earlier design-language.md §2 "always
 * Latin digits" call). Sorani (`ckb`) and Iraqi/Gulf Arabic (`ar`) readers
 * expect Eastern Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) everywhere — magnitude,
 * distance, relative time, coordinates, depth, dates/times; Kurmanji
 * (`kmr`) and English (`en`) keep Latin 0-9. Both `ckb` and `ar` share the
 * exact same glyph set here (the Iraqi convention) — there is no separate
 * "Perso-Arabic extended" digit variant in play for this app.
 *
 * Implemented as a hand-rolled character map rather than through
 * `Intl`/ICU numbering-system locale extensions (`-u-nu-arab`) because
 * Hermes' bundled ICU data is inconsistent across build variants
 * (lite vs. full ICU) about honoring numbering-system extensions — a
 * explicit map behaves identically on every device regardless of which
 * ICU data shipped with that Hermes build.
 *
 * This is the ONLY module that decides which digit glyphs render. Every
 * other module that needs a localized numeral (events/format.ts,
 * features/geo) must produce its own plain-ASCII numeral first (decimal
 * point as '.') and then run it through `localizeDigits`/
 * `formatFixedLocalized` here, rather than reimplementing digit choice.
 */
import type { TFunction } from "i18next";

const EASTERN_ARABIC_INDIC_DIGITS = [
  "٠",
  "١",
  "٢",
  "٣",
  "٤",
  "٥",
  "٦",
  "٧",
  "٨",
  "٩",
] as const;

/** Locales that render Eastern Arabic-Indic digits. Every other locale
 * (including any future addition) keeps Latin digits by default. */
const EASTERN_ARABIC_INDIC_LOCALES = new Set<string>(["ckb", "ar"]);

/**
 * Replaces ASCII digit characters (0-9) in `numeral` with the target
 * locale's digit glyphs. The decimal separator ('.') and every other
 * character (minus sign, spaces, unit suffixes, etc.) pass through
 * untouched.
 *
 * Decimal separator note: Bumelerze deliberately keeps '.' as the decimal
 * separator for scientific values (magnitude, km, coordinates) in ALL
 * four locales, rather than switching to each locale's prose numeral
 * convention (e.g. Arabic's decimal comma) — this matches international
 * scientific convention, so a researcher reading in any language sees the
 * same decimal punctuation. Only the digit glyphs themselves localize.
 */
export function localizeDigits(numeral: string, locale: string): string {
  if (!EASTERN_ARABIC_INDIC_LOCALES.has(locale)) {
    return numeral;
  }
  return numeral.replace(
    /[0-9]/g,
    // The regex only ever matches a single ASCII digit character, so
    // `Number(digit)` is always 0-9 and this index always resolves — the
    // `?? digit` fallback exists purely to satisfy
    // `noUncheckedIndexedAccess`, never to change behavior.
    (digit) => EASTERN_ARABIC_INDIC_DIGITS[Number(digit)] ?? digit,
  );
}

/**
 * The reverse direction: any digit glyph this app might be handed, back to
 * ASCII, so a number can be parsed.
 *
 * Output localization and input acceptance are deliberately NOT symmetric.
 * We only ever WRITE Eastern Arabic-Indic digits, but a reader of Sorani or
 * Arabic is typing on their own keyboard, and there was nothing to stop
 * them entering a coordinate or an `Ss` in the numerals they read
 * everywhere else in the app -- where `Number()` returned NaN and the field
 * said "not a number" with no hint as to why. For the primary audience of
 * a Kurdish-first app that is a wall, not a validation message.
 *
 * So input accepts more than output produces: Eastern Arabic-Indic
 * (U+0660-0669), Extended Arabic-Indic (U+06F0-06F9, a Persian keyboard on
 * a Kurdish device), and the Arabic decimal separator U+066B, which maps to
 * the '.' this app uses in every locale. Everything else passes through
 * untouched so genuinely invalid input is still rejected.
 */
export function toAsciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9\u066b]/g, (character) => {
    const code = character.charCodeAt(0);
    if (code === 0x066b) {
      return ".";
    }
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * `value.toFixed(decimals)`, then digit-localized. The single choke point
 * every fixed-decimal scientific numeral (magnitude, distance, depth,
 * coordinates) should be built from.
 */
export function formatFixedLocalized(
  value: number,
  decimals: number,
  locale: string,
): string {
  return localizeDigits(value.toFixed(decimals), locale);
}

/**
 * Whole-number counts with thousands grouping (building/population counts
 * in the risk dashboard — `RiskSection`), then digit-localized. Grouping
 * uses a plain comma in every locale, same "scientific/quantitative values
 * keep international punctuation, only the digit glyphs localize"
 * reasoning this module's own doc comment already applies to the decimal
 * point. Rounds to the nearest whole number first (these are always
 * counts, never fractional).
 */
export function formatIntegerLocalized(value: number, locale: string): string {
  const rounded = Math.round(value);
  const grouped = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const signed = rounded < 0 ? `-${grouped}` : grouped;
  return localizeDigits(signed, locale);
}

/**
 * Rounds `value` to `figures` significant figures — the shared rounding
 * rule `formatApproximate` below builds on. `0` is a special case (no
 * well-defined "significant figure" of zero); every other value keeps its
 * sign.
 */
function roundToSignificantFigures(value: number, figures: number): number {
  if (value === 0) {
    return 0;
  }
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, magnitude - figures + 1);
  return sign * Math.round(Math.abs(value) / factor) * factor;
}

function formatDividedLocalized(divided: number, locale: string): string {
  return Number.isInteger(divided)
    ? formatIntegerLocalized(divided, locale)
    : formatFixedLocalized(divided, 1, locale);
}

/**
 * "About 17 million" / "About 380 thousand" / "About 920" — the risk
 * dashboard's own "never raw digits, always a rounded, plain-language
 * figure" convention (owner: "people understand visuals, not direct
 * numbers; direct numbers are in the Atlas for engineers"). Rounds `value`
 * to 2 significant figures (`roundToSignificantFigures`) and, for anything
 * a thousand or larger, expresses it with a translated unit word
 * (`eventDetail.risk.units.thousand`/`.million`) rather than a long run of
 * digits — the CALLER is responsible for its own "About {{value}}"
 * wrapper (this function returns just the figure + unit, e.g. `"17
 * million"`, not the full sentence), since different call sites wrap it
 * differently (a tile headline vs. a province-row caption vs. an
 * accessibility label).
 */
export function formatApproximate(value: number, locale: string, t: TFunction): string {
  const rounded = roundToSignificantFigures(value, 2);
  const abs = Math.abs(rounded);
  if (abs >= 1_000_000) {
    return t("eventDetail.risk.units.million", {
      count: formatDividedLocalized(rounded / 1_000_000, locale),
    });
  }
  if (abs >= 1_000) {
    return t("eventDetail.risk.units.thousand", {
      count: formatDividedLocalized(rounded / 1_000, locale),
    });
  }
  return formatIntegerLocalized(rounded, locale);
}
