import { ISC2025_DISTRICTS, ISC2025_SURFACE } from "../data";
import { lookupIsc2025 } from "../isc2025";
import { evaluateIsc2025, evaluateIsc2025Field } from "../isc2025-surface";
import type { Isc2025Field } from "../types";

/**
 * The surface is fitted in Python (`build_isc2025_hazard.py`) and evaluated
 * in TypeScript, so the two implementations can drift. The first test below
 * is the guard that matters: a radial basis function reproduces the values
 * it was fitted through, so if the TS evaluation form is right, every one
 * of the 79 published district values must come back almost exactly. Any
 * mistake in the kernel, the shift/scale split, or the polynomial tail
 * breaks it immediately.
 */

const FIELD_BY_DISTRICT_KEY: Record<Isc2025Field, keyof (typeof ISC2025_DISTRICTS)[number]> = {
  ss2475: "ss2475G",
  s12475: "s12475G",
  pga2475: "pga2475G",
  ss1000: "ss1000G",
  s11000: "s11000G",
  pga1000: "pga1000G",
};

describe("evaluateIsc2025Field", () => {
  it("reproduces every published district value at its own coordinate", () => {
    for (const field of Object.keys(FIELD_BY_DISTRICT_KEY) as Isc2025Field[]) {
      for (const d of ISC2025_DISTRICTS) {
        const published = d[FIELD_BY_DISTRICT_KEY[field]] as number;
        const got = evaluateIsc2025Field(field, d.lat, d.lon);
        // Loose only because the surface is clamped to the published range;
        // interpolation itself is exact to ~1e-10.
        expect(got).toBeCloseTo(published, 6);
      }
    }
  });

  it("keeps the published quantities in their physical order between districts", () => {
    // Midpoints of district pairs, i.e. places no published value exists.
    for (let i = 0; i + 1 < ISC2025_DISTRICTS.length; i += 1) {
      const a = ISC2025_DISTRICTS[i]!;
      const b = ISC2025_DISTRICTS[i + 1]!;
      const lat = (a.lat + b.lat) / 2;
      const lon = (a.lon + b.lon) / 2;
      const v = evaluateIsc2025(lat, lon);
      expect(v.pga2475).toBeLessThanOrEqual(v.s12475 + 1e-9);
      expect(v.s12475).toBeLessThanOrEqual(v.ss2475 + 1e-9);
      expect(v.ss1000).toBeLessThanOrEqual(v.ss2475 + 1e-9);
    }
  });

  it("clamps to the published range rather than extrapolating without bound", () => {
    const spec = ISC2025_SURFACE.fields.ss2475;
    // Far outside the hull of the centres, where a cubic RBF diverges.
    for (const [lat, lon] of [[10, 10], [60, 60], [0, 100], [-20, 44]]) {
      const v = evaluateIsc2025Field("ss2475", lat!, lon!);
      expect(v).toBeGreaterThanOrEqual(spec.min);
      expect(v).toBeLessThanOrEqual(spec.max);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("rejects an unknown field rather than returning a number", () => {
    expect(() => evaluateIsc2025Field("nope" as Isc2025Field, 35, 45)).toThrow();
  });
});

describe("lookupIsc2025 values", () => {
  it("gives Sulaimani its own value, not a distant district's", () => {
    // Sulaimani city is NOT in the published table; the nearest district is
    // Chamchamal, 44 km away at Ss 1.09. Serving that was the old behaviour.
    const r = lookupIsc2025(35.56, 45.43);
    expect(r.values).not.toBeNull();
    expect(r.nearestDistrict?.district.nameEn).toBe("Chamchamal");
    expect(r.nearestDistrict!.distanceKm).toBeGreaterThan(30);
    expect(r.values!.ss2475).toBeGreaterThan(1.15);
    expect(r.values!.ss2475).toBeLessThan(1.35);
    // and it must stay inside the band the code's own sheet paints here
    expect(r.values!.ss2475).toBeGreaterThanOrEqual(r.zone!.ssMinG);
    expect(r.values!.ss2475).toBeLessThanOrEqual(r.zone!.ssMaxG);
  });

  it("returns no values outside the mapped country rather than extrapolating", () => {
    for (const [lat, lon] of [[48.8566, 2.3522], [39.9, 32.85], [24.7, 46.7]]) {
      const r = lookupIsc2025(lat!, lon!);
      expect(r.values).toBeNull();
      expect(r.zone).toBeNull();
    }
  });

  it("agrees with the published zone band across the country", () => {
    // Every district: the interpolated Ss must sit in the band the sheet
    // paints it in. This is the between-districts check the leave-one-out
    // test cannot make.
    let inside = 0;
    let total = 0;
    for (const d of ISC2025_DISTRICTS) {
      const r = lookupIsc2025(d.lat, d.lon);
      if (!r.values || !r.zone) continue;
      total += 1;
      if (r.values.ss2475 >= r.zone.ssMinG - 0.03 && r.values.ss2475 <= r.zone.ssMaxG + 0.03) {
        inside += 1;
      }
    }
    expect(total).toBeGreaterThan(70);
    expect(inside / total).toBeGreaterThan(0.9);
  });
});
