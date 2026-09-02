import { fetchGeofonRegionEvents, parseGeofonText } from "../geofon";
import { geofonRowSchema } from "../geofon-schema";
import { normalizeGeofonRow } from "../normalize";

/**
 * Real-format GEOFON fixture: the header line the live service emits plus a
 * VERIFIED live data row (gfz2026oyxe, fetched from
 * geofon.gfz.de/fdsnws/event/1/query with format=text on 2026-08-14) — an
 * intermediate-depth (55 km) mb 4.48 under Iraq, exactly the kind of
 * regional event this provider exists to catch. Note the empty
 * Author/Catalog/MagAuthor columns ("||"): real GEOFON rows carry empties,
 * the parser must not care.
 */
const HEADER_LINE =
  "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType";
const VERIFIED_ROW =
  "gfz2026oyxe|2026-08-01T20:27:43.07|35.406|44.659|55.0|||GFZ|gfz2026oyxe|mb|4.48||Iraq|earthquake";

const FETCHED_AT = Date.UTC(2026, 7, 14, 12, 0, 0);

/** The verified row's origin time as UTC epoch ms — 2026-08-01T20:27:43.07Z.
 * The fractional ".07" seconds are 70 ms. */
const VERIFIED_ORIGIN_TIME_UTC = Date.UTC(2026, 7, 1, 20, 27, 43, 70);

describe("parseGeofonText", () => {
  it("parses the verified live row into a fully-populated normalized event", () => {
    const result = parseGeofonText(`${HEADER_LINE}\n${VERIFIED_ROW}\n`, FETCHED_AT);

    expect(result.skippedCount).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      id: "gfz2026oyxe",
      bumelerzeId: null,
      originTime: VERIFIED_ORIGIN_TIME_UTC,
      lat: 35.406,
      lon: 44.659,
      depthKm: 55.0,
      magnitude: { value: 4.48, type: "mb" },
      placeName: "Iraq",
      provenance: {
        provider: "geofon",
        providerId: "gfz2026oyxe",
        fetchedAt: FETCHED_AT,
        // FDSN text carries no provider-update timestamp — falls back to
        // the origin time.
        providerUpdatedAt: VERIFIED_ORIGIN_TIME_UTC,
      },
      // 100 * 4.48, no alert bonus (GEOFON has no PAGER equivalent).
      sig: 448,
      isRegional: true,
      url: "https://geofon.gfz.de/event/gfz2026oyxe",
    });
  });

  it("reads the zone-less FDSN time as UTC, never local time", () => {
    // The load-bearing assertion of the whole parser: FDSN text times have
    // no zone designator and are UTC by spec, but a naive Date.parse would
    // read them as LOCAL time (jest runs with TZ unset — any non-UTC dev
    // machine would catch a regression here as a whole-timezone offset).
    const result = parseGeofonText(`${HEADER_LINE}\n${VERIFIED_ROW}`, FETCHED_AT);
    expect(result.events[0]?.originTime).toBe(Date.parse("2026-08-01T20:27:43.07Z"));
  });

  it("returns no events for an empty body (the FDSN no-events response) or a header-only body", () => {
    expect(parseGeofonText("", FETCHED_AT)).toEqual({
      events: [],
      skippedCount: 0,
      fetchedAt: FETCHED_AT,
    });
    expect(parseGeofonText(`${HEADER_LINE}\n`, FETCHED_AT).events).toHaveLength(0);
    expect(parseGeofonText(`${HEADER_LINE}\n`, FETCHED_AT).skippedCount).toBe(0);
  });

  it("skips malformed rows (counted, never thrown) while keeping the good ones", () => {
    const tooFewFields = "gfz2026bad1|2026-08-02T00:00:00|35.0|45.0";
    const emptyMagnitude =
      "gfz2026bad2|2026-08-02T01:00:00|35.0|45.0|10.0|||GFZ|gfz2026bad2|||"
      + "|Iraq|earthquake"; // Magnitude column empty — GEOFON's not-yet-reviewed placeholder
    const unparseableLatitude =
      "gfz2026bad3|2026-08-02T02:00:00|not-a-number|45.0|10.0|||GFZ|gfz2026bad3|mb|4.1||Iraq|earthquake";
    const unparseableTime =
      "gfz2026bad4|not-a-timestamp|35.0|45.0|10.0|||GFZ|gfz2026bad4|mb|4.1||Iraq|earthquake";
    const emptyId =
      "|2026-08-02T04:00:00|35.0|45.0|10.0|||GFZ|gfz2026bad5|mb|4.1||Iraq|earthquake";

    const text = [
      HEADER_LINE,
      tooFewFields,
      emptyMagnitude,
      VERIFIED_ROW,
      unparseableLatitude,
      unparseableTime,
      emptyId,
    ].join("\n");

    const result = parseGeofonText(text, FETCHED_AT);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe("gfz2026oyxe");
    expect(result.skippedCount).toBe(5);
  });

  it("tolerates CRLF line endings and surrounding whitespace", () => {
    const result = parseGeofonText(`${HEADER_LINE}\r\n${VERIFIED_ROW}\r\n`, FETCHED_AT);
    expect(result.events).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
  });

  it("parses a strict 13-column FDSN text row (no EventType) — the reusable-for-SeisComP path", () => {
    // A future FDSN/SeisComP source (e.g. the Kurdistan/Iraq data center,
    // provider-architecture.md) may emit only the 13 core columns.
    const thirteenColumns =
      "kur2026abcd|2026-08-02T05:00:00|35.5|45.5|12.0|||KUR|kur2026abcd|ml|3.9||Kurdistan Region, Iraq";
    const result = parseGeofonText(`${HEADER_LINE}\n${thirteenColumns}`, FETCHED_AT);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.magnitude).toEqual({ value: 3.9, type: "ml" });
  });

  it("maps an empty MagType column to \"unknown\", mirroring the other providers' null handling", () => {
    const untypedMag =
      "gfz2026untp|2026-08-02T06:00:00|35.0|45.0|10.0|||GFZ|gfz2026untp||4.2||Iraq|earthquake";
    const result = parseGeofonText(`${HEADER_LINE}\n${untypedMag}`, FETCHED_AT);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.magnitude.type).toBe("unknown");
  });
});

describe("normalizeGeofonRow", () => {
  const baseRow = geofonRowSchema.parse({
    eventId: "gfz2026oyxe",
    time: "2026-08-01T20:27:43.07",
    latitude: 35.406,
    longitude: 44.659,
    depthKm: 55.0,
    magType: "mb",
    magnitude: 4.48,
    locationName: "Iraq",
    eventType: "earthquake",
  });

  it("preserves an explicit zone designator rather than double-suffixing it", () => {
    const withZone = { ...baseRow, time: "2026-08-01T20:27:43.07Z" };
    expect(normalizeGeofonRow(withZone, FETCHED_AT)?.originTime).toBe(
      VERIFIED_ORIGIN_TIME_UTC,
    );

    const withOffset = { ...baseRow, time: "2026-08-01T22:27:43.07+02:00" };
    expect(normalizeGeofonRow(withOffset, FETCHED_AT)?.originTime).toBe(
      VERIFIED_ORIGIN_TIME_UTC,
    );
  });

  it("returns null (skip, not throw) for an unparseable time", () => {
    expect(normalizeGeofonRow({ ...baseRow, time: "garbage" }, FETCHED_AT)).toBeNull();
  });

  it("flags an out-of-region event correctly", () => {
    const outside = { ...baseRow, latitude: 52.4, longitude: 13.1 }; // Potsdam, not Kurdistan
    expect(normalizeGeofonRow(outside, FETCHED_AT)?.isRegional).toBe(false);
  });
});

describe("fetchGeofonRegionEvents", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchOnce(body: string, ok = true, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      text: () => Promise.resolve(body),
    }) as unknown as typeof fetch;
  }

  it("requests format=text with starttime + the short bbox aliases, and parses the response", async () => {
    mockFetchOnce(`${HEADER_LINE}\n${VERIFIED_ROW}\n`);

    const result = await fetchGeofonRegionEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.provenance.provider).toBe("geofon");

    const [requestedUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const url = new URL(requestedUrl);
    expect(url.origin + url.pathname).toBe("https://geofon.gfz.de/fdsnws/event/1/query");
    // GEOFON serves NO format=json (verified live: 400) — text is mandatory.
    expect(url.searchParams.get("format")).toBe("text");
    expect(url.searchParams.get("starttime")).toBeTruthy();
    expect(url.searchParams.get("minlat")).toBe("33");
    expect(url.searchParams.get("maxlat")).toBe("38.5");
    expect(url.searchParams.get("minlon")).toBe("41");
    expect(url.searchParams.get("maxlon")).toBe("48.5");
  });

  it("returns an empty result for an empty 204-style body", async () => {
    mockFetchOnce("");

    const result = await fetchGeofonRegionEvents();

    expect(result.events).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });

  it("throws when the HTTP request itself fails", async () => {
    mockFetchOnce("", false, 503);

    await expect(fetchGeofonRegionEvents()).rejects.toThrow(/GEOFON request failed/);
  });
});
