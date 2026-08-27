import {
  DEDUP_MAX_DISTANCE_KM,
  DEDUP_MAX_MAG_DELTA,
  DEDUP_MAX_TIME_DELTA_MS,
  findMatchingEvent,
  haversineDistanceKm,
  isSameEarthquake,
  sourceRecordChanged,
} from "../matching";
import type { CandidateEvent, RawSourceRecord, StoredSourceRecord } from "../types";

function candidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    eventId: "event-1",
    originTimeMs: 1_700_000_000_000,
    lat: 36.19,
    lon: 44.01, // Erbil-ish
    magnitude: 4.0,
    ...overrides,
  };
}

function record(overrides: Partial<RawSourceRecord> = {}): RawSourceRecord {
  return {
    provider: "emsc",
    providerEventId: "emsc-1",
    rawPayload: {},
    originTimeMs: 1_700_000_000_000,
    lat: 36.19,
    lon: 44.01,
    depthKm: 10,
    magnitude: 4.0,
    magType: "ml",
    place: "Erbil",
    authorAgency: "EMSC",
    magnitudeAuthor: "EMSC",
    reviewStatus: "automatic",
    providerUpdatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function storedRecord(overrides: Partial<StoredSourceRecord> = {}): StoredSourceRecord {
  return {
    sourceRecordId: "src-1",
    eventId: "event-1",
    provider: "emsc",
    providerEventId: "emsc-1",
    parsedOriginTimeMs: 1_700_000_000_000,
    parsedLat: 36.19,
    parsedLon: 44.01,
    parsedDepthKm: 10,
    parsedMagnitude: 4.0,
    parsedMagType: "ml",
    parsedPlace: "Erbil",
    authorAgency: "EMSC",
    magnitudeAuthor: "EMSC",
    reviewStatus: "automatic",
    fetchedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("haversineDistanceKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineDistanceKm(36.19, 44.01, 36.19, 44.01)).toBeCloseTo(0, 6);
  });

  it("matches a known great-circle distance (Erbil to Sulaymaniyah, ~150km)", () => {
    const km = haversineDistanceKm(36.19, 44.01, 35.56, 45.43);
    expect(km).toBeGreaterThan(120);
    expect(km).toBeLessThan(170);
  });
});

describe("isSameEarthquake", () => {
  it("matches within all three thresholds (inclusive)", () => {
    const c = candidate();
    const r = record({
      originTimeMs: c.originTimeMs + DEDUP_MAX_TIME_DELTA_MS,
      magnitude: (c.magnitude as number) + DEDUP_MAX_MAG_DELTA,
      lat: c.lat, // keep distance at 0 so only time/mag are being tested
    });
    expect(isSameEarthquake(c, r)).toBe(true);
  });

  it("rejects a time delta just over the threshold", () => {
    const c = candidate();
    const r = record({ originTimeMs: c.originTimeMs + DEDUP_MAX_TIME_DELTA_MS + 1 });
    expect(isSameEarthquake(c, r)).toBe(false);
  });

  it("rejects a magnitude delta just over the threshold", () => {
    const c = candidate();
    const r = record({ magnitude: (c.magnitude as number) + DEDUP_MAX_MAG_DELTA + 0.01 });
    expect(isSameEarthquake(c, r)).toBe(false);
  });

  it(`rejects a distance beyond ${DEDUP_MAX_DISTANCE_KM}km`, () => {
    const c = candidate();
    // ~1 degree of longitude near this latitude is well over 100km.
    const r = record({ lon: c.lon + 2 });
    expect(isSameEarthquake(c, r)).toBe(false);
  });

  it("skips the magnitude guard when the candidate has no magnitude (e.g. a crowd-detected 'possible' event)", () => {
    const c = candidate({ magnitude: null });
    const r = record({ magnitude: 6.5 }); // wildly different, would fail a magnitude check
    expect(isSameEarthquake(c, r)).toBe(true);
  });
});

describe("findMatchingEvent", () => {
  it("returns null when no candidate matches", () => {
    const candidates = [candidate({ eventId: "a" }), candidate({ eventId: "b", lon: 50 })];
    const r = record({ lon: 50, originTimeMs: candidate().originTimeMs + 100_000 });
    expect(findMatchingEvent(candidates, r)).toBeNull();
  });

  it("picks the closest-in-time candidate among multiple matches", () => {
    const near = candidate({ eventId: "near", originTimeMs: 1_700_000_000_000 });
    const far = candidate({ eventId: "far", originTimeMs: 1_700_000_010_000 });
    const r = record({ originTimeMs: 1_700_000_001_000 });
    const result = findMatchingEvent([far, near], r);
    expect(result?.eventId).toBe("near");
  });
});

describe("sourceRecordChanged", () => {
  it("is false for an identical re-fetch", () => {
    const stored = storedRecord();
    const incoming = record();
    expect(sourceRecordChanged(stored, incoming)).toBe(false);
  });

  it("is true when the magnitude value changed (a revision)", () => {
    const stored = storedRecord();
    const incoming = record({ magnitude: 4.3 });
    expect(sourceRecordChanged(stored, incoming)).toBe(true);
  });

  it("is true when review_status advanced from automatic to reviewed (no timestamp change, e.g. ISC/GEOFON)", () => {
    const stored = storedRecord({ reviewStatus: "automatic" });
    const incoming = record({ reviewStatus: "reviewed" });
    expect(sourceRecordChanged(stored, incoming)).toBe(true);
  });

  it("is true when the magnitude author changed (e.g. ISC's MagAuthor differing from Author)", () => {
    const stored = storedRecord({ magnitudeAuthor: "AFAD" });
    const incoming = record({ magnitudeAuthor: "ISK" });
    expect(sourceRecordChanged(stored, incoming)).toBe(true);
  });
});
