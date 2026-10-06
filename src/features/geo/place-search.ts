import { haversineDistanceKm } from "@/features/events/distance";
import {
  GAZETTEER_CITIES,
  type GazetteerCity,
  type GazetteerCityNames,
} from "./gazetteer";
import type { KurdishPlace } from "./kurdish-places";

/**
 * Place search: pure functions over an in-memory index. No React, no IO.
 * `place-index.ts` loads the bundled datasets and builds the index; this
 * module is what the tests (and the component) exercise.
 */

export type PlaceKind = "city" | "town" | "village";

export type PlaceNames = Partial<Record<"en" | "ckb" | "kmr" | "ar", string>>;

export interface Place {
  id: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  names: PlaceNames;
}

export interface PlaceResult {
  place: Place;
}

export interface LatLonPoint {
  lat: number;
  lon: number;
}

/** Most results the search returns (the list is read on a phone). */
export const MAX_PLACE_RESULTS = 20;

/** Quick picks shown when the query is empty and there is a location fix. */
export const NEARBY_QUICK_PICKS = 5;

// --- Normalisation ---------------------------------------------------------

// Arabic-script letters folded to one base letter, so a reader typing Arabic,
// Sorani or Persian forms of the same name all land on the same key.
const ARABIC_FOLD: Record<string, string> = {
  ي: "ي",
  ى: "ي",
  ی: "ي",
  ێ: "ي",
  ې: "ي",
  ئ: "",
  ء: "",
  ك: "ك",
  ک: "ك",
  گ: "ك",
  ڭ: "ك",
  ه: "ه",
  ە: "ه",
  ة: "ه",
  ہ: "ه",
  ھ: "ه",
  ۀ: "ه",
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ؤ: "و",
  ۆ: "و",
  ۇ: "و",
  ڕ: "ر",
  ڵ: "ل",
  ڤ: "ف",
  پ: "ب",
  چ: "ج",
  ژ: "ز",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const LATIN_FOLD: Record<string, string> = {
  ı: "i",
  ø: "o",
  đ: "d",
  ł: "l",
  ß: "ss",
};

// Combining marks (Latin diacritics) and Arabic harakat, Quranic marks and
// the dagger alef; tatweel (kashida); apostrophes and similar glyphs that are
// part of a name, not a word break.
const STRIP = /[̀-ًͯ-ٰٟۖ-ۭـ'’ʼʻ‘`´]/g;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

function fold(input: string, dropKurdishE: boolean): string {
  // Arabic-script letters first: NFKD would otherwise split أ إ آ ئ ؤ into a
  // base letter plus a combining hamza before the fold sees them.
  let folded = "";
  for (const ch of input.toLowerCase()) {
    if (dropKurdishE && ch === "ە") {
      continue;
    }
    folded += ARABIC_FOLD[ch] ?? ch;
  }
  let latin = "";
  for (const ch of folded.normalize("NFKD").replace(STRIP, "")) {
    latin += LATIN_FOLD[ch] ?? ch;
  }
  return latin.replace(NOT_LETTER_OR_DIGIT, " ").trim();
}

/**
 * The search key of a name: lower case, no Latin diacritics (ê î û ç ş to
 * e i u c s), Arabic-script variants folded (ي ی ى ێ, ك ک گ, ه ە ة, hamza
 * forms, tatweel, harakat), punctuation turned into single spaces. Sorani ە
 * counts as ه here; the index also keeps a key with it dropped (it is a
 * vowel, so Arabic spells هەولێر as هولير).
 */
export function normalizeForSearch(input: string): string {
  return fold(input, false);
}

/** The Arabic definite article, so "موصل" finds "الموصل". */
function withoutArticle(key: string): string {
  return key
    .split(" ")
    .map((word) => (word.length > 3 && word.startsWith("ال") ? word.slice(2) : word))
    .join(" ");
}

function keysOf(names: PlaceNames): string[] {
  const keys = new Set<string>();
  for (const value of Object.values(names)) {
    if (!value) {
      continue;
    }
    for (const key of [fold(value, false), fold(value, true)]) {
      if (key) {
        keys.add(key);
        const bare = withoutArticle(key);
        if (bare !== key) {
          keys.add(bare);
        }
      }
    }
  }
  return [...keys];
}

/** Other common spellings of the main cities, searchable but never shown
 * (people type "Erbil" and "Sulaymaniyah" far more than "Hawler"). */
const CITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  erbil: ["Erbil", "Arbil", "Irbil", "Hewler", "Hawlêr"],
  slemani: ["Sulaymaniyah", "Sulaimani", "Sulaimaniyah", "Sulaymaniya", "Suleimaniya"],
  duhok: ["Dohuk", "Dahuk"],
  kirkuk: ["Karkuk", "Kerkuk"],
  mosul: ["Mawsil", "Musul"],
  halabja: ["Halabcha", "Halabdja"],
  zakho: ["Zaxo", "Zakhu"],
};

// --- Index -----------------------------------------------------------------

interface IndexEntry {
  place: Place;
  keys: string[];
}

export interface PlaceIndex {
  entries: readonly IndexEntry[];
  byId: ReadonlyMap<string, Place>;
}

const KIND_RANK: Record<PlaceKind, number> = { city: 0, town: 1, village: 2 };

/** A town of the OSM extract this close to a gazetteer city is the same place. */
const DUPLICATE_RADIUS_KM = 2;
/** ...or this close, when they share any normalised name. */
const DUPLICATE_NAME_RADIUS_KM = 10;

export interface PlaceSources {
  cities: readonly GazetteerCity[];
  /** OSM tier 1-2 (city, town, suburb). */
  towns: readonly KurdishPlace[];
  /** OSM tier 3 (village, hamlet). */
  villages: readonly KurdishPlace[];
}

function osmPlace(source: KurdishPlace, kind: PlaceKind): Place {
  const names: PlaceNames = {};
  if (source.names.ckb) names.ckb = source.names.ckb;
  if (source.names.kmr) names.kmr = source.names.kmr;
  if (source.names.ar) names.ar = source.names.ar;
  return { id: source.id, kind, lat: source.lat, lon: source.lon, names };
}

/** A gazetteer city as a searchable place; null for an id that is not one. */
export function gazetteerPlaceById(id: string): Place | null {
  const city = GAZETTEER_CITIES.find((candidate) => candidate.id === id);
  return city ? cityPlace(city) : null;
}

function cityPlace(city: GazetteerCity): Place {
  const names: GazetteerCityNames = city.names;
  return { id: city.id, kind: "city", lat: city.lat, lon: city.lon, names: { ...names } };
}

/**
 * Builds the search index once: every name of every place is normalised
 * here, so a keystroke only scans precomputed strings. The gazetteer wins
 * over the OSM extract: an OSM town that is the same place as a gazetteer
 * city (very close, or close with a shared name) is dropped.
 */
export function buildPlaceIndex(sources: PlaceSources): PlaceIndex {
  const entries: IndexEntry[] = [];
  const byId = new Map<string, Place>();

  const cityEntries: IndexEntry[] = sources.cities.map((city) => {
    const place = cityPlace(city);
    const aliases = (CITY_ALIASES[city.id] ?? []).map((alias) => fold(alias, false));
    return { place, keys: [...new Set([...keysOf(place.names), ...aliases])] };
  });
  for (const entry of cityEntries) {
    entries.push(entry);
    byId.set(entry.place.id, entry.place);
  }

  const isDuplicateOfCity = (place: Place, keys: string[]): boolean =>
    cityEntries.some((city) => {
      const distance = haversineDistanceKm(
        city.place.lat,
        city.place.lon,
        place.lat,
        place.lon,
      );
      if (distance <= DUPLICATE_RADIUS_KM) {
        return true;
      }
      return (
        distance <= DUPLICATE_NAME_RADIUS_KM &&
        keys.some((key) => city.keys.includes(key))
      );
    });

  for (const source of sources.towns) {
    const place = osmPlace(source, "town");
    const keys = keysOf(place.names);
    if (keys.length === 0 || byId.has(place.id) || isDuplicateOfCity(place, keys)) {
      continue;
    }
    entries.push({ place, keys });
    byId.set(place.id, place);
  }

  for (const source of sources.villages) {
    const place = osmPlace(source, "village");
    const keys = keysOf(place.names);
    if (keys.length === 0 || byId.has(place.id)) {
      continue;
    }
    entries.push({ place, keys });
    byId.set(place.id, place);
  }

  return { entries, byId };
}

// --- Search ----------------------------------------------------------------

export interface SearchOptions {
  limit?: number;
  /** Breaks ties between equally good matches: the closer place first. */
  near?: LatLonPoint | null;
}

/** 0 exact, 1 prefix, 2 word prefix, 3 substring; -1 no match. */
function matchTier(keys: readonly string[], query: string): number {
  let best = -1;
  for (const key of keys) {
    let tier = -1;
    if (key === query) {
      tier = 0;
    } else if (key.startsWith(query)) {
      tier = 1;
    } else if (key.includes(` ${query}`)) {
      tier = 2;
    } else if (key.includes(query)) {
      tier = 3;
    }
    if (tier !== -1 && (best === -1 || tier < best)) {
      best = tier;
      if (best === 0) {
        break;
      }
    }
  }
  return best;
}

/**
 * Finds places by any of their names, in any script. Ranking: exact match,
 * then prefix, then word prefix, then substring; within a tier cities before
 * towns before villages; then the closer to `near` (when given), then id, so
 * the order is stable. At most `limit` (default 20) results.
 */
export function searchPlaces(
  index: PlaceIndex,
  query: string,
  options: SearchOptions = {},
): PlaceResult[] {
  const normalized = normalizeForSearch(query);
  if (normalized === "") {
    return [];
  }
  const limit = options.limit ?? MAX_PLACE_RESULTS;
  const near = options.near ?? null;

  const hits: { place: Place; tier: number; distance: number }[] = [];
  for (const entry of index.entries) {
    const tier = matchTier(entry.keys, normalized);
    if (tier === -1) {
      continue;
    }
    hits.push({
      place: entry.place,
      tier,
      distance: near
        ? haversineDistanceKm(near.lat, near.lon, entry.place.lat, entry.place.lon)
        : 0,
    });
  }

  hits.sort(
    (a, b) =>
      a.tier - b.tier ||
      KIND_RANK[a.place.kind] - KIND_RANK[b.place.kind] ||
      a.distance - b.distance ||
      (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0),
  );
  return hits.slice(0, limit).map((hit) => ({ place: hit.place }));
}

/** The nearest cities and towns to a point (villages are too many to be a
 * useful "nearby"). Nearest first. */
export function nearbyPlaces(
  index: PlaceIndex,
  point: LatLonPoint,
  count: number = NEARBY_QUICK_PICKS,
): Place[] {
  return index.entries
    .filter((entry) => entry.place.kind !== "village")
    .map((entry) => ({
      place: entry.place,
      distance: haversineDistanceKm(
        point.lat,
        point.lon,
        entry.place.lat,
        entry.place.lon,
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((hit) => hit.place);
}

// --- Display ---------------------------------------------------------------

/** Which name to show for each UI locale, in order. English readers see the
 * Latin Kurmanji spelling before Arabic script; Sorani readers see Arabic
 * before Kurmanji, as the map labels do. */
const NAME_CHAINS: Record<string, readonly (keyof PlaceNames)[]> = {
  en: ["en", "kmr", "ckb", "ar"],
  kmr: ["kmr", "en", "ckb", "ar"],
  ckb: ["ckb", "ar", "kmr", "en"],
  ar: ["ar", "ckb", "kmr", "en"],
};

/** The name of a place in the reader's language, falling back along a
 * per-locale chain. Every indexed place has at least one name. */
export function placeDisplayName(place: Place, locale: string): string {
  const chain = NAME_CHAINS[locale] ?? NAME_CHAINS.en!;
  for (const key of chain) {
    const value = place.names[key];
    if (value) {
      return value;
    }
  }
  return place.id;
}
