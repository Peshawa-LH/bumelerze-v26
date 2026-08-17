import {
  kurdishPlacesSchema,
  parseKurdishPlaces,
  resolveKurdishPlaceName,
  type KurdishPlaceNames,
} from "../kurdish-places";

function makePlace(overrides: Record<string, unknown> = {}) {
  return {
    id: "n123",
    lat: 36.19,
    lon: 44.01,
    tier: 1,
    names: { ckb: "هەولێر", kmr: "Hewlêr", ar: "أربيل" },
    ...overrides,
  };
}

describe("kurdishPlacesSchema / parseKurdishPlaces", () => {
  it("accepts a well-formed dataset", () => {
    const data = [makePlace(), makePlace({ id: "n456", tier: 3, names: { ar: "قرية" } })];
    expect(parseKurdishPlaces(data)).toEqual(data);
  });

  it("throws on a record with no ckb/kmr/ar name at all", () => {
    expect(() => parseKurdishPlaces([makePlace({ names: {} })])).toThrow();
  });

  it("throws on a tier outside 1-2-3", () => {
    expect(() => parseKurdishPlaces([makePlace({ tier: 4 })])).toThrow();
    expect(() => parseKurdishPlaces([makePlace({ tier: 0 })])).toThrow();
  });

  it("throws on an out-of-range latitude/longitude", () => {
    expect(() => parseKurdishPlaces([makePlace({ lat: 91 })])).toThrow();
    expect(() => parseKurdishPlaces([makePlace({ lon: -181 })])).toThrow();
  });

  it("throws on a missing id", () => {
    expect(() => parseKurdishPlaces([makePlace({ id: "" })])).toThrow();
  });

  it("accepts an empty dataset (a lazy-load resolving to zero places is valid, not malformed)", () => {
    expect(parseKurdishPlaces([])).toEqual([]);
  });

  it("kurdishPlacesSchema is the same schema parseKurdishPlaces uses", () => {
    const data = [makePlace()];
    expect(kurdishPlacesSchema.parse(data)).toEqual(data);
  });
});

describe("resolveKurdishPlaceName", () => {
  const full: KurdishPlaceNames = { ckb: "سنە", kmr: "Sine", ar: "سنندج" };

  it("ckb locale prefers name:ckb", () => {
    expect(resolveKurdishPlaceName(full, "ckb")).toBe("سنە");
  });

  it("ckb locale falls back to name:ar, then name:ku, when ckb is missing", () => {
    expect(resolveKurdishPlaceName({ ar: "سنندج", kmr: "Sine" }, "ckb")).toBe("سنندج");
    expect(resolveKurdishPlaceName({ kmr: "Sine" }, "ckb")).toBe("Sine");
  });

  it("kmr locale prefers name:ku", () => {
    expect(resolveKurdishPlaceName(full, "kmr")).toBe("Sine");
  });

  it("kmr locale falls back to name:ar, then name:ckb, when kmr is missing", () => {
    expect(resolveKurdishPlaceName({ ar: "سنندج", ckb: "سنە" }, "kmr")).toBe("سنندج");
    expect(resolveKurdishPlaceName({ ckb: "سنە" }, "kmr")).toBe("سنە");
  });

  it("ar locale prefers name:ar", () => {
    expect(resolveKurdishPlaceName(full, "ar")).toBe("سنندج");
  });

  it("ar locale falls back to ckb, then kmr, when ar is missing", () => {
    expect(resolveKurdishPlaceName({ ckb: "سنە", kmr: "Sine" }, "ar")).toBe("سنە");
    expect(resolveKurdishPlaceName({ kmr: "Sine" }, "ar")).toBe("Sine");
  });

  it("an unlisted locale (e.g. en) falls back through ar, ckb, kmr in that order", () => {
    expect(resolveKurdishPlaceName(full, "en")).toBe("سنندج");
    expect(resolveKurdishPlaceName({ ckb: "سنە", kmr: "Sine" }, "en")).toBe("سنە");
    expect(resolveKurdishPlaceName({ kmr: "Sine" }, "en")).toBe("Sine");
  });

  it("a place that has ONLY name:ar resolves to it for every locale", () => {
    const arOnly: KurdishPlaceNames = { ar: "الفلوجة" };
    expect(resolveKurdishPlaceName(arOnly, "ckb")).toBe("الفلوجة");
    expect(resolveKurdishPlaceName(arOnly, "kmr")).toBe("الفلوجة");
    expect(resolveKurdishPlaceName(arOnly, "ar")).toBe("الفلوجة");
    expect(resolveKurdishPlaceName(arOnly, "en")).toBe("الفلوجة");
  });

  it("returns null when the record has none of the fallback chain's languages", () => {
    // Not constructible through `parseKurdishPlaces` (the schema's `refine`
    // rejects an empty `names` object) — this exercises the resolver's own
    // defensive fallback directly, as documented on its return type.
    expect(resolveKurdishPlaceName({}, "ckb")).toBeNull();
  });
});
