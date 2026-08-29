import { GAZETTEER_CITIES } from "../gazetteer";
import {
  isPointInKurdistanRegion,
  resolveFarFieldRegionKey,
  resolveRegionLabelKey,
} from "../region";

describe("isPointInKurdistanRegion", () => {
  it("is true for Erbil, Slemani, and Duhok's own coordinates", () => {
    expect(isPointInKurdistanRegion(36.19, 44.01)).toBe(true);
    expect(isPointInKurdistanRegion(35.56, 45.43)).toBe(true);
    expect(isPointInKurdistanRegion(36.87, 42.99)).toBe(true);
  });

  it("is false for a point far outside the bbox (e.g. Baghdad)", () => {
    expect(isPointInKurdistanRegion(33.31, 44.36)).toBe(false);
  });
});

describe("resolveRegionLabelKey", () => {
  const erbil = GAZETTEER_CITIES.find((city) => city.id === "erbil")!;
  const javanrud = GAZETTEER_CITIES.find((city) => city.id === "javanrud")!;
  const baghdad = GAZETTEER_CITIES.find((city) => city.id === "baghdad")!;

  it("labels a KRG-flagged nearest city as Kurdistan (Iraq)", () => {
    expect(resolveRegionLabelKey(erbil, erbil.lat, erbil.lon)).toBe("kurdistanIraq");
  });

  it("labels an Iranian nearest city (outside the KRG bbox) with its own country", () => {
    expect(resolveRegionLabelKey(javanrud, javanrud.lat, javanrud.lon)).toBe("iran");
  });

  it("labels a non-KRG Iraqi nearest city (e.g. Baghdad, outside the bbox) as Iraq", () => {
    expect(resolveRegionLabelKey(baghdad, baghdad.lat, baghdad.lon)).toBe("iraq");
  });

  it("overrides an unflagged nearest city with Kurdistan (Iraq) when the point itself is inside the bbox", () => {
    // Kirkuk is flagged inKurdistanRegion: false, but its coordinates are
    // inside the (deliberately simplified) KRG bbox.
    const kirkuk = GAZETTEER_CITIES.find((city) => city.id === "kirkuk")!;
    expect(kirkuk.inKurdistanRegion).toBe(false);
    expect(resolveRegionLabelKey(kirkuk, kirkuk.lat, kirkuk.lon)).toBe("kurdistanIraq");
  });
});

describe("resolveFarFieldRegionKey", () => {
  it("resolves the highest-frequency catalog region labels (D28 decision 1)", () => {
    expect(resolveFarFieldRegionKey("Turkey")).toBe("turkey");
    expect(resolveFarFieldRegionKey("Iran-Armenia-Azerbaijan border region")).toBe(
      "iranArmeniaAzerbaijanBorder",
    );
    expect(resolveFarFieldRegionKey("Iran-Iraq border region")).toBe("iranIraqBorder");
    expect(resolveFarFieldRegionKey("Persian Gulf")).toBe("persianGulf");
  });

  it("resolves case-drift variants seen in the catalog data to the same key", () => {
    expect(resolveFarFieldRegionKey("western Iran")).toBe("westernIran");
    expect(resolveFarFieldRegionKey("Western Iran")).toBe("westernIran");
    expect(resolveFarFieldRegionKey("eastern Turkey")).toBe("easternTurkey");
  });

  it("returns null for an unmapped region or bearing-format provider prose", () => {
    expect(resolveFarFieldRegionKey("142 km SSE of Hasaki, Syria")).toBeNull();
    expect(resolveFarFieldRegionKey("Sumatra region")).toBeNull();
  });
});
