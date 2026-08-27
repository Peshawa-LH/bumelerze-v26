import { corroborationCount } from "../corroboration";
import type { StoredSourceRecord } from "../types";

function record(overrides: Partial<StoredSourceRecord>): StoredSourceRecord {
  return {
    sourceRecordId: "src",
    eventId: "event-1",
    provider: "emsc",
    providerEventId: "id",
    parsedOriginTimeMs: 0,
    parsedLat: 0,
    parsedLon: 0,
    parsedDepthKm: null,
    parsedMagnitude: null,
    parsedMagType: null,
    parsedPlace: null,
    authorAgency: null,
    magnitudeAuthor: null,
    reviewStatus: "automatic",
    fetchedAtMs: 0,
    ...overrides,
  };
}

describe("corroborationCount", () => {
  it("counts a single GEOFON-only sighting with no author as 1 (falls back to the provider tag)", () => {
    expect(corroborationCount([record({ provider: "geofon", authorAgency: null })])).toBe(1);
  });

  it("counts three DIFFERENT agencies as 3 (\"located by ISN, EMSC and USGS\")", () => {
    const count = corroborationCount([
      record({ provider: "isc", authorAgency: "ISN" }),
      record({ provider: "emsc", authorAgency: "EMSC" }),
      record({ provider: "usgs", authorAgency: "NEIC" }),
    ]);
    expect(count).toBe(3);
  });

  it("counts an EMSC-relayed AFAD record and a direct AFAD-authored record as ONE agency", () => {
    const count = corroborationCount([
      record({ provider: "emsc", authorAgency: "AFAD" }),
      record({ provider: "isc", authorAgency: "AFAD" }),
    ]);
    expect(count).toBe(1);
  });

  it("is case-insensitive across records", () => {
    const count = corroborationCount([
      record({ provider: "emsc", authorAgency: "afad" }),
      record({ provider: "isc", authorAgency: "AFAD" }),
    ]);
    expect(count).toBe(1);
  });

  it("excludes deleted source records", () => {
    const count = corroborationCount([
      record({ provider: "emsc", authorAgency: "EMSC" }),
      record({ provider: "isc", authorAgency: "ISN", reviewStatus: "deleted" }),
    ]);
    expect(count).toBe(1);
  });
});
