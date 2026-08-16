import { encodeGeohash } from "@/lib/felt-aggregation";
import { decodeGeohashBounds } from "../geohash-bounds";

describe("decodeGeohashBounds", () => {
  it("decodes the canonical geohash.org vector (u4pru, precision 5) to a box containing the source point", () => {
    const bounds = decodeGeohashBounds("u4pru");
    expect(bounds.minLat).toBeLessThanOrEqual(57.64911);
    expect(bounds.maxLat).toBeGreaterThanOrEqual(57.64911);
    expect(bounds.minLon).toBeLessThanOrEqual(10.40744);
    expect(bounds.maxLon).toBeGreaterThanOrEqual(10.40744);
  });

  it("decodes the Slemani p5 geohash (tn263) to a box containing (35.56, 45.43)", () => {
    const bounds = decodeGeohashBounds("tn263");
    expect(bounds.minLat).toBeLessThanOrEqual(35.56);
    expect(bounds.maxLat).toBeGreaterThanOrEqual(35.56);
    expect(bounds.minLon).toBeLessThanOrEqual(45.43);
    expect(bounds.maxLon).toBeGreaterThanOrEqual(45.43);
  });

  it("round-trips through encodeGeohash for a spread of points at p4/p5/p6", () => {
    const points: [number, number][] = [
      [35.53, 44.83], // Chamchamal
      [-33.45, -70.66], // Santiago (southern hemisphere, negative lon)
      [51.5, -0.12], // London
      [0.01, 0.01], // near origin
    ];

    for (const [lat, lon] of points) {
      for (const precision of [4, 5, 6]) {
        const hash = encodeGeohash(lat, lon, precision);
        const bounds = decodeGeohashBounds(hash);
        expect(lat).toBeGreaterThanOrEqual(bounds.minLat);
        expect(lat).toBeLessThanOrEqual(bounds.maxLat);
        expect(lon).toBeGreaterThanOrEqual(bounds.minLon);
        expect(lon).toBeLessThanOrEqual(bounds.maxLon);
      }
    }
  });

  it("a longer (finer) precision produces a strictly smaller-or-equal box nested inside the shorter one", () => {
    const p4 = decodeGeohashBounds(encodeGeohash(35.53, 44.83, 4));
    const p6 = decodeGeohashBounds(encodeGeohash(35.53, 44.83, 6));

    expect(p6.minLat).toBeGreaterThanOrEqual(p4.minLat);
    expect(p6.maxLat).toBeLessThanOrEqual(p4.maxLat);
    expect(p6.minLon).toBeGreaterThanOrEqual(p4.minLon);
    expect(p6.maxLon).toBeLessThanOrEqual(p4.maxLon);
  });

  it("returns the full-earth box for an empty string", () => {
    expect(decodeGeohashBounds("")).toEqual({
      minLat: -90,
      maxLat: 90,
      minLon: -180,
      maxLon: 180,
    });
  });

  it("stops at the first invalid character rather than throwing", () => {
    expect(() => decodeGeohashBounds("tn2!!")).not.toThrow();
  });
});
