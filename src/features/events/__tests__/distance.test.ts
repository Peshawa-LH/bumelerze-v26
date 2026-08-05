import { distanceFromUserKm, haversineDistanceKm } from "../distance";

describe("haversineDistanceKm", () => {
  it("returns ~0 for identical coordinates", () => {
    expect(haversineDistanceKm(36.19, 44.01, 36.19, 44.01)).toBeCloseTo(0, 5);
  });

  it("matches a known great-circle distance (Erbil to Slemani, ~150km) within tolerance", () => {
    const erbil = { lat: 36.19, lon: 44.01 };
    const slemani = { lat: 35.56, lon: 45.43 };
    const distance = haversineDistanceKm(erbil.lat, erbil.lon, slemani.lat, slemani.lon);
    // Straight-line distance, not driving distance — loose tolerance.
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(200);
  });

  it("is always non-negative and finite, even for far-apart points (spec-v1.md §4.1: never '?' or a blank value)", () => {
    const distance = haversineDistanceKm(34.0, 48.0, -33.87, 151.21); // Sydney
    expect(distance).toBeGreaterThan(0);
    expect(Number.isFinite(distance)).toBe(true);
  });
});

describe("distanceFromUserKm", () => {
  it("matches haversineDistanceKm for the same two points", () => {
    const event = { lat: 35.56, lon: 45.43 };
    const userFix = { lat: 36.19, lon: 44.01 };
    expect(distanceFromUserKm(event, userFix)).toBeCloseTo(
      haversineDistanceKm(event.lat, event.lon, userFix.lat, userFix.lon),
      6,
    );
  });

  it("returns ~0 when the user fix matches the event's own coordinates", () => {
    const point = { lat: 35.18, lon: 45.98 };
    expect(distanceFromUserKm(point, point)).toBeCloseTo(0, 5);
  });
});
