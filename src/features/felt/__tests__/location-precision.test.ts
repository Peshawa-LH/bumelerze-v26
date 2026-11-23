import { buildFeltReportInsert } from "../supabase-transport";
import { FELT_LOCATION_DECIMALS, roundFeltCoordinate } from "../location-precision";
import type { Tier1Report } from "../types";

/** Felt locations leave the app at about 100 m (migration 0083, audit PRIV-03). */
describe("roundFeltCoordinate", () => {
  it("rounds to three decimals (about 100 m)", () => {
    expect(FELT_LOCATION_DECIMALS).toBe(3);
    expect(roundFeltCoordinate(36.1915123)).toBe(36.192);
    expect(roundFeltCoordinate(44.0098765)).toBe(44.01);
    expect(roundFeltCoordinate(-44.0004999)).toBe(0 - 44);
    expect(roundFeltCoordinate(36.19)).toBe(36.19);
  });

  it("never returns minus zero and leaves non-numbers alone", () => {
    expect(Object.is(roundFeltCoordinate(-0.0001), 0)).toBe(true);
    expect(Number.isNaN(roundFeltCoordinate(Number.NaN))).toBe(true);
  });
});

describe("buildFeltReportInsert", () => {
  it("sends the location rounded, never the raw GPS fix", () => {
    const report = {
      reportId: "11111111-1111-4111-8111-111111111111",
      deviceId: "dev-1",
      cartoonLevel: 5,
      location: { quality: "gps", lat: 36.1915123, lon: 44.0098765 },
      createdAt: Date.parse("2026-11-23T10:00:00Z"),
    } as unknown as Tier1Report;
    const row = buildFeltReportInsert(report, null, null);
    expect(row.lat).toBe(36.192);
    expect(row.lon).toBe(44.01);
  });
});
