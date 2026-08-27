import { normalizeUsgsFeature, type UsgsRawFeature } from "../normalize-usgs";

// Real feature, verified live 2026-08-27 against
// https://earthquake.usgs.gov/fdsnws/event/1/query (region bbox).
const REAL_FEATURE: UsgsRawFeature = {
  id: "us6000tnbh",
  properties: {
    mag: 4.2,
    place: "5 km SSE of Darreh Shahr, Iran",
    time: 1787638792919,
    updated: 1787640174040,
    magType: "mb",
    net: "us",
    status: "reviewed",
  },
  geometry: { coordinates: [47.3976, 33.101, 10] },
};

describe("normalizeUsgsFeature", () => {
  it("normalizes a real USGS feature, capturing net/status the client-side normalizer discards", () => {
    const record = normalizeUsgsFeature(REAL_FEATURE);
    expect(record).toEqual({
      provider: "usgs",
      providerEventId: "us6000tnbh",
      rawPayload: REAL_FEATURE,
      originTimeMs: 1787638792919,
      lat: 33.101,
      lon: 47.3976,
      depthKm: 10,
      magnitude: 4.2,
      magType: "mb",
      place: "5 km SSE of Darreh Shahr, Iran",
      authorAgency: "US",
      magnitudeAuthor: "US",
      reviewStatus: "reviewed",
      providerUpdatedAtMs: 1787640174040,
    });
  });

  it("maps a non-'reviewed' status to 'automatic'", () => {
    const record = normalizeUsgsFeature({
      ...REAL_FEATURE,
      properties: { ...REAL_FEATURE.properties, status: "automatic" },
    });
    expect(record?.reviewStatus).toBe("automatic");
  });

  it("defaults review status to 'automatic' when the field is missing", () => {
    const { status: _status, ...rest } = REAL_FEATURE.properties;
    const record = normalizeUsgsFeature({ ...REAL_FEATURE, properties: rest });
    expect(record?.reviewStatus).toBe("automatic");
  });

  it("skips (returns null for) a feature pending review (mag: null)", () => {
    const record = normalizeUsgsFeature({
      ...REAL_FEATURE,
      properties: { ...REAL_FEATURE.properties, mag: null },
    });
    expect(record).toBeNull();
  });

  it("leaves authorAgency/magnitudeAuthor null when net is absent", () => {
    const { net: _net, ...rest } = REAL_FEATURE.properties;
    const record = normalizeUsgsFeature({ ...REAL_FEATURE, properties: rest });
    expect(record?.authorAgency).toBeNull();
    expect(record?.magnitudeAuthor).toBeNull();
  });
});
