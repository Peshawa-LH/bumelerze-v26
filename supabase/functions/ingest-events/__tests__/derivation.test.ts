import {
  deriveCanonicalFields,
  locationAuthorityRank,
  magnitudeAuthorityRank,
} from "../derivation";
import type { StoredSourceRecord } from "../types";

function sourceRecord(overrides: Partial<StoredSourceRecord> = {}): StoredSourceRecord {
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

describe("locationAuthorityRank", () => {
  it("ranks the nearest-network tier (ISN/ISK/TEH/THR/AFAD) above ISC", () => {
    expect(locationAuthorityRank("ISN")).toBeLessThan(locationAuthorityRank("ISC"));
    expect(locationAuthorityRank("AFAD")).toBe(locationAuthorityRank("ISN"));
  });

  it("ranks ISC above IDC, and IDC above NEIC", () => {
    expect(locationAuthorityRank("ISC")).toBeLessThan(locationAuthorityRank("IDC"));
    expect(locationAuthorityRank("IDC")).toBeLessThan(locationAuthorityRank("NEIC"));
  });

  it("treats USGS's own 'US' network code as NEIC", () => {
    expect(locationAuthorityRank("US")).toBe(locationAuthorityRank("NEIC"));
  });

  it("is case-insensitive", () => {
    expect(locationAuthorityRank("isn")).toBe(locationAuthorityRank("ISN"));
  });

  it("falls back unranked agencies (and null) to the lowest priority, not a rejection", () => {
    expect(locationAuthorityRank("EMSC")).toBeGreaterThan(locationAuthorityRank("NEIC"));
    expect(locationAuthorityRank(null)).toBeGreaterThan(locationAuthorityRank("NEIC"));
  });
});

describe("magnitudeAuthorityRank", () => {
  it("prefers a reviewed Mw over a local ML (the plan's literal rule)", () => {
    const reviewedMw = magnitudeAuthorityRank("NEIC", "Mww", "reviewed");
    const localMl = magnitudeAuthorityRank("ISN", "ML", "automatic");
    expect(reviewedMw).toBeLessThan(localMl);
  });

  it("prefers a local nearest-network ML over any other reviewed magnitude", () => {
    const localMl = magnitudeAuthorityRank("ISN", "ML", "automatic");
    const otherReviewed = magnitudeAuthorityRank("IDC", "mb", "reviewed");
    expect(localMl).toBeLessThan(otherReviewed);
  });

  it("prefers any Mw (even unreviewed) over an unranked, unreviewed non-Mw magnitude", () => {
    const unreviewedMw = magnitudeAuthorityRank("GFZ", "Mw", "automatic");
    const unreviewedMb = magnitudeAuthorityRank("GFZ", "mb", "automatic");
    expect(unreviewedMw).toBeLessThan(unreviewedMb);
  });

  it("is a prefix test on the magnitude type, matching every Mw-family suffix (Mww, Mwr, Mwc, Mwp)", () => {
    for (const magType of ["Mw", "Mww", "Mwr", "Mwc", "Mwp"]) {
      expect(magnitudeAuthorityRank("NEIC", magType, "reviewed")).toBe(1);
    }
  });
});

describe("deriveCanonicalFields", () => {
  it("returns null when every source record is deleted", () => {
    const result = deriveCanonicalFields([sourceRecord({ reviewStatus: "deleted" })]);
    expect(result).toBeNull();
  });

  it("picks location/time/depth/place from the single available source when there is only one", () => {
    const only = sourceRecord({ parsedPlace: "5 km SSE of Darreh Shahr" });
    const result = deriveCanonicalFields([only]);
    expect(result?.locationSourceId).toBe(only.sourceRecordId);
    expect(result?.place).toBe("5 km SSE of Darreh Shahr");
    expect(result?.magnitudeSourceId).toBe(only.sourceRecordId);
  });

  it("prefers the nearest-network agency's location over EMSC's, per source-and-ingestion-plan.md §5.1", () => {
    const emscRecord = sourceRecord({
      sourceRecordId: "src-emsc",
      provider: "emsc",
      authorAgency: "EMSC",
      parsedLat: 36.2,
    });
    const isnRecord = sourceRecord({
      sourceRecordId: "src-isc-isn",
      provider: "isc",
      authorAgency: "ISN",
      parsedLat: 36.19,
    });
    const result = deriveCanonicalFields([emscRecord, isnRecord]);
    expect(result?.locationSourceId).toBe("src-isc-isn");
    expect(result?.lat).toBe(36.19);
  });

  it(
    "reads magnitude_author (not author_agency) when ranking magnitude — verified live ISC " +
      "bulletin row 643726562: Author=AFAD (location), MagAuthor=ISK (magnitude)",
    () => {
      // A single ISC row exactly as ingested: one author for the origin,
      // a DIFFERENT one for the magnitude — the concrete evidence behind
      // `event_source_records.magnitude_author` being its own column
      // (migration 0023), not a re-use of `author_agency`.
      const iscRow = sourceRecord({
        sourceRecordId: "src-afad-isk",
        provider: "isc",
        authorAgency: "AFAD",
        magnitudeAuthor: "ISK",
        parsedMagType: "ML",
        parsedMagnitude: 2.1,
        reviewStatus: "reviewed",
      });

      // Ranking the SAME row's magnitude by its magnitude_author (ISK, also
      // a nearest-network agency) must match calling the rank function with
      // "ISK" directly — proving the row's own author_agency (AFAD) plays
      // no part in the magnitude decision.
      expect(magnitudeAuthorityRank(iscRow.magnitudeAuthor, "ML", "reviewed")).toBe(
        magnitudeAuthorityRank("ISK", "ML", "reviewed"),
      );

      const result = deriveCanonicalFields([iscRow]);
      expect(result?.locationSourceId).toBe("src-afad-isk");
      expect(result?.magnitudeSourceId).toBe("src-afad-isk");
      expect(result?.magnitude).toBe(2.1);
      expect(result?.magType).toBe("ML");
    },
  );

  it("chooses the reviewed-Mw record for magnitude even when a different record has the preferred location", () => {
    const localOrigin = sourceRecord({
      sourceRecordId: "src-local",
      authorAgency: "ISN",
      magnitudeAuthor: "ISN",
      parsedMagType: "ML",
      parsedMagnitude: 4.1,
      reviewStatus: "automatic",
    });
    const reviewedMw = sourceRecord({
      sourceRecordId: "src-gcmt",
      authorAgency: "NEIC",
      magnitudeAuthor: "NEIC",
      parsedMagType: "Mww",
      parsedMagnitude: 4.3,
      reviewStatus: "reviewed",
      parsedLat: 36.5, // deliberately worse location, must NOT be picked for location
    });

    const result = deriveCanonicalFields([localOrigin, reviewedMw]);

    expect(result?.locationSourceId).toBe("src-local");
    expect(result?.lat).toBe(localOrigin.parsedLat);
    expect(result?.magnitudeSourceId).toBe("src-gcmt");
    expect(result?.magnitude).toBe(4.3);
    expect(result?.magType).toBe("Mww");
  });

  it("never mixes a magnitude value from one record with a magType from another", () => {
    const a = sourceRecord({
      sourceRecordId: "a",
      magnitudeAuthor: "NEIC",
      parsedMagType: "Mww",
      parsedMagnitude: 5.0,
      reviewStatus: "reviewed",
    });
    const b = sourceRecord({
      sourceRecordId: "b",
      magnitudeAuthor: "GFZ",
      parsedMagType: "mb",
      parsedMagnitude: 5.4,
      reviewStatus: "automatic",
    });
    const result = deriveCanonicalFields([a, b]);
    expect(result?.magnitudeSourceId).toBe("a");
    expect(result?.magnitude).toBe(5.0);
    expect(result?.magType).toBe("Mww");
  });

  it("leaves magnitude null when no attached source record has one", () => {
    const noMagnitude = sourceRecord({ parsedMagnitude: null, parsedMagType: null });
    const result = deriveCanonicalFields([noMagnitude]);
    expect(result?.magnitude).toBeNull();
    expect(result?.magnitudeSourceId).toBeNull();
    // Location still resolves even with no magnitude anywhere (a crowd-
    // detected 'possible' event's own source record, for instance).
    expect(result?.locationSourceId).toBe(noMagnitude.sourceRecordId);
  });

  it("excludes deleted source records from both picks", () => {
    const deleted = sourceRecord({
      sourceRecordId: "deleted",
      authorAgency: "ISN",
      reviewStatus: "deleted",
    });
    const fallback = sourceRecord({ sourceRecordId: "fallback", authorAgency: "EMSC" });
    const result = deriveCanonicalFields([deleted, fallback]);
    expect(result?.locationSourceId).toBe("fallback");
  });
});
