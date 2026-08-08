import { lookupPgaZone, pointInRing } from "../point-in-polygon";
import { PGA_ZONES } from "../data";
import type { PgaZone } from "../types";

// Simple closed unit square [0,0]-[1,0]-[1,1]-[0,1]-[0,0], as [lon, lat] pairs.
const SQUARE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

describe("pointInRing", () => {
  it("is true for a point well inside the ring", () => {
    expect(pointInRing(0.5, 0.5, SQUARE)).toBe(true);
  });

  it("is false for a point well outside the ring", () => {
    expect(pointInRing(5, 5, SQUARE)).toBe(false);
  });

  it("is false for a point outside on one axis only", () => {
    expect(pointInRing(0.5, 5, SQUARE)).toBe(false);
    expect(pointInRing(5, 0.5, SQUARE)).toBe(false);
  });
});

describe("lookupPgaZone", () => {
  const ZONE_LOW: PgaZone = { zone: "I", pgaG: 0.1, ring: SQUARE };
  const ZONE_HIGH: PgaZone = {
    zone: "VII",
    pgaG: 0.7,
    ring: [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 11],
      [10, 10],
    ],
  };

  it("returns the zone containing the point", () => {
    expect(lookupPgaZone(0.5, 0.5, [ZONE_LOW, ZONE_HIGH])).toEqual(ZONE_LOW);
    expect(lookupPgaZone(10.5, 10.5, [ZONE_LOW, ZONE_HIGH])).toEqual(ZONE_HIGH);
  });

  it("returns null when the point is outside every zone (honest 'outside zonation' state)", () => {
    expect(lookupPgaZone(50, 50, [ZONE_LOW, ZONE_HIGH])).toBeNull();
  });

  it("returns null for an empty zone list", () => {
    expect(lookupPgaZone(0.5, 0.5, [])).toBeNull();
  });
});

describe("lookupPgaZone against the real bundled Iraqi Code 2017 zonation", () => {
  it("places Erbil, Sulaimani, Halabja, and Duhok in plausible zones", () => {
    const erbil = lookupPgaZone(36.19, 44.01, PGA_ZONES);
    const sulaimani = lookupPgaZone(35.56, 45.43, PGA_ZONES);
    const halabja = lookupPgaZone(35.18, 45.98, PGA_ZONES);
    const duhok = lookupPgaZone(36.87, 42.99, PGA_ZONES);

    expect(erbil?.zone).toBe("IV");
    expect(sulaimani?.zone).toBe("V");
    expect(halabja?.zone).toBe("VI");
    expect(duhok?.zone).toBe("V");

    // Zagros-adjacent Halabja carries a strictly higher design PGA than
    // Erbil, matching the region's known seismic-hazard gradient.
    expect(halabja?.pgaG).toBeGreaterThan(erbil?.pgaG ?? 0);
  });

  it("returns null far outside Iraq (e.g. Paris) — outside-zonation state", () => {
    expect(lookupPgaZone(48.8566, 2.3522, PGA_ZONES)).toBeNull();
  });

  it("every bundled zone has a non-empty closed ring", () => {
    for (const zone of PGA_ZONES) {
      expect(zone.ring.length).toBeGreaterThan(3);
      const first = zone.ring[0];
      const last = zone.ring[zone.ring.length - 1];
      expect(first).toEqual(last);
    }
  });
});
