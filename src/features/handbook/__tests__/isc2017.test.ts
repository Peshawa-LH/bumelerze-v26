import { ISC2017_ZONES } from "../data";
import { readHazard, HAZARD_SOURCES, DEFAULT_HAZARD_SOURCE } from "../hazard-source";
import { lookupIsc2017 } from "../isc2017";

/**
 * Run against the real bundled JSON, like `isc2025.test.ts`: the thing
 * worth protecting is the shipped data. It is generated from three
 * shapefiles by `bumelerze-engine/scripts/build_isc2017_hazard.py`, and a
 * regression there (a swapped quantity, a rescaled band) would otherwise
 * reach engineers as plausible wrong numbers.
 */

describe("bundled ISC-2017 zonation", () => {
  it("is the 2475-year hazard, matching the 2025 basis", () => {
    expect(ISC2017_ZONES.returnPeriodYears).toBe(2475);
  });

  it("ships exactly the bands each figure prints", () => {
    const bands = (q: "ss" | "s1" | "pga") =>
      [...new Set(ISC2017_ZONES.quantities[q].map((b) => b.valueG))].sort((a, b) => a - b);
    expect(bands("ss")).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
    expect(bands("s1")).toEqual([0.05, 0.1, 0.2, 0.3]);
    expect(bands("pga")).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });

  it("keeps S1 below Ss everywhere, as a spectrum requires", () => {
    for (const [lat, lon] of [
      [35.56, 45.43],
      [33.31, 44.36],
      [36.34, 43.13],
      [30.51, 47.78],
      [33.04, 40.28],
    ] as const) {
      const found = lookupIsc2017(lat, lon);
      if (found.values) {
        expect(found.values.s12475).toBeLessThan(found.values.ss2475);
      }
    }
  });

  it("agrees with the printed Ss figure at cities read off it by hand", () => {
    // Read from Figure 2-2/1(a) directly: this is the check that the
    // shapefile whose columns are named MaxObsInt/MaxObsVal really is Ss.
    const cases: [string, number, number, string][] = [
      ["Rutba", 33.038, 40.284, "I"],
      ["Baghdad", 33.31, 44.36, "III"],
      ["Mosul", 36.34, 43.13, "VI"],
      ["Sulaimani", 35.56, 45.43, "VII"],
    ];
    for (const [, lat, lon, zone] of cases) {
      expect(lookupIsc2017(lat, lon).ssBand?.zone).toBe(zone);
    }
  });

  it("returns nothing rather than a partial spectrum off the map", () => {
    const found = lookupIsc2017(48.8566, 2.3522);
    expect(found.values).toBeNull();
  });
});

describe("hazard source selection", () => {
  it("defaults to 2025, the owner's call, not to the edition in force", () => {
    expect(DEFAULT_HAZARD_SOURCE).toBe("isc2025");
    expect(HAZARD_SOURCES.find((s) => s.id === "isc2017")?.inForce).toBe(true);
  });

  it("answers the same coordinate from either source", () => {
    for (const source of HAZARD_SOURCES) {
      const reading = readHazard(source.id, 35.56, 45.43);
      expect(reading.values).not.toBeNull();
      expect(reading.zoneLabel).not.toBeNull();
    }
  });

  it("labels 2017 as banded and 2025 as interpolated", () => {
    expect(readHazard("isc2017", 35.56, 45.43).source.resolution).toBe("banded");
    expect(readHazard("isc2025", 35.56, 45.43).source.resolution).toBe("interpolated");
  });

  it("gives every site in one band the identical value", () => {
    // The defining property of a banded source, and the reason the report
    // has to say which kind of answer it gave.
    const a = readHazard("isc2017", 33.31, 44.36).values;
    const b = readHazard("isc2017", 33.15, 44.6).values;
    expect(a).toEqual(b);
  });

  it("feeds Eurocode 8 the closest ag each source publishes", () => {
    // 2025 has a 1000-year PGA; 2017 publishes only 2475, which is further
    // from EC8's own 475-year basis, and the UI says so.
    expect(readHazard("isc2025", 35.56, 45.43).ec8Ag?.returnPeriodYears).toBe(1000);
    expect(readHazard("isc2017", 35.56, 45.43).ec8Ag?.returnPeriodYears).toBe(2475);
  });
});
