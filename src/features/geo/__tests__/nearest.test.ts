import { GAZETTEER_CITIES } from "../gazetteer";
import { nearestCities } from "../nearest";

describe("nearestCities", () => {
  it("puts the city whose own coordinates are queried first, at ~0 distance", () => {
    for (const city of GAZETTEER_CITIES) {
      const [first] = nearestCities(city.lat, city.lon, 1);
      expect(first?.city.id).toBe(city.id);
      expect(first?.distanceKm).toBeCloseTo(0, 4);
    }
  });

  it("returns results sorted nearest-first", () => {
    const results = nearestCities(35.5, 45.5, 5);
    for (let i = 1; i < results.length; i += 1) {
      const previous = results[i - 1];
      const current = results[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(current!.distanceKm).toBeGreaterThanOrEqual(previous!.distanceKm);
    }
  });

  it("defaults to 3 results", () => {
    expect(nearestCities(35.56, 45.43)).toHaveLength(3);
  });

  it("picks Slemani as the nearest city for a point a few km southeast of it", () => {
    const [first] = nearestCities(35.5, 45.5, 1);
    expect(first?.city.id).toBe("slemani");
  });

  it("respects a requested count larger or smaller than 3", () => {
    expect(nearestCities(36.19, 44.01, 1)).toHaveLength(1);
    expect(nearestCities(36.19, 44.01, 10)).toHaveLength(10);
  });
});
