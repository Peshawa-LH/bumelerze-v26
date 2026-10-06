import type { GazetteerCityNames } from "./gazetteer";

/**
 * The app's own spelling of Hawler (the city the English-language world calls
 * Erbil; owner, 2026-10-06). Every name the app controls comes from the
 * gazetteer, which already carries it. This exists for the places that show a
 * name straight out of someone else's data — the SHAKEmap atlas and the risk
 * export label governorates, districts and cities in English ("Erbil",
 * "Markaz Erbil") — so a regeneration of that data cannot bring the old
 * spelling back to the screen. Only the English form is rewritten; names that
 * are already Kurdish or Arabic pass through untouched.
 *
 * Display only: place ids ("erbil", "IQG11") are never touched.
 */
const ENGLISH_FORM = /\bErbil\b/g;

const REPLACEMENT_BY_LOCALE: Record<keyof GazetteerCityNames, string> = {
  en: "Hawler",
  kmr: "Hewlêr",
  ckb: "هەولێر",
  ar: "أربيل",
};

export function displayPlaceName(name: string, locale: string): string {
  const replacement =
    REPLACEMENT_BY_LOCALE[locale as keyof GazetteerCityNames] ?? REPLACEMENT_BY_LOCALE.en;
  return name.replace(ENGLISH_FORM, replacement);
}
