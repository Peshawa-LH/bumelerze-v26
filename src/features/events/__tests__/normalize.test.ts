import {
  computeClientSig,
  isRegionSignificant,
  isWorldSignificant,
  normalizeUsgsFeature,
} from "../normalize";
import type { UsgsFeature } from "../usgs-schema";
import type { Event } from "../types";

/**
 * Hand-authored fixtures modeled on the real USGS GeoJSON feature shape
 * documented in teardown-usgs-dyfi.md §2 (field list: mag, place, time,
 * updated, url, alert, ids, magType, geometry.coordinates [lon, lat,
 * depth]) — not a live network fixture, since `normalizeUsgsFeature`
 * consumes the already-schema-validated `UsgsFeature` type, not raw JSON.
 */
function buildFeature(overrides: Partial<UsgsFeature["properties"]> & {
  id?: string;
  coordinates?: [number, number, number];
}): UsgsFeature {
  const { id, coordinates, ...propertyOverrides } = overrides;
  return {
    type: "Feature",
    id: id ?? "us7000abcd",
    properties: {
      mag: 4.6,
      place: "32 km SE of Halabja, Iraq",
      time: 1_700_000_000_000,
      updated: 1_700_000_100_000,
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
      alert: null,
      ids: ",us7000abcd,",
      magType: "mb",
      ...propertyOverrides,
    },
    geometry: {
      type: "Point",
      // Default coordinates fall inside REGION_BBOX (lat 33-38.5, lon 41-48.5).
      coordinates: coordinates ?? [45.9, 35.3, 10],
    },
  };
}

describe("normalizeUsgsFeature", () => {
  it("maps a regional USGS feature to the internal Event shape, including sig and the region flag", () => {
    const feature = buildFeature({});
    const fetchedAt = 1_700_000_500_000;

    const event = normalizeUsgsFeature(feature, fetchedAt);

    expect(event).not.toBeNull();
    const result = event as Event;
    expect(result.id).toBe("us7000abcd");
    expect(result.originTime).toBe(1_700_000_000_000);
    expect(result.lat).toBe(35.3);
    expect(result.lon).toBe(45.9);
    expect(result.depthKm).toBe(10);
    expect(result.magnitude).toEqual({ value: 4.6, type: "mb" });
    expect(result.placeName).toBe("32 km SE of Halabja, Iraq");
    expect(result.isRegional).toBe(true);
    expect(result.provenance).toEqual({
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt,
      providerUpdatedAt: 1_700_000_100_000,
    });
    // sig = round(100 * 4.6 + 0 felt term + 0 alert bonus) = 460
    expect(result.sig).toBe(460);
  });

  it("flags an event outside the region bbox as non-regional", () => {
    // Tokyo — well outside lat 33-38.5 / lon 41-48.5.
    const feature = buildFeature({ coordinates: [139.7, 35.7, 30] });

    const event = normalizeUsgsFeature(feature, Date.now());

    expect(event?.isRegional).toBe(false);
  });

  it("returns null for a feature with a null magnitude (USGS pending-review placeholder)", () => {
    const feature = buildFeature({ mag: null });

    expect(normalizeUsgsFeature(feature, Date.now())).toBeNull();
  });

  it("falls back to the feature id when `ids` is absent, and to 'unknown' magType", () => {
    const feature = buildFeature({ ids: undefined, magType: null });

    const event = normalizeUsgsFeature(feature, Date.now());

    expect(event?.provenance.providerId).toBe("us7000abcd");
    expect(event?.magnitude.type).toBe("unknown");
  });
});

describe("computeClientSig", () => {
  it("is purely magnitude-driven when there is no PAGER alert (event-pipeline-design.md §3)", () => {
    expect(computeClientSig(5.0, null)).toBe(500);
    expect(computeClientSig(3.2, undefined)).toBe(320);
  });

  it("adds the USGS PAGER alert bonus on top of the magnitude term", () => {
    expect(computeClientSig(5.0, "green")).toBe(500);
    expect(computeClientSig(5.0, "yellow")).toBe(600);
    expect(computeClientSig(5.0, "orange")).toBe(700);
    expect(computeClientSig(5.0, "red")).toBe(800);
  });

  it("treats an unrecognized alert string as no bonus rather than throwing", () => {
    expect(computeClientSig(5.0, "not-a-real-level")).toBe(500);
  });
});

describe("significance classification (event-pipeline-design.md §3 thresholds)", () => {
  function makeEvent(overrides: Partial<Event>): Event {
    return {
      id: "test-event",
      bumelerzeId: null,
      originTime: 0,
      lat: 36.0,
      lon: 44.5,
      depthKm: 10,
      magnitude: { value: 5, type: "mb" },
      placeName: "Test place",
      provenance: {
        provider: "usgs",
        providerId: "test-event",
        fetchedAt: 0,
        providerUpdatedAt: 0,
      },
      sig: 500,
      isRegional: true,
      url: "",
      ...overrides,
    };
  }

  it("requires BOTH the region flag and sig >= 350 for region-significance", () => {
    expect(isRegionSignificant(makeEvent({ isRegional: true, sig: 350 }))).toBe(true);
    expect(isRegionSignificant(makeEvent({ isRegional: true, sig: 349 }))).toBe(false);
    expect(isRegionSignificant(makeEvent({ isRegional: false, sig: 999 }))).toBe(false);
  });

  it("requires sig >= 600 for world-significance, regardless of the region flag", () => {
    expect(isWorldSignificant(makeEvent({ sig: 600, isRegional: false }))).toBe(true);
    expect(isWorldSignificant(makeEvent({ sig: 599, isRegional: true }))).toBe(false);
  });
});
