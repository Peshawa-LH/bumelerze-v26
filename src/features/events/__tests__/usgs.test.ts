import { fetchUsgsEventById } from "../usgs";

/**
 * Regression coverage for the event-deeplink-hang bug
 * (docs/debug-log.md): `fdsnws/event/1/query?eventid=...` returns a bare
 * GeoJSON `Feature` (`type: "Feature"`), never a `FeatureCollection` — an
 * earlier version of `fetchUsgsEventById` parsed it with
 * `usgsFeatureCollectionSchema`/`parseFeatureCollection`, whose `.parse()`
 * call threw on every real response outside any try/catch, turning every
 * cold-start deep link to a real event into React Query retries that
 * always ended in a false "not found".
 */
describe("fetchUsgsEventById", () => {
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

  const REAL_SINGLE_FEATURE_PAYLOAD = {
    type: "Feature",
    id: "us2000bmcg",
    properties: {
      mag: 7.3,
      place: "30km S of Halabja, Iraq",
      time: 1510510687000,
      updated: 1722471960000,
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us2000bmcg",
      alert: null,
      sig: 1435,
      ids: ",us2000bmcg,",
      magType: "mww",
      type: "earthquake",
    },
    geometry: {
      type: "Point",
      coordinates: [45.959, 34.911, 19],
    },
  };

  it("parses a real single-Feature fdsnws eventid response (not a FeatureCollection) and returns the event", async () => {
    mockFetchOnce(REAL_SINGLE_FEATURE_PAYLOAD);

    const event = await fetchUsgsEventById("us2000bmcg");

    expect(event).not.toBeNull();
    expect(event?.id).toBe("us2000bmcg");
    expect(event?.magnitude.value).toBe(7.3);
    expect(event?.lat).toBe(34.911);
    expect(event?.lon).toBe(45.959);
  });

  it("returns null (not a throw) when USGS has no such event (empty/malformed payload)", async () => {
    mockFetchOnce({ type: "FeatureCollection", features: [] });

    await expect(fetchUsgsEventById("does-not-exist")).resolves.toBeNull();
  });

  it("returns null (not a throw) when the HTTP request itself fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("should not be called")),
    }) as unknown as typeof fetch;

    await expect(fetchUsgsEventById("us2000bmcg")).resolves.toBeNull();
  });

  it("returns null (not a throw) for a structurally unrecognizable payload", async () => {
    mockFetchOnce({ unexpected: "shape" });

    await expect(fetchUsgsEventById("us2000bmcg")).resolves.toBeNull();
  });
});
