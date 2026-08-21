import { isolateNumeric } from "@/features/events";
import i18n from "@/i18n";
import {
  formatNearbySoilSummary,
  formatNearestSoilPoint,
  formatSiteClassValue,
  formatVs30Value,
} from "../format";
import type { NearbySoilPoint } from "../types";

describe("formatVs30Value", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("rounds to the nearest 25 m/s rather than showing nearest-1 false precision (owner feedback 2026-08-21)", () => {
    // 467 -> 18.68 * 25 -> rounds to 19 * 25 = 475, not 467.
    expect(formatVs30Value(467, "en", i18n.t)).toBe(`≈${isolateNumeric("475")} m/s`);
    expect(formatVs30Value(180, "en", i18n.t)).toBe(`≈${isolateNumeric("175")} m/s`);
    expect(formatVs30Value(200, "en", i18n.t)).toBe(`≈${isolateNumeric("200")} m/s`);
  });

  it("digit-localizes the rounded numeral for ckb", async () => {
    await i18n.changeLanguage("ckb");
    expect(formatVs30Value(467, "ckb", i18n.t)).toBe(`≈${isolateNumeric("٤٧٥")} م/چ`);
  });
});

describe("formatSiteClassValue", () => {
  it("shows EC8 only, never NEHRP (owner feedback 2026-08-21: fewer numbers)", () => {
    expect(formatSiteClassValue("B", i18n.t)).toBe("EC8 B");
    expect(formatSiteClassValue("B", i18n.t)).not.toMatch(/NEHRP/);
  });
});

describe("formatNearestSoilPoint", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  const hvsrPoint: NearbySoilPoint = {
    point: {
      id: "SP10-RC878-2022",
      method: "hvsr",
      lat: 35.5763,
      lon: 45.4196,
      ec8: "C",
      nehrp: "D",
      vs30EstimateMS: 467,
    },
    distanceKm: 1.9,
  };

  it("shows method, distance, and EC8 class, never a per-point Vs30 numeral", () => {
    const line = formatNearestSoilPoint(hvsrPoint, "en", i18n.t);
    expect(line).toContain("H/V spectral ratio");
    expect(line).toContain("EC8 C");
    expect(line).not.toMatch(/m\/s/);
    expect(line).not.toContain("467");
  });

  it("falls back to a class-free line when the point has no EC8 (defensive: the bundled dataset never actually has this)", () => {
    const noClassPoint: NearbySoilPoint = {
      point: { ...hvsrPoint.point, ec8: null },
      distanceKm: 1.9,
    };
    const line = formatNearestSoilPoint(noClassPoint, "en", i18n.t);
    expect(line).not.toContain("EC8");
    expect(line).toContain("H/V spectral ratio");
  });
});

describe("formatNearbySoilSummary", () => {
  it("states the total count and the fixed search radius", () => {
    expect(formatNearbySoilSummary(1, "en", i18n.t)).toBe(
      `${isolateNumeric("1")} field points within ${isolateNumeric("15")} km`,
    );
    expect(formatNearbySoilSummary(303, "en", i18n.t)).toBe(
      `${isolateNumeric("303")} field points within ${isolateNumeric("15")} km`,
    );
  });

  // Regression (browser RTL check, 2026-08-22): both numerals used to be
  // interpolated raw, so a Sorani reader saw Latin "303"/"15" inside a
  // sentence whose every other numeral was Eastern Arabic-Indic.
  it("localizes both numerals for Eastern Arabic-Indic locales", async () => {
    await i18n.changeLanguage("ckb");
    const line = formatNearbySoilSummary(303, "ckb", i18n.t);
    expect(line).toContain(isolateNumeric("٣٠٣"));
    expect(line).toContain(isolateNumeric("١٥"));
    expect(line).not.toMatch(/[0-9]/);
  });
});
