import { lookupHandbookData } from "../lookup";
import { VS30_GRID } from "../data";

describe("lookupHandbookData", () => {
  it("returns a fully populated result for a real Kurdistan coordinate (Sulaimani)", () => {
    const result = lookupHandbookData(35.56, 45.43);

    expect(result.pgaZone).not.toBeNull();
    expect(result.pgaZone?.pgaG).toBeGreaterThan(0);
    expect(result.vs30MS).not.toBeNull();
    expect(result.vs30Citation).toBe(VS30_GRID.citation);
    expect(result.vs30Citation.length).toBeGreaterThan(0);
    expect(result.siteClass).not.toBeNull();
    expect(result.siteClass?.ec8).toMatch(/^[ABCD]$/);
    expect(result.nearbySoilPoints.length).toBeGreaterThan(0);
  });

  it("honestly reports the outside-Iraq state for a far-away coordinate (Paris) — every layer null/empty, never a fabricated fallback", () => {
    const result = lookupHandbookData(48.8566, 2.3522);

    expect(result.pgaZone).toBeNull();
    expect(result.vs30MS).toBeNull();
    expect(result.siteClass).toBeNull();
    expect(result.nearbySoilPoints).toEqual([]);
    // Even in the outside-coverage state, the Vs30 citation string is
    // still surfaced (it's a static property of the bundled grid, not of
    // the query) — never dropped just because no value was sampled.
    expect(result.vs30Citation.length).toBeGreaterThan(0);
  });

  it("can partially populate — a coordinate inside PGA zonation but far from any Sulaimani soil point", () => {
    const result = lookupHandbookData(36.19, 44.01); // Erbil
    expect(result.pgaZone).not.toBeNull();
    expect(result.vs30MS).not.toBeNull();
    expect(result.nearbySoilPoints).toEqual([]);
  });
});
