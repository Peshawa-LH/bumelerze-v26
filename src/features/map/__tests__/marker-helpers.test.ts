import type { Event } from "@/features/events";
import { MARKER_MAX_DIAMETER_PX, MARKER_MIN_DIAMETER_PX } from "../config";
import {
  buildRegionMarkers,
  hexToRgba,
  magnitudeToMarkerDiameterPx,
  regionBboxToLngLatBounds,
} from "../marker-helpers";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    bumelerzeId: null,
    originTime: Date.UTC(2026, 7, 15, 12, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "32 km SE of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    ...overrides,
  };
}

describe("magnitudeToMarkerDiameterPx", () => {
  it("clamps below-floor magnitudes to the minimum diameter", () => {
    expect(magnitudeToMarkerDiameterPx(-1)).toBe(MARKER_MIN_DIAMETER_PX);
    expect(magnitudeToMarkerDiameterPx(0)).toBe(MARKER_MIN_DIAMETER_PX);
  });

  it("clamps at/above-ceiling magnitudes to the maximum diameter", () => {
    expect(magnitudeToMarkerDiameterPx(7)).toBe(MARKER_MAX_DIAMETER_PX);
    expect(magnitudeToMarkerDiameterPx(9.1)).toBe(MARKER_MAX_DIAMETER_PX);
  });

  it("interpolates linearly at the midpoint of the clamp range", () => {
    // Floor 0, ceiling 7 (config.ts) -> 3.5 is the exact midpoint.
    const expectedMid = Math.round(
      MARKER_MIN_DIAMETER_PX + 0.5 * (MARKER_MAX_DIAMETER_PX - MARKER_MIN_DIAMETER_PX),
    );
    expect(magnitudeToMarkerDiameterPx(3.5)).toBe(expectedMid);
  });

  it("is monotonically non-decreasing as magnitude increases", () => {
    const values = [-2, 0, 1, 2, 3, 4, 4.5, 5, 6, 6.9, 7, 8];
    const diameters = values.map(magnitudeToMarkerDiameterPx);
    for (let i = 1; i < diameters.length; i += 1) {
      expect(diameters[i]).toBeGreaterThanOrEqual(diameters[i - 1] as number);
    }
  });

  it("returns whole-pixel integers", () => {
    for (const magnitude of [0.1, 1.3, 2.7, 4.44, 5.99]) {
      expect(Number.isInteger(magnitudeToMarkerDiameterPx(magnitude))).toBe(true);
    }
  });
});

describe("buildRegionMarkers", () => {
  it("returns an empty array for an empty feed", () => {
    expect(buildRegionMarkers([])).toEqual([]);
  });

  it("maps id/lon/lat straight through from the event", () => {
    const event = makeEvent({ id: "ev1", lat: 36.19, lon: 44.01 });
    const [marker] = buildRegionMarkers([event]);
    expect(marker).toMatchObject({ id: "ev1", lat: 36.19, lon: 44.01 });
  });

  it("assigns tone via the shared magnitudeTone thresholds (info/warning/danger)", () => {
    const [low, mid, high] = buildRegionMarkers([
      makeEvent({ id: "low", magnitude: { value: 2.0, type: "ml" } }),
      makeEvent({ id: "mid", magnitude: { value: 5.0, type: "mb" } }),
      makeEvent({ id: "high", magnitude: { value: 6.5, type: "mww" } }),
    ]);
    expect(low?.tone).toBe("info");
    expect(mid?.tone).toBe("warning");
    expect(high?.tone).toBe("danger");
  });

  it("sizes each marker's diameter from its own magnitude", () => {
    const [marker] = buildRegionMarkers([
      makeEvent({ magnitude: { value: 7, type: "mww" } }),
    ]);
    expect(marker?.diameterPx).toBe(MARKER_MAX_DIAMETER_PX);
  });

  it("preserves feed order and produces one marker per event", () => {
    const events = [
      makeEvent({ id: "a" }),
      makeEvent({ id: "b" }),
      makeEvent({ id: "c" }),
    ];
    const markers = buildRegionMarkers(events);
    expect(markers.map((marker) => marker.id)).toEqual(["a", "b", "c"]);
  });

  it("flags only the most-recently-originated event as isMostRecent", () => {
    const markers = buildRegionMarkers([
      makeEvent({ id: "old", originTime: Date.UTC(2026, 7, 15, 12, 0, 0) }),
      makeEvent({ id: "new", originTime: Date.UTC(2026, 7, 15, 13, 0, 0) }),
      makeEvent({ id: "middle", originTime: Date.UTC(2026, 7, 15, 12, 30, 0) }),
    ]);
    expect(markers.find((marker) => marker.id === "new")?.isMostRecent).toBe(true);
    expect(markers.find((marker) => marker.id === "old")?.isMostRecent).toBe(false);
    expect(markers.find((marker) => marker.id === "middle")?.isMostRecent).toBe(false);
  });

  it("returns an empty array (no crash) for an empty feed's isMostRecent computation", () => {
    expect(buildRegionMarkers([])).toEqual([]);
  });
});

describe("regionBboxToLngLatBounds", () => {
  it("converts a lat/lon bbox to a [[west,south],[east,north]] lon/lat tuple", () => {
    const bbox = { minLat: 33.0, maxLat: 38.5, minLon: 41.0, maxLon: 48.5 };
    expect(regionBboxToLngLatBounds(bbox)).toEqual([
      [41.0, 33.0],
      [48.5, 38.5],
    ]);
  });

  it("round-trips a degenerate (point) bbox", () => {
    const bbox = { minLat: 35.5, maxLat: 35.5, minLon: 45.5, maxLon: 45.5 };
    expect(regionBboxToLngLatBounds(bbox)).toEqual([
      [45.5, 35.5],
      [45.5, 35.5],
    ]);
  });

  it("keeps lon strictly first in each pair, even with negative coordinates", () => {
    const bbox = { minLat: -10, maxLat: 10, minLon: -20, maxLon: 20 };
    const [southWest, northEast] = regionBboxToLngLatBounds(bbox);
    expect(southWest).toEqual([-20, -10]);
    expect(northEast).toEqual([20, 10]);
  });
});

describe("hexToRgba", () => {
  it("converts a 6-digit hex color to rgba with the given alpha", () => {
    expect(hexToRgba("#2E6E9E", 0.32)).toBe("rgba(46, 110, 158, 0.32)");
  });

  it("converts a 3-digit shorthand hex color", () => {
    expect(hexToRgba("#0f0", 0.5)).toBe("rgba(0, 255, 0, 0.5)");
  });

  it("is case-insensitive on the hex digits", () => {
    expect(hexToRgba("#abcdef", 1)).toBe(hexToRgba("#ABCDEF", 1));
  });

  it("falls back to the input unchanged for a color it can't parse as hex", () => {
    expect(hexToRgba("rgba(1, 2, 3, 1)", 0.5)).toBe("rgba(1, 2, 3, 1)");
    expect(hexToRgba("not-a-color", 0.5)).toBe("not-a-color");
  });
});
