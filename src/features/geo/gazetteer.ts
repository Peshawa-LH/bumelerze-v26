/**
 * Bundled place gazetteer (ui-backlog.md wave 5, item 3). Supersedes both
 * the old `events/config.ts` `REGION_ANCHORS` (3 cities, removed wave 5)
 * and is now the single source of truth `features/onboarding/towns.ts`
 * draws its HomeBase picker subset from — PROJECT.md gotcha: normalize once,
 * never scatter a second town/city dataset through the app.
 *
 * DRAFT-MACHINE DATA: coordinates are approximate town centroids (good
 * enough for nearest-city/direction math, not surveyed points); Kurdish
 * (Sorani/Kurmanji) and Arabic name spellings are a best-effort machine
 * draft pending Peshawa's native-speaker review, same "draft-machine"
 * status convention as the i18n catalogs (see `_status` in
 * `src/i18n/locales/*.json`) — do not treat these names as final until
 * that review closes (PROJECT.md D14 checkpoint).
 *
 * `inKurdistanRegion` marks KRG-administered governorates (Erbil,
 * Sulaymaniyah incl. Halabja/Garmian, Duhok) as `true`. Contested/disputed
 * territories that are Kurdish-populated but federally administered
 * (Kirkuk, Khanaqin, Kifri, Sinjar, Mosul) are marked `false` — a
 * deliberately conservative administrative call, not a political one, and
 * explicitly flagged here for Peshawa to correct if he judges otherwise.
 */

export type GazetteerCountry = "IQ" | "IR" | "TR" | "SY";

export interface GazetteerCityNames {
  en: string;
  ckb: string;
  kmr: string;
  ar: string;
}

export interface GazetteerCity {
  id: string;
  names: GazetteerCityNames;
  lat: number;
  lon: number;
  country: GazetteerCountry;
  /** True for cities inside the KRG-administered governorates. See the
   * module doc comment above for the disputed-territory convention. */
  inKurdistanRegion: boolean;
}

export const GAZETTEER_CITIES: readonly GazetteerCity[] = [
  // --- Iraq / Kurdistan Region (KRG-administered) ---
  {
    id: "erbil",
    names: { en: "Erbil", ckb: "هەولێر", kmr: "Hewlêr", ar: "أربيل" },
    lat: 36.19,
    lon: 44.01,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "slemani",
    names: { en: "Slemani", ckb: "سلێمانی", kmr: "Silêmanî", ar: "السليمانية" },
    lat: 35.56,
    lon: 45.43,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "duhok",
    names: { en: "Duhok", ckb: "دهۆک", kmr: "Dihok", ar: "دهوك" },
    lat: 36.87,
    lon: 42.99,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "halabja",
    names: { en: "Halabja", ckb: "هەڵەبجە", kmr: "Helebce", ar: "حلبجة" },
    lat: 35.18,
    lon: 45.98,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "zakho",
    names: { en: "Zakho", ckb: "زاخۆ", kmr: "Zaxo", ar: "زاخو" },
    lat: 37.14,
    lon: 42.68,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "soran",
    names: { en: "Soran", ckb: "سۆران", kmr: "Soran", ar: "سوران" },
    lat: 36.65,
    lon: 44.54,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "ranya",
    names: { en: "Ranya", ckb: "ڕانیە", kmr: "Ranya", ar: "رانية" },
    lat: 36.25,
    lon: 44.89,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "koya",
    names: { en: "Koya", ckb: "کۆیە", kmr: "Koya", ar: "كوية" },
    lat: 36.08,
    lon: 44.63,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "kalar",
    names: { en: "Kalar", ckb: "کەلار", kmr: "Kelar", ar: "كلار" },
    lat: 34.62,
    lon: 45.32,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "chamchamal",
    names: { en: "Chamchamal", ckb: "چەمچەماڵ", kmr: "Çemçemal", ar: "جمجمال" },
    lat: 35.53,
    lon: 44.83,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "akre",
    names: { en: "Akre", ckb: "ئاکرێ", kmr: "Akrê", ar: "عقرة" },
    lat: 36.75,
    lon: 43.89,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "bardarash",
    names: { en: "Bardarash", ckb: "بەردەرەش", kmr: "Berdereş", ar: "بردرش" },
    lat: 36.5,
    lon: 43.55,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "dukan",
    names: { en: "Dukan", ckb: "دووکان", kmr: "Dukan", ar: "دوكان" },
    lat: 35.95,
    lon: 44.95,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "darbandikhan",
    names: {
      en: "Darbandikhan",
      ckb: "دەربەندیخان",
      kmr: "Derbendîxan",
      ar: "دربنديخان",
    },
    lat: 35.13,
    lon: 45.72,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "penjwen",
    names: { en: "Penjwen", ckb: "پەنجوێن", kmr: "Pencwîn", ar: "بنجوين" },
    lat: 35.62,
    lon: 46.2,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "qaladze",
    names: { en: "Qaladze", ckb: "قەڵادزێ", kmr: "Qeladizê", ar: "قلادزة" },
    lat: 36.18,
    lon: 45.13,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "rawanduz",
    names: { en: "Rawanduz", ckb: "ڕەواندز", kmr: "Rewandiz", ar: "راوندوز" },
    lat: 36.61,
    lon: 44.52,
    country: "IQ",
    inKurdistanRegion: true,
  },
  {
    id: "amedi",
    names: { en: "Amedi", ckb: "ئامێدی", kmr: "Amêdî", ar: "العمادية" },
    lat: 37.09,
    lon: 43.49,
    country: "IQ",
    inKurdistanRegion: true,
  },
  // --- Iraq, disputed territory / federally administered ---
  {
    id: "kirkuk",
    names: { en: "Kirkuk", ckb: "کەرکووک", kmr: "Kerkûk", ar: "كركوك" },
    lat: 35.47,
    lon: 44.39,
    country: "IQ",
    inKurdistanRegion: false,
  },
  {
    id: "khanaqin",
    names: { en: "Khanaqin", ckb: "خانەقین", kmr: "Xaneqîn", ar: "خانقين" },
    lat: 34.36,
    lon: 45.39,
    country: "IQ",
    inKurdistanRegion: false,
  },
  {
    id: "kifri",
    names: { en: "Kifri", ckb: "کفری", kmr: "Kifrî", ar: "كفري" },
    lat: 34.7,
    lon: 44.97,
    country: "IQ",
    inKurdistanRegion: false,
  },
  {
    id: "sinjar",
    names: { en: "Sinjar", ckb: "شنگال", kmr: "Şengal", ar: "سنجار" },
    lat: 36.32,
    lon: 41.88,
    country: "IQ",
    inKurdistanRegion: false,
  },
  // --- Iraq, non-Kurdish-region reference cities ---
  {
    id: "mosul",
    names: { en: "Mosul", ckb: "موسڵ", kmr: "Mûsil", ar: "الموصل" },
    lat: 36.34,
    lon: 43.13,
    country: "IQ",
    inKurdistanRegion: false,
  },
  {
    id: "baghdad",
    names: { en: "Baghdad", ckb: "بەغدا", kmr: "Bexda", ar: "بغداد" },
    lat: 33.31,
    lon: 44.36,
    country: "IQ",
    inKurdistanRegion: false,
  },
  // --- Iran (Rojhelat / border region) ---
  {
    id: "javanrud",
    names: { en: "Javanrud", ckb: "جوانڕۆ", kmr: "Cewanro", ar: "جوانرود" },
    lat: 34.8,
    lon: 46.49,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "kermanshah",
    names: { en: "Kermanshah", ckb: "کرماشان", kmr: "Kirmaşan", ar: "كرمانشاه" },
    lat: 34.31,
    lon: 47.06,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "sarpol-e-zahab",
    names: {
      en: "Sarpol-e Zahab",
      ckb: "سەرپێڵزەهاو",
      kmr: "Serpêlê Zehab",
      ar: "سرپل ذهاب",
    },
    lat: 34.46,
    lon: 45.86,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "qasr-e-shirin",
    names: {
      en: "Qasr-e Shirin",
      ckb: "قەسری شیرین",
      kmr: "Qesra Şîrîn",
      ar: "قصر شيرين",
    },
    lat: 34.51,
    lon: 45.58,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "paveh",
    names: { en: "Paveh", ckb: "پاوە", kmr: "Pawe", ar: "باوة" },
    lat: 35.05,
    lon: 46.36,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "marivan",
    names: { en: "Marivan", ckb: "مەریوان", kmr: "Merîwan", ar: "مريوان" },
    lat: 35.52,
    lon: 46.17,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "baneh",
    names: { en: "Baneh", ckb: "بانە", kmr: "Banê", ar: "بانه" },
    lat: 35.99,
    lon: 45.89,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "saqqez",
    names: { en: "Saqqez", ckb: "سەقز", kmr: "Seqiz", ar: "سقز" },
    lat: 36.25,
    lon: 46.28,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "sanandaj",
    names: { en: "Sanandaj", ckb: "سنە", kmr: "Sine", ar: "سنندج" },
    lat: 35.31,
    lon: 47.0,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "urmia",
    names: { en: "Urmia", ckb: "ورمێ", kmr: "Urmiye", ar: "أورميا" },
    lat: 37.55,
    lon: 45.08,
    country: "IR",
    inKurdistanRegion: false,
  },
  {
    id: "piranshahr",
    names: { en: "Piranshahr", ckb: "پیرانشار", kmr: "Pîranşar", ar: "بيرانشهر" },
    lat: 36.7,
    lon: 45.14,
    country: "IR",
    inKurdistanRegion: false,
  },
  // --- Turkey (Bakur / border region) ---
  {
    id: "hakkari",
    names: { en: "Hakkari", ckb: "هەکاری", kmr: "Hekarî", ar: "هكاري" },
    lat: 37.57,
    lon: 43.74,
    country: "TR",
    inKurdistanRegion: false,
  },
  {
    id: "sirnak",
    names: { en: "Şırnak", ckb: "شرنەخ", kmr: "Şirnex", ar: "شرناخ" },
    lat: 37.52,
    lon: 42.46,
    country: "TR",
    inKurdistanRegion: false,
  },
  {
    id: "cizre",
    names: { en: "Cizre", ckb: "جزیرە", kmr: "Cizîr", ar: "جزيرة ابن عمر" },
    lat: 37.32,
    lon: 42.19,
    country: "TR",
    inKurdistanRegion: false,
  },
];

const SUPPORTED_NAME_LOCALES = new Set<keyof GazetteerCityNames>([
  "en",
  "ckb",
  "kmr",
  "ar",
]);

function isGazetteerNameLocale(locale: string): locale is keyof GazetteerCityNames {
  return SUPPORTED_NAME_LOCALES.has(locale as keyof GazetteerCityNames);
}

/** Picks the display name for `locale`, falling back to English for any
 * locale the gazetteer doesn't carry a name for (defensive — today all four
 * app locales are covered). Single choke point so no caller re-implements
 * this fallback differently. */
export function pickLocalizedName(names: GazetteerCityNames, locale: string): string {
  return isGazetteerNameLocale(locale) ? names[locale] : names.en;
}
