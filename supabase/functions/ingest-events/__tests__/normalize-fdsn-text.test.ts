import {
  FDSN_TEXT_MIN_FIELDS,
  parseFdsnTextBody,
  parseFdsnTextLine,
  parseFdsnTextTimeUtc,
  normalizeFdsnTextRow,
} from "../normalize-fdsn-text";

// Real response bodies, verified live 2026-08-27.
const GEOFON_BODY = [
  "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
  "gfz2026qprg|2026-08-25T06:19:54.11|33.176|47.599|10.0|||GFZ|gfz2026qprg|mb|4.3||Western Iran|earthquake",
  "gfz2026oyxe|2026-08-01T20:27:43.07|35.406|44.659|55.0|||GFZ|gfz2026oyxe|mb|4.48||Iraq|earthquake",
  "gfz2026obse|2026-07-20T03:48:50.79|34.553|46.423|10.0|||GFZ|gfz2026obse|Mw|5.24||Western Iran|earthquake",
  "",
].join("\n");

const ISC_BODY = [
  "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
  "644495071|2024-01-01T05:01:18.000|37.4820|43.9910|7.0|AFAD|AFAD|AFAD|638696811|ML|1.90|AFAD|Turkey|earthquake",
  "643726562|2024-01-01T14:41:00.000|37.5590|44.0030|7.0|AFAD|AFAD|AFAD|638696784|ML|2.10|ISK|Turkey-Iran border region|earthquake",
  "# Agencies whose data contributed towards the results of this search:",
  "# AFAD      Disaster and Emergency Management Presidency                                     Turkey",
  "# ISN       Iraqi Meteorological and Seismology Organisation                                 Iraq",
].join("\n");

describe("parseFdsnTextLine", () => {
  it("parses a GEOFON row with blank Author/MagAuthor (self-catalogued, Contributor='GFZ')", () => {
    const row = parseFdsnTextLine(
      "gfz2026qprg|2026-08-25T06:19:54.11|33.176|47.599|10.0|||GFZ|gfz2026qprg|mb|4.3||Western Iran|earthquake",
    );
    expect(row).toEqual({
      eventId: "gfz2026qprg",
      time: "2026-08-25T06:19:54.11",
      lat: 33.176,
      lon: 47.599,
      depthKm: 10.0,
      author: null,
      contributor: "GFZ",
      magType: "mb",
      magnitude: 4.3,
      magAuthor: null,
      locationName: "Western Iran",
    });
  });

  it("parses an ISC row with DIFFERENT Author and MagAuthor (verified live event 643726562)", () => {
    const row = parseFdsnTextLine(
      "643726562|2024-01-01T14:41:00.000|37.5590|44.0030|7.0|AFAD|AFAD|AFAD|638696784|ML|2.10|ISK|Turkey-Iran border region|earthquake",
    );
    expect(row?.author).toBe("AFAD");
    expect(row?.magAuthor).toBe("ISK");
  });

  it("rejects a line with fewer than the minimum FDSN text columns", () => {
    const tooFewFields = Array(FDSN_TEXT_MIN_FIELDS - 1).fill("x").join("|");
    expect(parseFdsnTextLine(tooFewFields)).toBeNull();
  });

  it("rejects a line with an unparseable numeric column", () => {
    const row = parseFdsnTextLine(
      "gfz2026qprg|2026-08-25T06:19:54.11|not-a-number|47.599|10.0|||GFZ|gfz2026qprg|mb|4.3||Western Iran|earthquake",
    );
    expect(row).toBeNull();
  });
});

describe("parseFdsnTextTimeUtc", () => {
  it("treats a zone-less FDSN text time as UTC", () => {
    expect(parseFdsnTextTimeUtc("2026-08-25T06:19:54.11")).toBe(
      Date.parse("2026-08-25T06:19:54.11Z"),
    );
  });

  it("does not double-append a zone when one is already present", () => {
    expect(parseFdsnTextTimeUtc("2026-08-25T06:19:54.11Z")).toBe(
      Date.parse("2026-08-25T06:19:54.11Z"),
    );
  });
});

describe("normalizeFdsnTextRow — GEOFON (author blank, falls back to Contributor)", () => {
  it("falls location/magnitude author back to Contributor when Author/MagAuthor are blank", () => {
    const row = parseFdsnTextLine(
      "gfz2026qprg|2026-08-25T06:19:54.11|33.176|47.599|10.0|||GFZ|gfz2026qprg|mb|4.3||Western Iran|earthquake",
    );
    const record = normalizeFdsnTextRow(row!, { provider: "geofon", defaultReviewStatus: "automatic" });
    expect(record?.authorAgency).toBe("GFZ");
    expect(record?.magnitudeAuthor).toBe("GFZ");
    expect(record?.reviewStatus).toBe("automatic");
    expect(record?.provider).toBe("geofon");
  });
});

describe("normalizeFdsnTextRow — ISC (Author and MagAuthor genuinely differ)", () => {
  it("keeps authorAgency and magnitudeAuthor independent", () => {
    const row = parseFdsnTextLine(
      "643726562|2024-01-01T14:41:00.000|37.5590|44.0030|7.0|AFAD|AFAD|AFAD|638696784|ML|2.10|ISK|Turkey-Iran border region|earthquake",
    );
    const record = normalizeFdsnTextRow(row!, { provider: "isc", defaultReviewStatus: "reviewed" });
    expect(record?.authorAgency).toBe("AFAD");
    expect(record?.magnitudeAuthor).toBe("ISK");
    expect(record?.reviewStatus).toBe("reviewed");
  });

  it("skips a row with no magnitude", () => {
    const row = parseFdsnTextLine(
      "643726562|2024-01-01T14:41:00.000|37.5590|44.0030|7.0|AFAD|AFAD|AFAD|638696784||||Turkey-Iran border region|earthquake",
    );
    const record = normalizeFdsnTextRow(row!, { provider: "isc", defaultReviewStatus: "reviewed" });
    expect(record).toBeNull();
  });
});

describe("parseFdsnTextBody", () => {
  it("parses the real GEOFON body, skipping the header and trailing blank line", () => {
    const { records, skippedCount } = parseFdsnTextBody(GEOFON_BODY, {
      provider: "geofon",
      defaultReviewStatus: "automatic",
    });
    expect(records).toHaveLength(3);
    expect(skippedCount).toBe(0);
    expect(records.map((r) => r.providerEventId)).toEqual([
      "gfz2026qprg",
      "gfz2026oyxe",
      "gfz2026obse",
    ]);
  });

  it("parses the real ISC body, skipping the header AND the trailing '# Agencies...' comment block", () => {
    const { records, skippedCount } = parseFdsnTextBody(ISC_BODY, {
      provider: "isc",
      defaultReviewStatus: "reviewed",
    });
    expect(records).toHaveLength(2);
    expect(skippedCount).toBe(0);
    expect(records[1]?.authorAgency).toBe("AFAD");
    expect(records[1]?.magnitudeAuthor).toBe("ISK");
  });
});
