import { DEFAULT_MAP_SCOPE, MAP_SCOPES, WORLD_VIEW_BBOX } from "../scope";

describe("scope", () => {
  it("lists exactly kurdistan and world, kurdistan first", () => {
    expect(MAP_SCOPES).toEqual(["kurdistan", "world"]);
  });

  it("defaults to kurdistan (region-first principle, D11/D26)", () => {
    expect(DEFAULT_MAP_SCOPE).toBe("kurdistan");
  });

  it("gives the world-view bbox sane, non-degenerate bounds", () => {
    expect(WORLD_VIEW_BBOX.minLat).toBeLessThan(WORLD_VIEW_BBOX.maxLat);
    expect(WORLD_VIEW_BBOX.minLon).toBeLessThan(WORLD_VIEW_BBOX.maxLon);
    // Within valid lat/lon ranges.
    expect(WORLD_VIEW_BBOX.minLat).toBeGreaterThanOrEqual(-90);
    expect(WORLD_VIEW_BBOX.maxLat).toBeLessThanOrEqual(90);
    expect(WORLD_VIEW_BBOX.minLon).toBeGreaterThanOrEqual(-180);
    expect(WORLD_VIEW_BBOX.maxLon).toBeLessThanOrEqual(180);
  });
});
