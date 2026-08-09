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

// Imported after the mocks above so `fetchRegionEventsWithFailover` picks
// up the mocked `fetchUsgsRegionEvents`/`fetchEmscRegionEvents`.
// eslint-disable-next-line import/first -- see comment above
import { fetchRegionEventsWithFailover } from "../queries";
// eslint-disable-next-line import/first -- see comment above
import { fetchEmscRegionEvents } from "../emsc";
// eslint-disable-next-line import/first -- see comment above
import { fetchUsgsRegionEvents } from "../usgs";

const mockFetchUsgsRegionEvents = fetchUsgsRegionEvents as jest.Mock;
const mockFetchEmscRegionEvents = fetchEmscRegionEvents as jest.Mock;

function makeEvent(provider: "usgs" | "emsc", id: string): Event {
  return {
    id,
    originTime: 1_700_000_000_000,
    lat: 35.3,
    lon: 45.9,
    depthKm: 10,
    magnitude: { value: 4.6, type: provider === "usgs" ? "mb" : "mw" },
    placeName: "Test place",
    provenance: {
      provider,
      providerId: id,
      fetchedAt: 1_700_000_500_000,
      providerUpdatedAt: 1_700_000_100_000,
    },
    sig: 460,
    isRegional: true,
    url: "",
  };
}

/**
 * Failover-orchestration coverage for `fetchRegionEventsWithFailover`
 * (queries.ts, wave brief point 2 — "USGS-primary with EMSC fallback").
 * `fetchUsgsRegionEvents`/`fetchEmscRegionEvents` are mocked here rather
 * than `global.fetch` (unlike emsc.test.ts/usgs.test.ts) because this suite
 * is testing the ORCHESTRATION between the two providers, not either
 * provider's own parsing — that's already covered by emsc.test.ts and
 * usgs.test.ts.
 */
describe("fetchRegionEventsWithFailover", () => {
  beforeEach(() => {
    mockFetchUsgsRegionEvents.mockReset();
    mockFetchEmscRegionEvents.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves EMSC's events when the USGS fetch rejects outright", async () => {
    mockFetchUsgsRegionEvents.mockRejectedValue(new Error("network down"));
    const emscEvent = makeEvent("emsc", "20230206_0000008");
    mockFetchEmscRegionEvents.mockResolvedValue({
      events: [emscEvent],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });

    const result = await fetchRegionEventsWithFailover();

    expect(result.events).toEqual([emscEvent]);
    expect(mockFetchUsgsRegionEvents).toHaveBeenCalledTimes(1);
    expect(mockFetchEmscRegionEvents).toHaveBeenCalledTimes(1);
  });

  it("serves EMSC's events when the USGS fetch times out (aborted after the config budget)", async () => {
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
    mockFetchEmscRegionEvents.mockResolvedValue({
      events: [emscEvent],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });

    const resultPromise = fetchRegionEventsWithFailover();
    await jest.advanceTimersByTimeAsync(USGS_REGION_TIMEOUT_MS);
    const result = await resultPromise;

    expect(result.events).toEqual([emscEvent]);
    // The signal actually passed to USGS's fetch is the one this function
    // aborts — confirms the timeout is wired through, not just coincidental.
    const [signalArg] = mockFetchUsgsRegionEvents.mock.calls[0] as [AbortSignal];
    expect(signalArg.aborted).toBe(true);
  });

  it("propagates the failure when BOTH USGS and EMSC fail — existing error/cached state unchanged", async () => {
    mockFetchUsgsRegionEvents.mockRejectedValue(new Error("usgs down"));
    mockFetchEmscRegionEvents.mockRejectedValue(new Error("emsc down too"));

    await expect(fetchRegionEventsWithFailover()).rejects.toThrow("emsc down too");
  });

  it("goes back to serving USGS once it recovers on a later poll (recovery swap)", async () => {
    // First poll: USGS down, EMSC serves.
    mockFetchUsgsRegionEvents.mockRejectedValueOnce(new Error("network down"));
    const emscEvent = makeEvent("emsc", "20230206_0000008");
    mockFetchEmscRegionEvents.mockResolvedValueOnce({
      events: [emscEvent],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });

    const firstPoll = await fetchRegionEventsWithFailover();
    expect(firstPoll.events).toEqual([emscEvent]);

    // Second poll (same query key in queries.ts — React Query just replaces
    // the cached data returned by this same function): USGS answers again.
    const usgsEvent = makeEvent("usgs", "us7000abcd");
    mockFetchUsgsRegionEvents.mockResolvedValueOnce({
      events: [usgsEvent],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });

    const secondPoll = await fetchRegionEventsWithFailover();

    expect(secondPoll.events).toEqual([usgsEvent]);
    // EMSC was never consulted on the second poll — USGS answering is enough.
    expect(mockFetchEmscRegionEvents).toHaveBeenCalledTimes(1);
  });
});
