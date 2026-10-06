import { FE_REGION_TRANSLATIONS } from "./data/fe-region-translations";
import { flinnEngdahlNameEn, flinnEngdahlNumber } from "./fe-region";

/** Locales whose text runs right to left: an English fallback name embedded in
 * them is wrapped in a left-to-right isolate so its punctuation and word order
 * never get reordered by the bidi algorithm. */
const RTL_LOCALES = new Set(["ckb", "ar"]);

const LEFT_TO_RIGHT_ISOLATE = "⁦";
const POP_DIRECTIONAL_ISOLATE = "⁩";

type TranslatedLocale = "ckb" | "kmr" | "ar";

function isTranslatedLocale(locale: string): locale is TranslatedLocale {
  return locale === "ckb" || locale === "kmr" || locale === "ar";
}

/**
 * Name of the Flinn-Engdahl region containing a point, in the reader's
 * language (D28 decision 1): the Bumelerze translation when we have one, else
 * the English F-E name, which is a bounded standard term and never provider
 * prose. `null` only for a coordinate outside the globe (NaN, out of range).
 */
export function flinnEngdahlRegionName(
  lat: number,
  lon: number,
  locale: string,
): string | null {
  const regionNumber = flinnEngdahlNumber(lat, lon);
  if (regionNumber === null) {
    return null;
  }
  if (isTranslatedLocale(locale)) {
    const translated = FE_REGION_TRANSLATIONS[regionNumber]?.[locale];
    if (translated) {
      return translated;
    }
  }
  const english = flinnEngdahlNameEn(regionNumber);
  if (english === null) {
    return null;
  }
  return RTL_LOCALES.has(locale)
    ? `${LEFT_TO_RIGHT_ISOLATE}${english}${POP_DIRECTIONAL_ISOLATE}`
    : english;
}
