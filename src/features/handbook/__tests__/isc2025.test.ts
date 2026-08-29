import { ISC2025_DISTRICTS, ISC2025_SS_ZONES } from "../data";
import { lookupIsc2025, lookupSsZone, nearestIsc2025District } from "../isc2025";

/**
 * These run against the REAL bundled JSON rather than fixtures, because the
 * thing most worth protecting is the data itself: it is generated from two
 * PDFs by `bumelerze-engine/scripts/build_isc2025_hazard.py`, and a silent
 * regression in that pipeline (a shifted column, a re-fitted projection, a
 * changed class break) would otherwise reach engineers as plausible wrong
 * numbers. The engine has its own tests for the extraction logic; these
 * assert what actually shipped.
 */

const CLASS_BREAKS: Record<string, [number, number]> = {
  I: [0.0, 0.25],
  II: [0.25, 0.55],
  III: [0.55, 0.95],
  IV: [0.95, 1.35],
  V: [1.35, 2.0],
};

describe("bundled ISC-2025 data", () => {
  it("carries all 79 districts across all 18 governorates", () => {
    expect(ISC2025_DISTRICTS).toHaveLength(79);
    expect(new Set(ISC2025_DISTRICTS.map((d) => d.governorate)).size).toBe(18);
  });

  it("ships one traced ring per zone band", () => {
    expect(new Set(ISC2025_SS_ZONES.map((z) => z.zone))).toEqual(
      new Set(["I", "II", "III", "IV", "V"]),
    );
  });

  it("puts every district's own Ss inside its own labelled band", () => {
    for (const d of ISC2025_DISTRICTS) {
      const band = CLASS_BREAKS[d.zone];
      expect(band).toBeDefined();
      expect(d.ss2475G).toBeGreaterThan(band![0] - 1e-9);
      expect(d.ss2475G).toBeLessThanOrEqual(band![1] + 1e-9);
    }
  });

  it("keeps every coordinate inside Iraq and every value ordered", () => {
    for (const d of ISC2025_DISTRICTS) {
      expect(d.lat).toBeGreaterThan(28.5);
      expect(d.lat).toBeLessThan(38);
      expect(d.lon).toBeGreaterThan(38);
      expect(d.lon).toBeLessThan(49.5);
      // The 2475-year hazard can equal but never fall below the 1000-year
      // one; equality is legitimate at two decimals where hazard is lowest.
      expect(d.ss2475G).toBeGreaterThanOrEqual(d.ss1000G);
      expect(d.s12475G).toBeGreaterThanOrEqual(d.s11000G);
      expect(d.s12475G).toBeLessThanOrEqual(d.ss2475G);
    }
  });

  /**
   * A guard, not an endorsement. The published table holds `Ss = 5 x PGA`
   * and `S1 = 2 x PGA` by construction, which is why `pga2475G` must never
   * be shown as a ground acceleration (see `types.ts`). Pinning the ratios
   * means that if a future source genuinely computes PGA independently,
   * this test fails and the "do not display" reasoning gets revisited
   * rather than silently outliving its cause.
   */
  it("still shows PGA and S1 as fixed fractions of Ss", () => {
    const measurable = ISC2025_DISTRICTS.filter((d) => d.pga2475G >= 0.05);
    expect(measurable.length).toBeGreaterThan(50);
    for (const d of measurable) {
      expect(d.ss2475G / d.pga2475G).toBeCloseTo(5, 0);
      expect(d.s12475G / d.pga2475G).toBeCloseTo(2, 0);
    }
  });
});

describe("nearestIsc2025District", () => {
  it("returns each district itself, at zero distance, for its own coordinate", () => {
    for (const d of ISC2025_DISTRICTS) {
      const hit = nearestIsc2025District(d.lat, d.lon);
      expect(hit?.district.id).toBe(d.id);
      expect(hit?.distanceKm).toBeLessThan(0.001);
    }
  });

  it("finds Zakho from a point just outside it", () => {
    const hit = nearestIsc2025District(37.13, 42.75);
    expect(hit?.district.nameEn).toBe("Zakho");
    expect(hit?.district.ss2475G).toBe(1.8);
    expect(hit?.distanceKm).toBeLessThan(5);
  });

  it("still answers far outside Iraq, so the caller must read distanceKm", () => {
    // Paris. The nearest district is meaningless here; the contract is that
    // the distance says so rather than the value being suppressed.
    const hit = nearestIsc2025District(48.8566, 2.3522);
    expect(hit).not.toBeNull();
    expect(hit!.distanceKm).toBeGreaterThan(3000);
  });
});

describe("lookupSsZone", () => {
  it("places Sulaimani in a Zagros-front band, not the desert band", () => {
    const zone = lookupSsZone(35.56, 45.43);
    expect(zone).not.toBeNull();
    expect(["III", "IV", "V"]).toContain(zone!.zone);
  });

  it("places the western desert in the lowest band", () => {
    // Rutba, Ss 0.08 g in the table.
    expect(lookupSsZone(33.038, 40.284)?.zone).toBe("I");
  });

  it("returns null outside the mapped zonation rather than guessing", () => {
    expect(lookupSsZone(48.8566, 2.3522)).toBeNull();
  });

  it("agrees with the published band for the great majority of districts", () => {
    // Not 79/79: five districts sit within 0.03 g of a class break, where
    // the sheet's painted band and the table's rounded value disagree, and
    // one (Um Qasr) is on the southern coastal tip the traced rings stop
    // short of. The engine report lists all six by name. The district table
    // is authoritative at a district; the band exists for everywhere else.
    const agree = ISC2025_DISTRICTS.filter(
      (d) => lookupSsZone(d.lat, d.lon)?.zone === d.zone,
    ).length;
    expect(agree).toBeGreaterThanOrEqual(72);
  });
});

describe("lookupIsc2025", () => {
  it("returns both answers without merging them", () => {
    const result = lookupIsc2025(35.196, 45.733);
    expect(result.nearestDistrict?.district.nameEn).toBe("Derbendikhan");
    expect(result.zone?.zone).toBeDefined();
  });
});
