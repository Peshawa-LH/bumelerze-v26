import { nearbySoilPoints } from "../soil-nearest";
import { SOIL_POINTS } from "../data";
import type { SoilPoint } from "../types";

const NEAR: SoilPoint = {
  id: "near",
  method: "hvsr",
  lat: 35.56,
  lon: 45.43,
  ec8: "B",
  nehrp: "C",
  vs30EstimateMS: 450,
};

const FAR: SoilPoint = {
  id: "far",
  method: "borehole",
  lat: 36.19,
  lon: 44.01,
  ec8: "C",
  nehrp: "D",
  vs30EstimateMS: null,
};

describe("nearbySoilPoints", () => {
  it("returns points within the search radius, nearest first", () => {
    const result = nearbySoilPoints(35.561, 45.431, [FAR, NEAR]);
    expect(result).toHaveLength(1);
    expect(result[0]?.point.id).toBe("near");
    expect(result[0]?.distanceKm).toBeLessThan(1);
  });

  it("returns an empty array (not null) when nothing is within range", () => {
    const result = nearbySoilPoints(0, 0, [NEAR, FAR]);
    expect(result).toEqual([]);
  });

  it("sorts multiple in-range points by ascending distance", () => {
    // "near" sits exactly at the query point (distance 0); "farther" is a
    // fraction of a degree off — still well within the 15 km radius, but
    // strictly farther than "near".
    const farther: SoilPoint = { ...NEAR, id: "farther", lat: 35.61, lon: 45.47 };
    const result = nearbySoilPoints(35.56, 45.43, [FAR, NEAR, farther]);
    expect(result.map((r) => r.point.id)).toEqual(["near", "farther"]);
  });
});

describe("nearbySoilPoints against the real bundled Sulaimani dataset", () => {
  it("finds real points near central Sulaimani and none near Erbil", () => {
    const suli = nearbySoilPoints(35.56, 45.43, SOIL_POINTS);
    expect(suli.length).toBeGreaterThan(0);
    for (const entry of suli) {
      expect(entry.distanceKm).toBeLessThanOrEqual(15);
    }

    const erbil = nearbySoilPoints(36.19, 44.01, SOIL_POINTS);
    expect(erbil).toEqual([]);
  });
});
