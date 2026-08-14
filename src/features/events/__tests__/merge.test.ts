import {
  DEDUP_MAX_MAG_DELTA,
  DEDUP_MAX_TIME_DELTA_MS,
} from "../config";
import { isSameEarthquake, mergeProviderEvents } from "../merge";
import type { Event, EventProvider } from "../types";

/** Base epicenter for the pair tests — inside the region bbox. */
const BASE_LAT = 35.0;
const BASE_LON = 45.0;
const BASE_TIME = Date.UTC(2026, 7, 13, 22, 28, 0); // 2026-08-13T22:28:00Z

function makeEvent(
  provider: EventProvider,
  id: string,
  overrides: Partial<Pick<Event, "originTime" | "lat" | "lon">> & { mag?: number } = {},
): Event {
  const mag = overrides.mag ?? 4.0;
  return {
    id,
    originTime: overrides.originTime ?? BASE_TIME,
    lat: overrides.lat ?? BASE_LAT,
    lon: overrides.lon ?? BASE_LON,
    depthKm: 10,
    magnitude: { value: mag, type: provider === "usgs" ? "mb" : "ml" },
    placeName: "Test place",
    provenance: {
      provider,
      providerId: id,
      fetchedAt: BASE_TIME + 60_000,
      providerUpdatedAt: BASE_TIME + 30_000,
    },
    sig: Math.round(100 * mag),
    isRegional: true,
    url: "",
  };
}

/**
 * Golden pairs for the §2 spatial-temporal match
 * (event-pipeline-design.md §2 step 3: |Δt| <= 16 s AND distance <= 100 km
 * AND |ΔM| <= 1.5, all inclusive). Distance goldens are hand-computed
 * haversine values (R = 6371 km):
 * - Δlat 0.89°  at fixed lon → ~98.96 km  (inside the 100 km threshold)
 * - Δlat 0.91°  at fixed lon → ~101.19 km (outside)
 * - Δlon 1.00°  at lat 35    → ~91.08 km  (inside — cos(35°) shrink)
 */
describe("isSameEarthquake (§2 dedup thresholds)", () => {
  const usgs = makeEvent("usgs", "us7000test");

  it("matches an identical-parameter pair", () => {
    expect(isSameEarthquake(usgs, makeEvent("emsc", "20260813_e1"))).toBe(true);
  });

  it("time boundary: |Δt| of exactly 16 s still matches (inclusive)", () => {
    const emsc = makeEvent("emsc", "e", { originTime: BASE_TIME + DEDUP_MAX_TIME_DELTA_MS });
    expect(isSameEarthquake(usgs, emsc)).toBe(true);
  });

  it("time boundary: |Δt| of 16 s + 1 ms does not match", () => {
    const emsc = makeEvent("emsc", "e", {
      originTime: BASE_TIME + DEDUP_MAX_TIME_DELTA_MS + 1,
    });
    expect(isSameEarthquake(usgs, emsc)).toBe(false);
  });

  it("distance boundary: ~98.96 km (Δlat 0.89°) matches", () => {
    const emsc = makeEvent("emsc", "e", { lat: BASE_LAT + 0.89 });
    expect(isSameEarthquake(usgs, emsc)).toBe(true);
  });

  it("distance boundary: ~101.19 km (Δlat 0.91°) does not match", () => {
    const emsc = makeEvent("emsc", "e", { lat: BASE_LAT + 0.91 });
    expect(isSameEarthquake(usgs, emsc)).toBe(false);
  });

  it("distance: a full degree of longitude at lat 35 (~91.08 km) still matches", () => {
    const emsc = makeEvent("emsc", "e", { lon: BASE_LON + 1.0 });
    expect(isSameEarthquake(usgs, emsc)).toBe(true);
  });

  it("magnitude boundary: |ΔM| of exactly 1.5 still matches (inclusive)", () => {
    const emsc = makeEvent("emsc", "e", { mag: 4.0 + DEDUP_MAX_MAG_DELTA });
    expect(isSameEarthquake(usgs, emsc)).toBe(true);
  });

  it("magnitude boundary: |ΔM| of 1.51 does not match (foreshock/mainshock guard)", () => {
    const emsc = makeEvent("emsc", "e", { mag: 5.51 });
    expect(isSameEarthquake(usgs, emsc)).toBe(false);
  });
});

describe("mergeProviderEvents", () => {
  it("drops the EMSC record of a matched pair — USGS is canonical", () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    // Same quake as seen by EMSC: 4 s later, ~10 km away, ΔM 0.2.
    const emscDuplicate = makeEvent("emsc", "20260813_0000042", {
      originTime: BASE_TIME + 4_000,
      lat: BASE_LAT + 0.09,
      mag: 4.2,
    });

    const merged = mergeProviderEvents([usgsEvent], [emscDuplicate]);

    expect(merged).toHaveLength(1);
    // The exact USGS Event object survives untouched — nothing from the
    // EMSC record is carried over.
    expect(merged[0]).toBe(usgsEvent);
  });

  it("passes EMSC-only events through as-is, provider chip intact", () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    const emscOnly = makeEvent("emsc", "20260813_0000099", {
      originTime: BASE_TIME - 3 * 60 * 60 * 1000, // hours apart — a different quake
      lat: 34.4,
      lon: 45.7,
    });

    const merged = mergeProviderEvents([usgsEvent], [emscOnly]);

    expect(merged).toHaveLength(2);
    expect(merged).toContain(usgsEvent);
    expect(merged).toContain(emscOnly);
    expect(merged.find((e) => e.id === "20260813_0000099")?.provenance.provider).toBe("emsc");
  });

  it("close-in-time but far-away events are NOT deduplicated (distance guard)", () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    // Simultaneous but ~222 km north — two distinct quakes.
    const emscOther = makeEvent("emsc", "20260813_0000050", { lat: BASE_LAT + 2.0 });

    const merged = mergeProviderEvents([usgsEvent], [emscOther]);

    expect(merged).toHaveLength(2);
  });

  it("empty EMSC list → the USGS list unchanged (USGS-only degraded mode)", () => {
    const usgsEvents = [
      makeEvent("usgs", "us1", { originTime: BASE_TIME }),
      makeEvent("usgs", "us2", { originTime: BASE_TIME - 60_000 }),
    ];
    expect(mergeProviderEvents(usgsEvents, [])).toEqual(usgsEvents);
  });

  it("empty USGS list → the EMSC list (EMSC-only degraded mode, the old failover outcome)", () => {
    const emscEvents = [makeEvent("emsc", "e1"), makeEvent("emsc", "e2", { lat: 36.5 })];
    expect(mergeProviderEvents([], emscEvents)).toEqual(emscEvents);
  });

  it("both lists empty → empty list", () => {
    expect(mergeProviderEvents([], [])).toEqual([]);
  });

  it("orders the merged list by origin time, newest first", () => {
    const older = makeEvent("usgs", "us_old", { originTime: BASE_TIME - 7_200_000 });
    const newest = makeEvent("emsc", "e_new", {
      originTime: BASE_TIME + 3_600_000,
      lat: 37.0,
    });
    const middle = makeEvent("usgs", "us_mid", { originTime: BASE_TIME });

    const merged = mergeProviderEvents([older, middle], [newest]);

    expect(merged.map((e) => e.id)).toEqual(["e_new", "us_mid", "us_old"]);
  });

  it("checks each EMSC event against every USGS event in its time window, not just the first", () => {
    const usgsA = makeEvent("usgs", "usA", { originTime: BASE_TIME });
    const usgsB = makeEvent("usgs", "usB", { originTime: BASE_TIME + 60_000 });
    // Twin of usgsB only: Δt vs A is 64 s (outside the 16 s window),
    // Δt vs B is 4 s (inside) at the same epicenter.
    const emscTwinOfB = makeEvent("emsc", "eB", { originTime: BASE_TIME + 64_000 });

    const merged = mergeProviderEvents([usgsA, usgsB], [emscTwinOfB]);

    expect(merged.map((e) => e.id).sort()).toEqual(["usA", "usB"]);
  });

  /**
   * REGRESSION — the real missed earthquake this wave exists for:
   * 2026-08-13 22:28 UTC, M4.0 mb, "IRAN-IRAQ BORDER REGION". Present in
   * EMSC's fdsnws catalog, absent from USGS entirely (below NEIC's ~M4.5
   * regional completeness). Under the old failover semantics this event
   * never surfaced while USGS was healthy; the merge must surface it.
   */
  it("surfaces the 2026-08-13 M4.0 Iran–Iraq border event missing from USGS", () => {
    // USGS's healthy region list for the window — other events, NOT this one.
    const usgsEvents = [
      makeEvent("usgs", "us7000qxyz", {
        originTime: Date.UTC(2026, 7, 13, 4, 10, 0),
        lat: 37.1,
        lon: 43.2,
        mag: 4.6,
      }),
      makeEvent("usgs", "us7000qabc", {
        originTime: Date.UTC(2026, 7, 11, 15, 3, 0),
        lat: 34.1,
        lon: 45.4,
        mag: 4.8,
      }),
    ];
    // EMSC's list carries the border event USGS never published.
    const borderEvent = makeEvent("emsc", "20260813_0000321", {
      originTime: Date.UTC(2026, 7, 13, 22, 28, 0),
      lat: 34.9,
      lon: 45.9,
      mag: 4.0,
    });
    const emscEvents = [
      borderEvent,
      // EMSC's duplicate of a USGS event — must still dedup away.
      makeEvent("emsc", "20260813_0000200", {
        originTime: Date.UTC(2026, 7, 13, 4, 10, 5),
        lat: 37.15,
        lon: 43.25,
        mag: 4.5,
      }),
    ];

    const merged = mergeProviderEvents(usgsEvents, emscEvents);

    const surfaced = merged.find((e) => e.id === "20260813_0000321");
    expect(surfaced).toBeDefined();
    expect(surfaced?.provenance.provider).toBe("emsc");
    expect(surfaced?.magnitude.value).toBe(4.0);
    // The overlapping event stayed single, under its USGS record.
    expect(merged).toHaveLength(3);
    expect(merged.filter((e) => e.provenance.provider === "usgs")).toHaveLength(2);
  });
});
