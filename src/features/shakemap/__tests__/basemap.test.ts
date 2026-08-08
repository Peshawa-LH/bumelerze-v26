import { BASEMAP_BBOX, BASEMAP_BORDERS, BASEMAP_COASTLINE } from "../basemap/basemap";

// Fixture was trimmed with a 2° pad around BASEMAP_BBOX (README.md) — every
// committed point must fall inside that padded box, otherwise the fixture
// wasn't actually clipped to its documented extent.
const PAD = 2;
const PADDED = {
  minLon: BASEMAP_BBOX.minLon - PAD,
  maxLon: BASEMAP_BBOX.maxLon + PAD,
  minLat: BASEMAP_BBOX.minLat - PAD,
  maxLat: BASEMAP_BBOX.maxLat + PAD,
};

function assertAllPointsWithin(lines: readonly (readonly (readonly [number, number])[])[]) {
  for (const line of lines) {
    for (const [lon, lat] of line) {
      expect(lon).toBeGreaterThanOrEqual(PADDED.minLon);
      expect(lon).toBeLessThanOrEqual(PADDED.maxLon);
      expect(lat).toBeGreaterThanOrEqual(PADDED.minLat);
      expect(lat).toBeLessThanOrEqual(PADDED.maxLat);
    }
  }
}

describe("basemap fixture", () => {
  it("declares the documented Kurdistan-region bbox", () => {
    expect(BASEMAP_BBOX).toEqual({ minLon: 35, maxLon: 55, minLat: 25, maxLat: 45 });
  });

  it("loads a non-trivial number of border-line pieces", () => {
    expect(BASEMAP_BORDERS.length).toBeGreaterThan(10);
  });

  it("loads a non-trivial number of coastline pieces", () => {
    expect(BASEMAP_COASTLINE.length).toBeGreaterThan(5);
  });

  it("every border line has at least two points (a real polyline, not a stray dot)", () => {
    for (const line of BASEMAP_BORDERS) {
      expect(line.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("every coastline piece has at least two points", () => {
    for (const line of BASEMAP_COASTLINE) {
      expect(line.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps every border point inside the padded trim bbox (bbox-trim integrity)", () => {
    assertAllPointsWithin(BASEMAP_BORDERS);
  });

  it("keeps every coastline point inside the padded trim bbox (bbox-trim integrity)", () => {
    assertAllPointsWithin(BASEMAP_COASTLINE);
  });
});
