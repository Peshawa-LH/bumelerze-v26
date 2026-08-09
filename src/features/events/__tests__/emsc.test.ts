import { fetchEmscRegionEvents } from "../emsc";
import { emscFeatureCollectionSchema, emscFeatureSchema } from "../emsc-schema";

/**
 * Realistic EMSC seismicportal.eu fdsnws feature, hand-authored from the
 * exact property list documented in teardown-lastquake.md §2 (`unid, time,
 * lastupdate, lat, lon, depth, mag, magtype, evtype, auth, source_catalog,
 * source_id, flynn_region`) — this is the fixture the wave brief asks for,
 * mirroring how normalize.test.ts's `buildFeature` fixture was built from
 * the USGS teardown.
 */
const REAL_EMSC_FEATURE = {
  type: "Feature",
  id: "20230206_0000008",
  geometry: {
    type: "Point",
    coordinates: [37.03, 37.17, 10],
  },
  properties: {
    unid: "20230206_0000008",
    time: "2023-02-06T01:17:34.0Z",
    lastupdate: "2023-02-06T02:03:11.0Z",
    lat: 37.17,
    lon: 37.03,
    depth: 10,
    mag: 7.8,
    magtype: "mw",
    evtype: "ke",
    auth: "EMSC",
    source_catalog: "EMSC-RTS",
    source_id: "612345",
    flynn_region: "CENTRAL TURKEY",
  },
};

describe("EMSC schema parsing", () => {
  it("accepts a realistic EMSC fdsnws feature (teardown-lastquake.md §2 fixture)", () => {
    const parsed = emscFeatureSchema.safeParse(REAL_EMSC_FEATURE);
    expect(parsed.success).toBe(true);
  });

  it("strips fields we don't use (geometry, evtype, auth, source_catalog, source_id) without failing", () => {
    const parsed = emscFeatureSchema.parse(REAL_EMSC_FEATURE);
    expect(parsed.properties.unid).toBe("20230206_0000008");
    // `geometry` isn't part of the schema at all — properties carry lat/lon/depth.
    expect("geometry" in parsed).toBe(false);
  });

  it("fails a feature missing a required field (unid)", () => {
    const { unid: _unid, ...propertiesWithoutUnid } = REAL_EMSC_FEATURE.properties;
    const parsed = emscFeatureSchema.safeParse({
      ...REAL_EMSC_FEATURE,
      properties: propertiesWithoutUnid,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a null mag (EMSC's not-yet-located placeholder, mirroring USGS's convention)", () => {
    const parsed = emscFeatureSchema.safeParse({
      ...REAL_EMSC_FEATURE,
      properties: { ...REAL_EMSC_FEATURE.properties, mag: null },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("fetchEmscRegionEvents", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchOnce(payload: unknown, ok = true, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(payload),
    }) as unknown as typeof fetch;
  }

  it("parses a realistic EMSC FeatureCollection into normalized events", async () => {
    mockFetchOnce({
      type: "FeatureCollection",
      features: [REAL_EMSC_FEATURE],
    });

    const result = await fetchEmscRegionEvents();

    expect(result.skippedCount).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "20230206_0000008",
      magnitude: { value: 7.8, type: "mw" },
      provenance: { provider: "emsc", providerId: "20230206_0000008" },
    });
  });

  it("skips a malformed feature (counted, not thrown) alongside a good one — tolerant parsing like usgs.ts", async () => {
    mockFetchOnce({
      type: "FeatureCollection",
      features: [REAL_EMSC_FEATURE, { properties: { unid: "bad" } }],
    });

    const result = await fetchEmscRegionEvents();

    expect(result.events).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
  });

  it("throws on a top-level payload that isn't a GeoJSON FeatureCollection at all", async () => {
    mockFetchOnce({ unexpected: "shape" });

    await expect(fetchEmscRegionEvents()).rejects.toThrow();
  });

  it("throws when the HTTP request itself fails", async () => {
    mockFetchOnce({}, false, 503);

    await expect(fetchEmscRegionEvents()).rejects.toThrow(/EMSC request failed/);
  });
});

describe("emscFeatureCollectionSchema", () => {
  it("only requires type + a features array, tolerant of unknown top-level fields (e.g. EMSC's metadata block)", () => {
    const parsed = emscFeatureCollectionSchema.safeParse({
      type: "FeatureCollection",
      metadata: { totalCount: 1 },
      features: [],
    });
    expect(parsed.success).toBe(true);
  });
});
