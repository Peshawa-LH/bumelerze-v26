import { GAZETTEER_CITIES } from "../gazetteer";
import { __resetPlaceIndexForTests, loadPlaceIndex } from "../place-index";
import {
  buildPlaceIndex,
  MAX_PLACE_RESULTS,
  nearbyPlaces,
  normalizeForSearch,
  placeDisplayName,
  searchPlaces,
  type PlaceIndex,
} from "../place-search";

let index: PlaceIndex;

beforeAll(async () => {
  index = await loadPlaceIndex();
});

function ids(query: string, options?: Parameters<typeof searchPlaces>[2]): string[] {
  return searchPlaces(index, query, options).map((result) => result.place.id);
}

describe("normalizeForSearch", () => {
  it("folds case, Latin diacritics and spacing", () => {
    expect(normalizeForSearch("  Hewlêr ")).toBe("hewler");
    expect(normalizeForSearch("Şêxan-Çiyayî")).toBe("sexan ciyayi");
    expect(normalizeForSearch("Silêmanî")).toBe("silemani");
    expect(normalizeForSearch("Sûr   û  Kûr")).toBe("sur u kur");
    expect(normalizeForSearch("Qara'ul")).toBe("qaraul");
    expect(normalizeForSearch("ISTANBUL İstanbul")).toBe("istanbul istanbul");
  });

  it("folds Arabic-script variants to one key", () => {
    // ي / ی / ى, ك / ک, ه / ە / ة are the same letter for search.
    expect(normalizeForSearch("كركوك")).toBe(normalizeForSearch("کرکوک"));
    expect(normalizeForSearch("دهوك")).toBe(normalizeForSearch("دهۆک"));
    expect(normalizeForSearch("هولیر")).toBe(normalizeForSearch("هولير"));
    expect(normalizeForSearch("زاخۆ")).toBe(normalizeForSearch("زاخو"));
    expect(normalizeForSearch("حلبجة")).toBe(normalizeForSearch("حلبجه"));
  });

  it("drops hamza forms, tatweel and harakat", () => {
    expect(normalizeForSearch("أربيل")).toBe(normalizeForSearch("اربيل"));
    expect(normalizeForSearch("إربيل")).toBe("اربيل");
    expect(normalizeForSearch("اربــيل")).toBe("اربيل");
    expect(normalizeForSearch("أَرْبِيل")).toBe("اربيل");
    expect(normalizeForSearch("ئاکرێ")).toBe("اكري");
  });
});

describe("buildPlaceIndex", () => {
  it("indexes the gazetteer, the OSM towns and the villages once", () => {
    // 76 gazetteer cities + OSM towns not already a gazetteer city + villages.
    expect(index.entries.length).toBeGreaterThan(5400 + 76);
    expect(index.byId.get("erbil")?.kind).toBe("city");
    const kinds = new Set(index.entries.map((entry) => entry.place.kind));
    expect(kinds).toEqual(new Set(["city", "town", "village"]));
  });

  it("drops an OSM town that is the same place as a gazetteer city", () => {
    const erbil = GAZETTEER_CITIES.find((city) => city.id === "erbil")!;
    const small = buildPlaceIndex({
      cities: [erbil],
      towns: [
        {
          id: "n1",
          lat: erbil.lat + 0.005,
          lon: erbil.lon,
          tier: 1,
          names: { ckb: "هەولێر" },
        },
        {
          id: "n2",
          lat: erbil.lat + 0.3,
          lon: erbil.lon,
          tier: 2,
          names: { kmr: "Ankawa" },
        },
      ],
      villages: [],
    });
    expect([...small.byId.keys()]).toEqual(["erbil", "n2"]);
  });
});

describe("searchPlaces", () => {
  it("finds Hawler by its English, Kurmanji, Sorani and Arabic names", () => {
    for (const query of [
      "hawler",
      "hewler",
      "Hewlêr",
      "هەولێر",
      "هولير",
      "اربيل",
      "أربيل",
    ]) {
      expect(ids(query)[0]).toBe("erbil");
    }
  });

  it("finds the main cities by their common alternative spellings", () => {
    expect(ids("erbil")[0]).toBe("erbil");
    expect(ids("Sulaymaniyah")[0]).toBe("slemani");
    expect(ids("dohuk")[0]).toBe("duhok");
  });

  it("matches in any language regardless of the UI locale", () => {
    expect(ids("slemani")[0]).toBe("slemani");
    expect(ids("سلێمانی")[0]).toBe("slemani");
    expect(ids("السليمانية")[0]).toBe("slemani");
    expect(ids("سليمانية")).toContain("slemani");
  });

  it("finds a village by its Kurmanji name", () => {
    const results = ids("Sehbiyax");
    expect(results).toContain("n9852690211");
    // ...and by its Sorani name.
    expect(ids("شەهبییاخ")).toContain("n9852690211");
  });

  it("finds Ankawa by the English spelling though only 'Enkawe is in the data", () => {
    // OSM has ckb عەنکاوە, kmr 'Enkawe, ar عنكاوة — no English name.
    expect(ids("ankawa")).toContain("n2479376280");
    expect(ids("Ankawa")[0]).toBe("n2479376280");
    expect(ids("enkawe")[0]).toBe("n2479376280");
  });

  it("ranks a loose Latin match after every strict match", () => {
    // "hawler" matches Hawler strictly; the loose fold must not push anything above it.
    expect(ids("hawler")[0]).toBe("erbil");
  });

  it("ranks exact, then prefix, then word prefix, then substring", () => {
    const tiny = buildPlaceIndex({
      cities: [],
      towns: [],
      villages: [
        { id: "d-sub", lat: 0, lon: 0, tier: 3, names: { kmr: "Abkani" } },
        { id: "c-word", lat: 0, lon: 0, tier: 3, names: { kmr: "Gundê Kani" } },
        { id: "b-prefix", lat: 0, lon: 0, tier: 3, names: { kmr: "Kanisor" } },
        { id: "a-exact", lat: 0, lon: 0, tier: 3, names: { kmr: "Kanî" } },
      ],
    });
    expect(searchPlaces(tiny, "kani").map((r) => r.place.id)).toEqual([
      "a-exact",
      "b-prefix",
      "c-word",
      "d-sub",
    ]);
  });

  it("puts cities before villages within the same match tier", () => {
    const tiny = buildPlaceIndex({
      cities: [
        {
          id: "bigtown",
          names: { en: "Kani", ckb: "کانی", kmr: "Kanî", ar: "كاني" },
          lat: 36,
          lon: 44,
          country: "IQ",
          inKurdistanRegion: true,
        },
      ],
      towns: [],
      villages: [{ id: "a-village", lat: 36, lon: 44, tier: 3, names: { kmr: "Kanî" } }],
    });
    expect(searchPlaces(tiny, "kani").map((r) => r.place.id)).toEqual([
      "bigtown",
      "a-village",
    ]);
    // A village with an exact name still beats a city that only has a prefix.
    const prefixCity = buildPlaceIndex({
      cities: [
        {
          id: "kanisor",
          names: { en: "Kanisor", ckb: "کانیسور", kmr: "Kanisor", ar: "كانيسور" },
          lat: 36,
          lon: 44,
          country: "IQ",
          inKurdistanRegion: true,
        },
      ],
      towns: [],
      villages: [{ id: "v", lat: 36, lon: 44, tier: 3, names: { kmr: "Kani" } }],
    });
    expect(searchPlaces(prefixCity, "kani")[0]?.place.id).toBe("v");
  });

  it("breaks ties by distance to the reader, then by id", () => {
    const tiny = buildPlaceIndex({
      cities: [],
      towns: [],
      villages: [
        { id: "far", lat: 37, lon: 44, tier: 3, names: { kmr: "Kani" } },
        { id: "near", lat: 36.01, lon: 44, tier: 3, names: { kmr: "Kani" } },
        { id: "a-near", lat: 36.01, lon: 44, tier: 3, names: { kmr: "Kani" } },
      ],
    });
    const near = { lat: 36, lon: 44 };
    expect(searchPlaces(tiny, "kani", { near }).map((r) => r.place.id)).toEqual([
      "a-near",
      "near",
      "far",
    ]);
    // Without a position the order is the id order, so it is stable.
    expect(searchPlaces(tiny, "kani").map((r) => r.place.id)).toEqual([
      "a-near",
      "far",
      "near",
    ]);
  });

  it("caps the results at 20 and honours a smaller limit", () => {
    const many = ids("ka");
    expect(many).toHaveLength(MAX_PLACE_RESULTS);
    expect(ids("ka", { limit: 5 })).toHaveLength(5);
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("zzzzqqqq")).toEqual([]);
  });

  it("stays fast over all places", () => {
    const queries = ["a", "ha", "كا", "کانی", "sur", "gund", "xyz", "erbil", "ئاک"];
    const started = Date.now();
    for (let round = 0; round < 10; round += 1) {
      for (const query of queries) {
        searchPlaces(index, query);
      }
    }
    // 90 searches over ~6k places; a generous bound that a low-end phone
    // (about 10x slower than this machine) still meets per keystroke.
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("builds the index lazily and only once", async () => {
    __resetPlaceIndexForTests();
    const first = await loadPlaceIndex();
    expect(await loadPlaceIndex()).toBe(first);
    index = first;
  });
});

describe("nearbyPlaces", () => {
  it("returns the nearest cities and towns, never villages, nearest first", () => {
    const erbil = GAZETTEER_CITIES.find((city) => city.id === "erbil")!;
    const places = nearbyPlaces(index, { lat: erbil.lat, lon: erbil.lon }, 5);
    expect(places).toHaveLength(5);
    expect(places[0]?.id).toBe("erbil");
    expect(places.every((place) => place.kind !== "village")).toBe(true);
  });
});

describe("placeDisplayName", () => {
  const names = { kmr: "Kanî", ar: "كاني" };
  const place = { id: "x", kind: "village" as const, lat: 0, lon: 0, names };

  it("uses the reader's language when the place has it", () => {
    expect(placeDisplayName(place, "kmr")).toBe("Kanî");
    expect(placeDisplayName(place, "ar")).toBe("كاني");
  });

  it("falls back sensibly when the language is missing", () => {
    // English readers prefer Latin script; Sorani readers prefer Arabic script.
    expect(placeDisplayName(place, "en")).toBe("Kanî");
    expect(placeDisplayName(place, "ckb")).toBe("كاني");
    expect(placeDisplayName({ ...place, names: { ckb: "کانی" } }, "kmr")).toBe("کانی");
  });

  it("drops a leading apostrophe from an OSM spelling", () => {
    expect(placeDisplayName({ ...place, names: { kmr: "'Enkawe" } }, "en")).toBe(
      "Enkawe",
    );
  });

  it("shows Hawler in English for the gazetteer's Erbil", () => {
    expect(placeDisplayName(index.byId.get("erbil")!, "en")).toBe("Hawler");
  });
});
