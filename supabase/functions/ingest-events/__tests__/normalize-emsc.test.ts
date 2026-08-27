import { normalizeEmscFeature, type EmscRawFeature } from "../normalize-emsc";

// Real feature, verified live 2026-08-27 against
// https://www.seismicportal.eu/fdsnws/event/1/query (region bbox).
const REAL_FEATURE: EmscRawFeature = {
  id: "20260827_0000033",
  properties: {
    source_id: "2051724",
    source_catalog: "EMSC-RTS",
    lastupdate: "2026-08-27T03:09:24.434945Z",
    time: "2026-08-27T02:35:02.04Z",
    flynn_region: "TURKEY-IRAQ BORDER REGION",
    lat: 37.9927,
    lon: 43.0048,
    depth: 12.9,
    evtype: "ke",
    auth: "EMSC",
    mag: 2.5,
    magtype: "ml",
    unid: "20260827_0000033",
  } as EmscRawFeature["properties"],
};

describe("normalizeEmscFeature", () => {
  it("normalizes a real EMSC feature, capturing auth as both authorAgency and magnitudeAuthor", () => {
    const record = normalizeEmscFeature(REAL_FEATURE);
    expect(record).toMatchObject({
      provider: "emsc",
      providerEventId: "20260827_0000033",
      lat: 37.9927,
      lon: 43.0048,
      depthKm: 12.9,
      magnitude: 2.5,
      magType: "ml",
      place: "TURKEY-IRAQ BORDER REGION",
      authorAgency: "EMSC",
      magnitudeAuthor: "EMSC",
      reviewStatus: "automatic",
    });
    expect(record?.originTimeMs).toBe(Date.parse("2026-08-27T02:35:02.04Z"));
    expect(record?.providerUpdatedAtMs).toBe(Date.parse("2026-08-27T03:09:24.434945Z"));
  });

  it("uppercases a lowercase auth value (e.g. a differently-cased relay agency)", () => {
    const record = normalizeEmscFeature({
      ...REAL_FEATURE,
      properties: { ...REAL_FEATURE.properties, auth: "rssc" },
    });
    expect(record?.authorAgency).toBe("RSSC");
  });

  it("skips a feature with mag: null", () => {
    const record = normalizeEmscFeature({
      ...REAL_FEATURE,
      properties: { ...REAL_FEATURE.properties, mag: null },
    });
    expect(record).toBeNull();
  });

  it("skips a feature with an unparseable time", () => {
    const record = normalizeEmscFeature({
      ...REAL_FEATURE,
      properties: { ...REAL_FEATURE.properties, time: "not-a-date" },
    });
    expect(record).toBeNull();
  });

  it("falls back providerUpdatedAtMs to originTimeMs when lastupdate is unparseable", () => {
    const record = normalizeEmscFeature({
      ...REAL_FEATURE,
      properties: { ...REAL_FEATURE.properties, lastupdate: "not-a-date" },
    });
    expect(record?.providerUpdatedAtMs).toBe(record?.originTimeMs);
  });
});
