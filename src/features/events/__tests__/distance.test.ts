import { REGION_ANCHORS } from "../config";
import { haversineDistanceKm, nearestAnchor } from "../distance";

describe("haversineDistanceKm", () => {
  it("returns ~0 for identical coordinates", () => {
    expect(haversineDistanceKm(36.19, 44.01, 36.19, 44.01)).toBeCloseTo(0, 5);
  });

  it("matches a known great-circle distance (Erbil to Slemani, ~150km) within tolerance", () => {
    const erbil = REGION_ANCHORS.find((a) => a.id === "erbil")!;
    const slemani = REGION_ANCHORS.find((a) => a.id === "slemani")!;
    const distance = haversineDistanceKm(erbil.lat, erbil.lon, slemani.lat, slemani.lon);
    // Straight-line distance, not driving distance — loose tolerance.
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(200);
  });
});

describe("nearestAnchor", () => {
  it("picks the anchor whose own coordinates are given (distance ~0)", () => {
    for (const anchor of REGION_ANCHORS) {
      const result = nearestAnchor(anchor.lat, anchor.lon);
      expect(result.anchor.id).toBe(anchor.id);
      expect(result.distanceKm).toBeCloseTo(0, 4);
    }
  });

  it("picks Slemani for a point much closer to Slemani than Erbil or Duhok", () => {
    // A few km south-east of Slemani, well away from the other two anchors.
    const result = nearestAnchor(35.5, 45.5);
    expect(result.anchor.id).toBe("slemani");
  });

  it("picks Duhok for a point near Duhok", () => {
    const result = nearestAnchor(36.9, 43.0);
    expect(result.anchor.id).toBe("duhok");
  });

  it("always returns a real anchor and a non-negative distance — never '?' or a blank value (spec-v1.md §4.1)", () => {
    // A point far from all three anchors (e.g. an EMSC/Iranian-side event
    // near the eastern edge of the region bbox) must still resolve to the
    // nearest of the three, never a missing/undefined result.
    const result = nearestAnchor(34.0, 48.0);
    expect(REGION_ANCHORS.map((a) => a.id)).toContain(result.anchor.id);
    expect(result.distanceKm).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.distanceKm)).toBe(true);
  });
});
