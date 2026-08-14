import { USGS_REGION_TIMEOUT_MS } from "../config";
import type { Event } from "../types";

jest.mock("../usgs", () => ({
  ...jest.requireActual("../usgs"),
  fetchUsgsRegionEvents: jest.fn(),
}));
jest.mock("../emsc", () => ({
  ...jest.requireActual("../emsc"),
  fetchEmscRegionEvents: jest.fn(),
}));
jest.mock("../geofon", () => ({
  ...jest.requireActual("../geofon"),
  fetchGeofonRegionEvents: jest.fn(),
}));

// Imported after the mocks above so `fetchRegionEventsMerged` picks up the
// mocked `fetchUsgsRegionEvents`/`fetchEmscRegionEvents`.
// eslint-disable-next-line import/first -- see comment above
import { fetchRegionEventsMerged } from "../queries";
// eslint-disable-next-line import/first -- see comment above
import { fetchEmscRegionEvents } from "../emsc";
// eslint-disable-next-line import/first -- see comment above
import { fetchGeofonRegionEvents } from "../geofon";
// eslint-disable-next-line import/first -- see comment above
import { fetchUsgsRegionEvents } from "../usgs";

const mockFetchUsgsRegionEvents = fetchUsgsRegionEvents as jest.Mock;
const mockFetchEmscRegionEvents = fetchEmscRegionEvents as jest.Mock;
const mockFetchGeofonRegionEvents = fetchGeofonRegionEvents as jest.Mock;

function makeEvent(
  provider: "usgs" | "emsc" | "geofon",
  id: string,
  overrides: Partial<Pick<Event, "originTime" | "lat" | "lon">> & { mag?: number } = {},
): Event {
  const mag = overrides.mag ?? 4.6;
  return {
    id,
    originTime: overrides.originTime ?? 1_700_000_000_000,
    lat: overrides.lat ?? 35.3,
    lon: overrides.lon ?? 45.9,
    depthKm: 10,
    magnitude: { value: mag, type: provider === "usgs" ? "mb" : "mw" },
    placeName: "Test place",
    provenance: {
      provider,
      providerId: id,
      fetchedAt: 1_700_000_500_000,
      providerUpdatedAt: 1_700_000_100_000,
    },
    sig: Math.round(100 * mag),
    isRegional: true,
    url: "",
  };
}

function okResult(events: Event[]) {
  return { events, skippedCount: 0, fetchedAt: Date.now() };
}

/**
 * Orchestration coverage for `fetchRegionEventsMerged` (queries.ts) — the
 * parallel USGS+EMSC+GEOFON completeness merge that replaced the old
 * availability-only failover. The three provider fetch fns
 * are mocked here rather than `global.fetch` (unlike emsc.test.ts/
 * usgs.test.ts/geofon.test.ts) because this suite is testing the
 * ORCHESTRATION between the providers, not any provider's own parsing; the merge algorithm
 * itself is covered by merge.test.ts.
 */
describe("fetchRegionEventsMerged", () => {
  beforeEach(() => {
    mockFetchUsgsRegionEvents.mockReset();
    mockFetchEmscRegionEvents.mockReset();
    mockFetchGeofonRegionEvents.mockReset();
    // Most pre-GEOFON scenarios below are about the USGS/EMSC interplay —
    // a healthy-but-empty GEOFON leg keeps them exercising exactly what
    // they always did; the three-way cases override this default.
    mockFetchGeofonRegionEvents.mockResolvedValue(okResult([]));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("consults BOTH providers on every poll, even when USGS is healthy — the completeness-merge semantic", async () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    const emscOnlyEvent = makeEvent("emsc", "20260813_0000321", {
      originTime: 1_700_000_000_000 - 3_600_000, // a different quake, an hour earlier
      mag: 4.0,
    });
    mockFetchUsgsRegionEvents.mockResolvedValue(okResult([usgsEvent]));
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([emscOnlyEvent]));

    const result = await fetchRegionEventsMerged();

    // Both fetched, once each — under failover EMSC would never have been called.
    expect(mockFetchUsgsRegionEvents).toHaveBeenCalledTimes(1);
    expect(mockFetchEmscRegionEvents).toHaveBeenCalledTimes(1);
    // Mixed-provider list is the whole point.
    expect(result.events).toHaveLength(2);
    expect(result.events).toContain(usgsEvent);
    expect(result.events).toContain(emscOnlyEvent);
  });

  it("dedups cross-provider duplicates in the merged result, keeping the USGS record", async () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    const emscDuplicate = makeEvent("emsc", "20260813_0000200", {
      originTime: 1_700_000_000_000 + 5_000, // 5 s later, same epicenter
      mag: 4.4,
    });
    mockFetchUsgsRegionEvents.mockResolvedValue(okResult([usgsEvent]));
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([emscDuplicate]));

    const result = await fetchRegionEventsMerged();

    expect(result.events).toEqual([usgsEvent]);
  });

  it("sums both providers' skippedCounts when both succeed", async () => {
    mockFetchUsgsRegionEvents.mockResolvedValue({
      events: [],
      skippedCount: 2,
      fetchedAt: Date.now(),
    });
    mockFetchEmscRegionEvents.mockResolvedValue({
      events: [],
      skippedCount: 3,
      fetchedAt: Date.now(),
    });

    const result = await fetchRegionEventsMerged();

    expect(result.skippedCount).toBe(5);
  });

  it("serves the USGS list alone when EMSC fails (USGS-only degraded mode)", async () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    mockFetchUsgsRegionEvents.mockResolvedValue(okResult([usgsEvent]));
    mockFetchEmscRegionEvents.mockRejectedValue(new Error("emsc down"));

    const result = await fetchRegionEventsMerged();

    expect(result.events).toEqual([usgsEvent]);
  });

  it("serves the EMSC list alone when USGS fails (the old failover outcome as a special case)", async () => {
    const emscEvent = makeEvent("emsc", "20230206_0000008");
    mockFetchUsgsRegionEvents.mockRejectedValue(new Error("network down"));
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([emscEvent]));

    const result = await fetchRegionEventsMerged();

    expect(result.events).toEqual([emscEvent]);
  });

  it("drops a timed-out USGS leg (aborted after its config budget) without losing the EMSC leg", async () => {
    jest.useFakeTimers();

    // Simulate `fetch`'s real behavior under AbortController: the promise
    // never resolves on its own, only rejects once the signal aborts.
    mockFetchUsgsRegionEvents.mockImplementation(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    );
    const emscEvent = makeEvent("emsc", "20230206_0000008");
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([emscEvent]));

    const resultPromise = fetchRegionEventsMerged();
    await jest.advanceTimersByTimeAsync(USGS_REGION_TIMEOUT_MS);
    const result = await resultPromise;

    expect(result.events).toEqual([emscEvent]);
    // The signal actually passed to USGS's fetch is the one this function
    // aborts — confirms the per-leg timeout is wired through.
    const [signalArg] = mockFetchUsgsRegionEvents.mock.calls[0] as [AbortSignal];
    expect(signalArg.aborted).toBe(true);
  });

  it("propagates the failure when ALL providers fail — existing error/cached state unchanged", async () => {
    mockFetchUsgsRegionEvents.mockRejectedValue(new Error("usgs down"));
    mockFetchEmscRegionEvents.mockRejectedValue(new Error("emsc down too"));
    mockFetchGeofonRegionEvents.mockRejectedValue(new Error("geofon down too"));

    await expect(fetchRegionEventsMerged()).rejects.toThrow("usgs down");
  });

  /**
   * REGRESSION — the real missed earthquake: 2026-08-13 22:28 UTC, M4.0 mb,
   * "IRAN-IRAQ BORDER REGION". In EMSC's fdsnws response, absent from USGS
   * entirely (below NEIC's ~M4.5 regional completeness). The old failover
   * never consulted EMSC while USGS was healthy, so this event never
   * surfaced. It must now appear in the merged feed, tagged "emsc".
   */
  it("surfaces an EMSC-only M4.0 border event while USGS is healthy but incomplete", async () => {
    const usgsHealthyButIncomplete = [
      makeEvent("usgs", "us7000qxyz", {
        originTime: Date.UTC(2026, 7, 13, 4, 10, 0),
        lat: 37.1,
        lon: 43.2,
        mag: 4.6,
      }),
    ];
    const borderEvent = makeEvent("emsc", "20260813_0000321", {
      originTime: Date.UTC(2026, 7, 13, 22, 28, 0),
      lat: 34.9,
      lon: 45.9,
      mag: 4.0,
    });
    mockFetchUsgsRegionEvents.mockResolvedValue(okResult(usgsHealthyButIncomplete));
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([borderEvent]));

    const result = await fetchRegionEventsMerged();

    const surfaced = result.events.find((e) => e.id === "20260813_0000321");
    expect(surfaced).toBeDefined();
    expect(surfaced?.provenance.provider).toBe("emsc");
    expect(surfaced?.magnitude.value).toBe(4.0);
    expect(result.events).toHaveLength(2);
  });

  it("consults all THREE providers each poll and surfaces a GEOFON-only event (gfz2026oyxe)", async () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    // The verified live GEOFON record this wave was built against:
    // mb 4.48 at 55 km under Iraq — nowhere in USGS or EMSC.
    const geofonOnly = makeEvent("geofon", "gfz2026oyxe", {
      originTime: Date.UTC(2026, 7, 1, 20, 27, 43, 70),
      lat: 35.406,
      lon: 44.659,
      mag: 4.48,
    });
    mockFetchUsgsRegionEvents.mockResolvedValue(okResult([usgsEvent]));
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([]));
    mockFetchGeofonRegionEvents.mockResolvedValue(okResult([geofonOnly]));

    const result = await fetchRegionEventsMerged();

    expect(mockFetchUsgsRegionEvents).toHaveBeenCalledTimes(1);
    expect(mockFetchEmscRegionEvents).toHaveBeenCalledTimes(1);
    expect(mockFetchGeofonRegionEvents).toHaveBeenCalledTimes(1);
    expect(result.events).toHaveLength(2);
    expect(result.events.find((e) => e.id === "gfz2026oyxe")?.provenance.provider).toBe(
      "geofon",
    );
  });

  it("dedups a three-way duplicate down to the single USGS record (priority = leg order)", async () => {
    const baseTime = Date.UTC(2026, 7, 1, 20, 27, 43);
    const usgsRecord = makeEvent("usgs", "us7000gfz1", { originTime: baseTime + 2_000, mag: 4.5 });
    const emscRecord = makeEvent("emsc", "20260801_0000077", {
      originTime: baseTime + 1_000,
      mag: 4.4,
    });
    const geofonRecord = makeEvent("geofon", "gfz2026oyxe", { originTime: baseTime, mag: 4.48 });
    mockFetchUsgsRegionEvents.mockResolvedValue(okResult([usgsRecord]));
    mockFetchEmscRegionEvents.mockResolvedValue(okResult([emscRecord]));
    mockFetchGeofonRegionEvents.mockResolvedValue(okResult([geofonRecord]));

    const result = await fetchRegionEventsMerged();

    expect(result.events).toEqual([usgsRecord]);
  });

  it("serves the GEOFON list alone when USGS and EMSC both fail (deepest degraded mode)", async () => {
    const geofonEvent = makeEvent("geofon", "gfz2026oyxe");
    mockFetchUsgsRegionEvents.mockRejectedValue(new Error("usgs down"));
    mockFetchEmscRegionEvents.mockRejectedValue(new Error("emsc down"));
    mockFetchGeofonRegionEvents.mockResolvedValue(okResult([geofonEvent]));

    const result = await fetchRegionEventsMerged();

    expect(result.events).toEqual([geofonEvent]);
  });

  it("sums all three providers' skippedCounts", async () => {
    mockFetchUsgsRegionEvents.mockResolvedValue({ events: [], skippedCount: 2, fetchedAt: 1 });
    mockFetchEmscRegionEvents.mockResolvedValue({ events: [], skippedCount: 3, fetchedAt: 2 });
    mockFetchGeofonRegionEvents.mockResolvedValue({ events: [], skippedCount: 4, fetchedAt: 3 });

    const result = await fetchRegionEventsMerged();

    expect(result.skippedCount).toBe(9);
    expect(result.fetchedAt).toBe(3);
  });
});
