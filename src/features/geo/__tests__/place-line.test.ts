import i18n from "@/i18n";
import { NOTABLE_HISTORICAL_EVENTS } from "@/features/historical";
import { nearestCities } from "../nearest";
import { nearestCityDistanceLine, nearestCityLine, placeLine } from "../place-line";

describe("placeLine", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("builds a localized line + Kurdistan (Iraq) region label for a KRG event (English)", async () => {
    await i18n.changeLanguage("en");
    // A few km from Halabja.
    const event = { lat: 35.2, lon: 46.0, placeName: "32 km SE of Halabja, Iraq" };

    const result = placeLine(event, "en", i18n.t.bind(i18n));

    expect(result).toContain("Halabja");
    expect(result).toContain("km");
    expect(result).toContain("Kurdistan (Iraq)");
  });

  it("builds a Sorani line with localized digits, unit, direction, and region", async () => {
    await i18n.changeLanguage("ckb");
    const event = { lat: 35.2, lon: 46.0, placeName: "32 km SE of Halabja, Iraq" };

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
    const event = { lat: 34.85, lon: 46.55, placeName: "10 km NE of Javanrud, Iran" };

    const result = placeLine(event, "en", i18n.t.bind(i18n));

    expect(result).toContain("Javanrud");
    expect(result).toContain("Iran");
    expect(result).not.toContain("Kurdistan");
  });

  it("falls back to the raw provider place string for a far-world event", async () => {
    await i18n.changeLanguage("ckb");
    // Tokyo — nowhere near any gazetteer city.
    const event = { lat: 35.68, lon: 139.65, placeName: "10 km E of Tokyo, Japan" };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toBe("10 km E of Tokyo, Japan");
  });

  it("keeps the near-field Kurdish place line unchanged for a Sulaimani event (D28: never regress to a region name)", async () => {
    await i18n.changeLanguage("ckb");
    // A few km from Sulaimani, well inside NEAREST_CITY_FALLBACK_THRESHOLD_KM.
    const event = { lat: 35.56, lon: 45.43, placeName: "Iran-Iraq border region" };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toContain("سلێمانی");
    expect(result).toContain("کوردستان (عێراق)");
    // The provider's far-field region string must never leak into a
    // near-field line, even though it happens to be a known F-E region.
    expect(result).not.toContain("Iran-Iraq");
  });

  it("renders a translated Flinn-Engdahl region for a far-field event instead of provider prose (D28 decision 1)", async () => {
    await i18n.changeLanguage("en");
    // EMSC's flynn_region for a Turkey event, well beyond the fallback
    // threshold from any gazetteer city — see normalize.ts's
    // normalizeEmscFeature, which already passes flynn_region through as
    // placeName.
    const event = { lat: 39.0, lon: 35.0, placeName: "Turkey" };

    const result = placeLine(event, "en", i18n.t.bind(i18n));

    expect(result).toBe("Turkey");
  });

  it("renders a translated Flinn-Engdahl region in Sorani for the same far-field event", async () => {
    await i18n.changeLanguage("ckb");
    const event = { lat: 39.0, lon: 35.0, placeName: "Iran-Armenia-Azerbaijan border region" };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toBe("ناوچەی سنووری ئێران-ئەرمینیا-ئازەربایجان");
  });

  it("falls back to the English F-E name (not coordinates, not empty) for an unmapped far-field region", async () => {
    await i18n.changeLanguage("ckb");
    const event = { lat: 10.0, lon: 100.0, placeName: "Sumatra region" };

    const result = placeLine(event, "ckb", i18n.t.bind(i18n));

    expect(result).toBe("Sumatra region");
    expect(result.length).toBeGreaterThan(0);
    expect(/^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/.test(result)).toBe(false);
  });

  it("uses a translated placeNameKey override instead of the raw English placeName, for a far-world event (update-plan-2026-08.md §1.4)", async () => {
    await i18n.changeLanguage("ckb");
    // Same Kahramanmaraş coordinates as the Historical View's 2023 doublet.
    const event = {
      lat: 37.2256,
      lon: 37.0143,
      placeName: "Pazarcık, Kahramanmaraş, Türkiye",
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
  it("uses our nearest-city line beyond the gazetteer radius when no region is recognised", () => {
    const line = placeLine(
      { lat: 38.02, lon: 37.2, placeName: "Elbistan earthquake, Kahramanmaras earthquake sequence" },
      "en",
      i18n.t,
    );
    expect(line).not.toContain("Elbistan earthquake");
    expect(line).toMatch(/km/);
  });
});
