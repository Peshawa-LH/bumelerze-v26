import i18n from "@/i18n";
import { NOTABLE_HISTORICAL_EVENTS } from "@/features/historical";
import { nearestCities } from "../nearest";
import { nearestCityDistanceLine, nearestCityLine, placeLine } from "../place-line";

/** Drops the invisible bidi isolates around numerals, to match on plain text. */
const stripIsolates = (text: string) => text.replace(/[\u2066\u2069]/gu, "");

describe("placeLine", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("builds a localized line + Kurdistan (Iraq) region label for a KRG event (English)", async () => {
    await i18n.changeLanguage("en");
    // A few km from Halabja.
    const event = { lat: 35.2, lon: 46.0 };

    const result = placeLine(event, "en", i18n.t.bind(i18n));

    expect(result).toContain("Halabja");
    expect(result).toContain("km");
    expect(result).toContain("Kurdistan (Iraq)");
  });

  it("builds a Sorani line with localized digits, unit, direction, and region", async () => {
    await i18n.changeLanguage("ckb");
    const event = { lat: 35.2, lon: 46.0 };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toContain("هەڵەبجە");
    expect(result).toContain("کم");
    expect(result).toContain("کوردستان (عێراق)");
    // No Latin digits leak into the Sorani numeral.
    expect(/[0-9]/.test(result)).toBe(false);
  });

  it("labels an Iran-side event with the localized country name, not Kurdistan (Iraq)", async () => {
    await i18n.changeLanguage("en");
    // A few km from Javanrud, well outside the KRG bbox.
    const event = { lat: 34.85, lon: 46.55 };

    const result = placeLine(event, "en", i18n.t.bind(i18n));

    expect(result).toContain("Javanrud");
    expect(result).toContain("Iran");
    expect(result).not.toContain("Kurdistan");
  });

  it("names a far-world event by its translated F-E region, never the provider sentence (World view)", async () => {
    await i18n.changeLanguage("ckb");
    // Tokyo — nowhere near any gazetteer city. USGS would say "10 km E of
    // Tokyo, Japan"; the F-E region of the epicentre is ours, in Sorani.
    const event = { lat: 35.68, lon: 139.65 };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toBe("نزیک کەناراوی باشووری هۆنشۆ، ژاپۆن");
    expect(result).not.toMatch(/[A-Za-z0-9]/u);
  });

  it("renders the same far-field event in every locale from one rule", async () => {
    const event = { lat: -4.35, lon: 152.27 }; // "55 km ESE of Kokopo" in USGS prose
    const expected = {
      en: "New Britain region, Papua New Guinea",
      ckb: "ناوچەی بریتانیای نوێ، پاپوا گینیای نوێ",
      kmr: "Herêma Brîtanyaya Nû, Papua Gîneya Nû",
      ar: "منطقة بريطانيا الجديدة، بابوا غينيا الجديدة",
    } as const;
    for (const locale of ["en", "ckb", "kmr", "ar"] as const) {
      await i18n.changeLanguage(locale);
      expect(placeLine(event, locale, i18n.t.bind(i18n))).toBe(expected[locale]);
    }
  });

  it("keeps the near-field Kurdish place line unchanged for a Sulaimani event (D28: never regress to a region name)", async () => {
    await i18n.changeLanguage("ckb");
    // A few km from Sulaimani, well inside NEAREST_CITY_FALLBACK_THRESHOLD_KM.
    // F-E calls this spot "Iran-Iraq border region"; the near field ignores it.
    const event = { lat: 35.56, lon: 45.43 };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toContain("سلێمانی");
    expect(result).toContain("کوردستان (عێراق)");
    expect(result).not.toBe("عێراق");
    expect(result).not.toContain("ناوچەی سنووری");
  });

  it("never turns an event in or around Sulaimani into a bare country name, in any locale", async () => {
    const bareCountries = ["Iraq", "عێراق", "العراق", "Iran", "ئێران", "إيران"];
    // Sulaimani itself, 40 km out in every direction (Iran side included).
    const offsets: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.35, 0],
      [-0.35, 0],
      [0, 0.45],
      [0, -0.45],
    ];
    for (const locale of ["en", "ckb", "kmr", "ar"] as const) {
      await i18n.changeLanguage(locale);
      for (const [dLat, dLon] of offsets) {
        const result = placeLine(
          { lat: 35.56 + dLat, lon: 45.43 + dLon },
          locale,
          i18n.t.bind(i18n),
        );
        expect(bareCountries).not.toContain(result);
        expect(result.length).toBeGreaterThan(8);
      }
    }
  });

  it("labels the same city the same way wherever the epicentre falls (Khanaqin, Iraq in every position)", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    // Khanaqin sits at 34.36 N, 45.39 E. One event is a little north of it
    // (inside the simplified KRG bbox), one a little south (outside it).
    const north = stripIsolates(placeLine({ lat: 34.42, lon: 45.39 }, "en", t));
    const south = stripIsolates(placeLine({ lat: 34.28, lon: 45.39 }, "en", t));

    expect(north).toMatch(/of Khanaqin, Iraq$/);
    expect(south).toMatch(/of Khanaqin, Iraq$/);
    expect(north).not.toContain("Kurdistan");
  });

  it("renders the translated F-E region for a far-field event in English and Sorani", async () => {
    // Central Turkey, far beyond the near-field radius of any gazetteer city.
    const event = { lat: 39.0, lon: 35.0 };
    await i18n.changeLanguage("en");
    expect(placeLine(event, "en", i18n.t.bind(i18n))).toBe("Turkey");
    await i18n.changeLanguage("ckb");
    expect(placeLine(event, "ckb", i18n.t.bind(i18n))).toBe("تورکیا");
  });

  it("falls back to the English F-E name (not coordinates, not empty) for an untranslated far-field region", async () => {
    await i18n.changeLanguage("ckb");
    const event = { lat: 10.0, lon: 100.0 }; // Gulf of Thailand, F-E 708

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toContain("Gulf of Thailand");
    expect(/^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/.test(result)).toBe(false);
    await i18n.changeLanguage("en");
    expect(placeLine(event, "en", i18n.t.bind(i18n))).toBe("Gulf of Thailand");
  });

  it("drops the bearing and distance in the far field", async () => {
    await i18n.changeLanguage("en");
    // Izu Islands: USGS says "Izu Islands, Japan region".
    const result = placeLine({ lat: 33.0, lon: 139.5 }, "en", i18n.t.bind(i18n));
    expect(result).toBe("Southeast of Honshu, Japan");
    expect(result).not.toMatch(/\d/);
  });

  it("uses one distance precision: whole km from 10 km up, one decimal below", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    // Directly north of Halabja (35.18 N, 45.98 E): ~5.6 km, then ~13 km.
    expect(stripIsolates(placeLine({ lat: 35.23, lon: 45.98 }, "en", t))).toMatch(
      /^5\.6 km N of Halabja/,
    );
    expect(stripIsolates(placeLine({ lat: 35.3, lon: 45.98 }, "en", t))).toMatch(
      /^13 km N of Halabja/,
    );
  });

  it("uses a translated placeNameKey override instead of the raw English placeName, for a far-world event (update-plan-2026-08.md §1.4)", async () => {
    await i18n.changeLanguage("ckb");
    // Same Kahramanmaraş coordinates as the Historical View's 2023 doublet.
    const event = {
      lat: 37.2256,
      lon: 37.0143,
      placeNameKey: "historical.places.pazarcik2023",
    };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toBe("پازارجق، کەهرەمانمەرەش، تورکیا");
    expect(result).not.toContain("Kahramanmaraş");
  });

  it("never renders the provider's own raw place string as the headline, for any curated Historical event (owner directive 2026-09-02)", async () => {
    // Near-field events (no `placeNameKey`) always resolve through the
    // gazetteer's own distance/direction/region sentence, in EVERY locale
    // — structurally never the raw provider string. The two far-field
    // Kahramanmaraş events resolve through a curated `placeNameKey`
    // translation instead; that translation is intentionally byte-identical
    // to the raw provider string ONLY in English (the source locale the
    // curator copied it from, `historical.places.*`'s own en.json entry) —
    // it is still OUR OWN catalog text, not a live passthrough of
    // `event.placeName`, but the two happen to coincide, so this assertion
    // is scoped to the three locales where the translation actually
    // diverges (ckb/kmr/ar — a different script entirely).
    for (const locale of ["en", "ckb", "kmr", "ar"] as const) {
      await i18n.changeLanguage(locale);
      for (const event of NOTABLE_HISTORICAL_EVENTS) {
        if (locale === "en" && event.placeNameKey) {
          continue;
        }
        const result = placeLine(event, locale, i18n.t.bind(i18n));
        expect(result).not.toBe(event.placeName);
      }
    }
  });
});

describe("nearestCityLine / nearestCityDistanceLine", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("nearestCityLine includes distance, direction, and city; nearestCityDistanceLine omits direction", async () => {
    await i18n.changeLanguage("en");
    const [nearest] = nearestCities(35.2, 46.0, 1);
    expect(nearest).toBeDefined();

    const withDirection = nearestCityLine(nearest!, "en", i18n.t.bind(i18n));
    const withoutDirection = nearestCityDistanceLine(nearest!, "en", i18n.t.bind(i18n));

    expect(withDirection).toContain("Halabja");
    expect(withoutDirection).toContain("Halabja");
    expect(withoutDirection).toContain("from Halabja");
  });
});

describe("placeLine never echoes a provider title (owner directive 2026-09-02)", () => {
  it("ignores any provider text: the type has no input for it and the output is ours", () => {
    const line = placeLine({ lat: 38.02, lon: 37.2 }, "en", i18n.t);
    expect(line).not.toContain("earthquake");
    expect(line).toBe("Turkey");
  });
});
