import { normalizeEmscFeature } from "../normalize";
import type { EmscFeature } from "../emsc-schema";

/**
 * Hand-authored fixtures modeled on the real EMSC seismicportal.eu fdsnws
 * feature shape (teardown-lastquake.md §2), mirroring `buildFeature` in
 * normalize.test.ts — `normalizeEmscFeature` consumes the already-schema-
 * validated `EmscFeature` type, not raw JSON.
 */
function buildEmscFeature(
  overrides: Partial<EmscFeature["properties"]>,
): EmscFeature {
  return {
    type: "Feature",
    id: "20230206_0000008",
    properties: {
      unid: "20230206_0000008",
      time: "2023-02-06T01:17:34.0Z",
      lastupdate: "2023-02-06T02:03:11.0Z",
      // Default coordinates fall inside REGION_BBOX (lat 33-38.5, lon 41-48.5).
      lat: 35.3,
      lon: 45.9,
      depth: 10,
      mag: 4.6,
      magtype: "mw",
      evtype: "ke",
      auth: "EMSC",
      flynn_region: "SE OF HALABJA, IRAQ",
      ...overrides,
    },
  };
}

describe("normalizeEmscFeature", () => {
  it("maps a regional EMSC feature to the internal Event shape, provider tagged 'emsc'", () => {
    const feature = buildEmscFeature({});
    const fetchedAt = 1_700_000_500_000;

    const event = normalizeEmscFeature(feature, fetchedAt);

    expect(event).not.toBeNull();
    expect(event?.id).toBe("20230206_0000008");
    expect(event?.lat).toBe(35.3);
    expect(event?.lon).toBe(45.9);
    expect(event?.depthKm).toBe(10);
    expect(event?.magnitude).toEqual({ value: 4.6, type: "mw" });
    expect(event?.placeName).toBe("SE OF HALABJA, IRAQ");
    expect(event?.isRegional).toBe(true);
    expect(event?.provenance).toEqual({
      provider: "emsc",
      providerId: "20230206_0000008",
      fetchedAt,
      providerUpdatedAt: Date.parse("2023-02-06T02:03:11.0Z"),
    });
    expect(event?.originTime).toBe(Date.parse("2023-02-06T01:17:34.0Z"));
    expect(event?.url).toBe(
      "https://www.seismicportal.eu/eventdetails.html?unid=20230206_0000008",
    );
  });

  it("computes sig with NO alert bonus — EMSC has no PAGER-equivalent field, unlike USGS", () => {
    const feature = buildEmscFeature({ mag: 5.0 });

    const event = normalizeEmscFeature(feature, Date.now());

    // sig = round(100 * 5.0 + 0 felt term + 0 alert bonus) = 500, same
    // formula as USGS's unflagged ("green") case — EMSC events can never
    // reach the +100/+200/+300 alert-bonus tiers USGS orange/red events get.
    expect(event?.sig).toBe(500);
  });

  it("flags an event outside the region bbox as non-regional", () => {
    // Tokyo — well outside lat 33-38.5 / lon 41-48.5.
    const feature = buildEmscFeature({ lat: 35.7, lon: 139.7 });

    const event = normalizeEmscFeature(feature, Date.now());

    expect(event?.isRegional).toBe(false);
  });

  it("returns null for a feature with a null magnitude (not-yet-located placeholder)", () => {
    const feature = buildEmscFeature({ mag: null });

    expect(normalizeEmscFeature(feature, Date.now())).toBeNull();
  });

  it("returns null (not a throw) for an unparseable origin time", () => {
    const feature = buildEmscFeature({ time: "not-a-real-timestamp" });

    expect(normalizeEmscFeature(feature, Date.now())).toBeNull();
  });

  it("falls back to origin time when lastupdate is unparseable, rather than discarding the feature", () => {
    const feature = buildEmscFeature({ lastupdate: "not-a-real-timestamp" });

    const event = normalizeEmscFeature(feature, Date.now());

    expect(event).not.toBeNull();
    expect(event?.provenance.providerUpdatedAt).toBe(event?.originTime);
  });

  it("falls back to 'unknown' magType when magtype is null", () => {
    const feature = buildEmscFeature({ magtype: null });

    const event = normalizeEmscFeature(feature, Date.now());

    expect(event?.magnitude.type).toBe("unknown");
  });

  it("falls back to an empty placeName when flynn_region is absent", () => {
    const feature = buildEmscFeature({ flynn_region: null });

    const event = normalizeEmscFeature(feature, Date.now());

    expect(event?.placeName).toBe("");
  });
});
