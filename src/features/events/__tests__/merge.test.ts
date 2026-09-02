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
    bumelerzeId: null,
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

    const merged = mergeProviderEvents([[usgsEvent], [emscDuplicate]]);

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

    const merged = mergeProviderEvents([[usgsEvent], [emscOnly]]);

    expect(merged).toHaveLength(2);
    expect(merged).toContain(usgsEvent);
    expect(merged).toContain(emscOnly);
    expect(merged.find((e) => e.id === "20260813_0000099")?.provenance.provider).toBe("emsc");
  });

  it("close-in-time but far-away events are NOT deduplicated (distance guard)", () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    // Simultaneous but ~222 km north — two distinct quakes.
    const emscOther = makeEvent("emsc", "20260813_0000050", { lat: BASE_LAT + 2.0 });

    const merged = mergeProviderEvents([[usgsEvent], [emscOther]]);

    expect(merged).toHaveLength(2);
  });

  it("empty EMSC list → the USGS list unchanged (USGS-only degraded mode)", () => {
    const usgsEvents = [
      makeEvent("usgs", "us1", { originTime: BASE_TIME }),
      makeEvent("usgs", "us2", { originTime: BASE_TIME - 60_000 }),
    ];
    expect(mergeProviderEvents([usgsEvents, []])).toEqual(usgsEvents);
  });

  it("empty USGS list → the EMSC list (EMSC-only degraded mode, the old failover outcome)", () => {
    const emscEvents = [makeEvent("emsc", "e1"), makeEvent("emsc", "e2", { lat: 36.5 })];
    expect(mergeProviderEvents([[], emscEvents])).toEqual(emscEvents);
  });

  it("both lists empty → empty list", () => {
    expect(mergeProviderEvents([[], []])).toEqual([]);
  });

  it("orders the merged list by origin time, newest first", () => {
    const older = makeEvent("usgs", "us_old", { originTime: BASE_TIME - 7_200_000 });
    const newest = makeEvent("emsc", "e_new", {
      originTime: BASE_TIME + 3_600_000,
      lat: 37.0,
    });
    const middle = makeEvent("usgs", "us_mid", { originTime: BASE_TIME });

    const merged = mergeProviderEvents([[older, middle], [newest]]);

    expect(merged.map((e) => e.id)).toEqual(["e_new", "us_mid", "us_old"]);
  });

  it("checks each EMSC event against every USGS event in its time window, not just the first", () => {
    const usgsA = makeEvent("usgs", "usA", { originTime: BASE_TIME });
    const usgsB = makeEvent("usgs", "usB", { originTime: BASE_TIME + 60_000 });
    // Twin of usgsB only: Δt vs A is 64 s (outside the 16 s window),
    // Δt vs B is 4 s (inside) at the same epicenter.
    const emscTwinOfB = makeEvent("emsc", "eB", { originTime: BASE_TIME + 64_000 });

    const merged = mergeProviderEvents([[usgsA, usgsB], [emscTwinOfB]]);

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

    const merged = mergeProviderEvents([usgsEvents, emscEvents]);

    const surfaced = merged.find((e) => e.id === "20260813_0000321");
    expect(surfaced).toBeDefined();
    expect(surfaced?.provenance.provider).toBe("emsc");
    expect(surfaced?.magnitude.value).toBe(4.0);
    // The overlapping event stayed single, under its USGS record.
    expect(merged).toHaveLength(3);
    expect(merged.filter((e) => e.provenance.provider === "usgs")).toHaveLength(2);
  });
});

/**
 * Three-way goldens (GEOFON wave): `mergeProviderEvents` takes the lists in
 * canonical authority order — [USGS, EMSC, GEOFON] per D4 — and an event
 * matched in ANY earlier list dedups away. The GEOFON twin below uses the
 * VERIFIED live gfz2026oyxe record (2026-08-01 20:27:43 UTC, mb 4.48,
 * 35.406/44.659, 55 km, Iraq) as its parameter template.
 */
describe("mergeProviderEvents — three-way (USGS, EMSC, GEOFON)", () => {
  const GFZ_TIME = Date.UTC(2026, 7, 1, 20, 27, 43, 70);

  function gfzTwin(provider: EventProvider, id: string, dtMs: number, mag: number): Event {
    return makeEvent(provider, id, {
      originTime: GFZ_TIME + dtMs,
      lat: 35.406,
      lon: 44.659,
      mag,
    });
  }

  it("an event in all three catalogs survives only as its USGS record", () => {
    const usgs = gfzTwin("usgs", "us7000gfz1", 2_000, 4.5);
    const emsc = gfzTwin("emsc", "20260801_0000077", 1_000, 4.4);
    const geofon = gfzTwin("geofon", "gfz2026oyxe", 0, 4.48);

    const merged = mergeProviderEvents([[usgs], [emsc], [geofon]]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(usgs);
  });

  it("an event in EMSC and GEOFON only survives as its EMSC record (EMSC outranks GEOFON)", () => {
    const emsc = gfzTwin("emsc", "20260801_0000077", 1_000, 4.4);
    const geofon = gfzTwin("geofon", "gfz2026oyxe", 0, 4.48);

    const merged = mergeProviderEvents([[], [emsc], [geofon]]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(emsc);
    expect(merged[0]?.provenance.provider).toBe("emsc");
  });

  it("a GEOFON-only event passes through as-is, provider chip intact", () => {
    const usgs = makeEvent("usgs", "usX", { originTime: GFZ_TIME - 6 * 60 * 60 * 1000 });
    const geofonOnly = gfzTwin("geofon", "gfz2026oyxe", 0, 4.48);

    const merged = mergeProviderEvents([[usgs], [], [geofonOnly]]);

    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.id === "gfz2026oyxe")?.provenance.provider).toBe("geofon");
  });

  it("a GEOFON event matching a USGS record (but no EMSC record) still dedups away", () => {
    const usgs = gfzTwin("usgs", "us7000gfz1", 0, 4.5);
    const emscUnrelated = makeEvent("emsc", "e_far", {
      originTime: GFZ_TIME - 2 * 60 * 60 * 1000,
      lat: 37.5,
      lon: 43.0,
    });
    const geofonDuplicate = gfzTwin("geofon", "gfz2026oyxe", 4_000, 4.48);

    const merged = mergeProviderEvents([[usgs], [emscUnrelated], [geofonDuplicate]]);

    expect(merged.map((e) => e.id).sort()).toEqual(["e_far", "us7000gfz1"]);
  });

  it("boundary: a GEOFON record exactly at the 16 s window vs the EMSC survivor dedups; 1 ms past survives", () => {
    const emsc = gfzTwin("emsc", "20260801_0000077", 0, 4.4);
    const atBoundary = gfzTwin("geofon", "gfz_at", DEDUP_MAX_TIME_DELTA_MS, 4.4);
    const pastBoundary = gfzTwin("geofon", "gfz_past", DEDUP_MAX_TIME_DELTA_MS + 1, 4.4);

    expect(mergeProviderEvents([[], [emsc], [atBoundary]])).toHaveLength(1);
    expect(mergeProviderEvents([[], [emsc], [pastBoundary]])).toHaveLength(2);
  });

  it("events are never deduplicated within their own provider's list", () => {
    // Two same-provider records inside the match window — a provider's own
    // catalog is trusted to be internally deduplicated, so both survive.
    const a = gfzTwin("geofon", "gfz_a", 0, 4.4);
    const b = gfzTwin("geofon", "gfz_b", 5_000, 4.5);

    expect(mergeProviderEvents([[], [], [a, b]])).toHaveLength(2);
  });

  it("single-list and empty-list degenerate inputs behave like the old two-way merge", () => {
    const geofonOnlyList = [gfzTwin("geofon", "gfz2026oyxe", 0, 4.48)];
    expect(mergeProviderEvents([[], [], geofonOnlyList])).toEqual(geofonOnlyList);
    expect(mergeProviderEvents([[], [], []])).toEqual([]);
    expect(mergeProviderEvents([])).toEqual([]);
  });

  it("orders the three-way merged list by origin time, newest first, across providers", () => {
    const usgs = makeEvent("usgs", "us_mid", { originTime: GFZ_TIME });
    const emsc = makeEvent("emsc", "e_old", {
      originTime: GFZ_TIME - 3_600_000,
      lat: 36.8,
    });
    const geofon = makeEvent("geofon", "gfz_new", {
      originTime: GFZ_TIME + 3_600_000,
      lat: 33.9,
    });

    const merged = mergeProviderEvents([[usgs], [emsc], [geofon]]);

    expect(merged.map((e) => e.id)).toEqual(["gfz_new", "us_mid", "e_old"]);
  });
});
