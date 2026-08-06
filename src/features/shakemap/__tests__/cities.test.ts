import { pickMapCities } from "../cities";

describe("pickMapCities", () => {
  // Real bundled gazetteer data around the Halabja/Slemani border region —
  // deliberately chosen because it contains both HomeBase-subset ("known
  // bigger town") cities and non-subset cities inside the same bbox, so
  // the priority-before-distance ordering rule is actually exercised.
  const bbox = { minLon: 45.0, maxLon: 46.5, minLat: 34.0, maxLat: 36.0 };

  it("ranks HomeBase-subset ('priority') cities ahead of non-subset cities regardless of distance", () => {
    // Centered on Penjwen (NOT in the HomeBase subset) — despite being at
    // distance 0 from the center point, Penjwen must still rank behind
    // every in-bbox priority city.
    const center = { lat: 35.62, lon: 46.2 };
    const result = pickMapCities(bbox, center, 5);

    expect(result.map((city) => city.id)).toEqual([
      "halabja",
      "darbandikhan",
      "slemani",
      "kalar",
      "khanaqin",
    ]);
    expect(result.map((city) => city.id)).not.toContain("penjwen");
  });

  it("caps the result at the requested max", () => {
    const result = pickMapCities(bbox, { lat: 35.2, lon: 45.8 }, 2);
    expect(result).toHaveLength(2);
  });

  it("fills remaining slots nearest-to-center once priority cities are exhausted", () => {
    // A tighter bbox with only one priority city (Halabja) plus non-subset
    // neighbors — the non-subset slots must come back nearest-first.
    const tightBbox = { minLon: 45.7, maxLon: 46.3, minLat: 34.9, maxLat: 35.4 };
    const center = { lat: 35.18, lon: 45.98 }; // Halabja itself
    const result = pickMapCities(tightBbox, center, 5);

    expect(result[0]?.id).toBe("halabja");
    // Every subsequent result must be non-decreasing in distance from
    // center among the non-priority remainder.
    for (let i = 2; i < result.length; i += 1) {
      const prevItem = result[i - 1];
      const item = result[i];
      if (!prevItem || !item) continue;
      const prevDistance = haversine(prevItem, center);
      const distance = haversine(item, center);
      expect(distance).toBeGreaterThanOrEqual(prevDistance - 1e-9);
    }
  });

  it("excludes cities outside the bbox entirely", () => {
    const result = pickMapCities(bbox, { lat: 35.2, lon: 45.8 }, 20);
    for (const city of result) {
      expect(city.lon).toBeGreaterThanOrEqual(bbox.minLon);
      expect(city.lon).toBeLessThanOrEqual(bbox.maxLon);
      expect(city.lat).toBeGreaterThanOrEqual(bbox.minLat);
      expect(city.lat).toBeLessThanOrEqual(bbox.maxLat);
    }
  });

  it("returns an empty list for a bbox with no gazetteer cities in it", () => {
    const emptyBbox = { minLon: 0, maxLon: 1, minLat: 0, maxLat: 1 };
    expect(pickMapCities(emptyBbox, { lat: 0.5, lon: 0.5 })).toEqual([]);
  });
});

function haversine(
  city: { lat: number; lon: number },
  center: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(center.lat - city.lat);
  const dLon = toRad(center.lon - city.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(city.lat)) * Math.cos(toRad(center.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}
