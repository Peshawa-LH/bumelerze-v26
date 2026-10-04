import { encodeGeohash } from "@/lib/felt-aggregation/geohash";

import { areaCityName, geohashCenter } from "../area";

describe("geohashCenter", () => {
  it("returns the middle of the cell, inside ~3 km of the encoded point", () => {
    const hash = encodeGeohash(35.56, 45.43, 5);
    const center = geohashCenter(hash);
    expect(Math.abs(center.lat - 35.56)).toBeLessThan(0.03);
    expect(Math.abs(center.lon - 45.43)).toBeLessThan(0.03);
  });
});

describe("areaCityName", () => {
  it("names the nearest gazetteer city in each locale", () => {
    const hash = encodeGeohash(35.57, 45.44, 5); // a few km from Slemani
    expect(areaCityName(hash, "en")).toBe("Slemani");
    expect(areaCityName(hash, "ckb")).toBe("سلێمانی");
    expect(areaCityName(hash, "kmr")).toBe("Silêmanî");
    expect(areaCityName(hash, "ar")).toBe("السليمانية");
  });

  it("is null without an area, with a malformed hash, or far from every city", () => {
    expect(areaCityName(null, "en")).toBeNull();
    expect(areaCityName("", "en")).toBeNull();
    expect(areaCityName("!!!!!", "en")).toBeNull();
    // Berlin
    expect(areaCityName(encodeGeohash(52.52, 13.4, 5), "en")).toBeNull();
  });
});
