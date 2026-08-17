import i18n from "@/i18n";
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
