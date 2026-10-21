import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import type { Event } from "../types";

jest.mock("../config", () => ({
  ...jest.requireActual("../config"),
  REGION_FIRST_LOAD_GRACE_MS: 50,
}));
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

// eslint-disable-next-line import/first -- imported after the mocks above
import { fetchEmscRegionEvents } from "../emsc";
// eslint-disable-next-line import/first -- imported after the mocks above
import { fetchGeofonRegionEvents } from "../geofon";
// eslint-disable-next-line import/first -- imported after the mocks above
import { useRegionEvents } from "../queries";
// eslint-disable-next-line import/first -- imported after the mocks above
import { fetchUsgsRegionEvents } from "../usgs";

const mockUsgs = fetchUsgsRegionEvents as jest.Mock;
const mockEmsc = fetchEmscRegionEvents as jest.Mock;
const mockGeofon = fetchGeofonRegionEvents as jest.Mock;

function makeEvent(provider: "usgs" | "geofon", id: string, originTime: number): Event {
  return {
    id,
    bumelerzeId: null,
    originTime,
    lat: provider === "usgs" ? 35.3 : 37.1,
    lon: provider === "usgs" ? 45.9 : 44.2,
    depthKm: 10,
    magnitude: { value: 4.2, type: "mb" },
    placeName: "Test place",
    provenance: {
      provider,
      providerId: id,
      fetchedAt: 1_700_000_500_000,
      providerUpdatedAt: 1_700_000_100_000,
    },
    sig: 420,
    isRegional: true,
    url: "",
  };
}

function okResult(events: Event[]) {
  return { events, skippedCount: 0, fetchedAt: Date.now() };
}

/**
 * Home's first load (no saved list) must not wait for a hanging source: the
 * list shows once the others answer, then the hook asks again at once, with
 * the full budget, so the slow source's events still arrive.
 */
describe("useRegionEvents first load with a slow source", () => {
  it("shows the answered sources first, then fetches again and adds the slow source's events", async () => {
    const usgsEvent = makeEvent("usgs", "us7000abcd", 1_700_000_000_000);
    const geofonEvent = makeEvent("geofon", "gfz2026uvwx", 1_700_200_000_000);
    mockUsgs.mockResolvedValue(okResult([usgsEvent]));
    mockEmsc.mockResolvedValue(okResult([]));
    mockGeofon
      // First load: GEOFON hangs until the grace cuts it.
      .mockImplementationOnce(
        (signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("AbortError")));
          }),
      )
      // The follow-up: answers later than the grace — kept only if the
      // follow-up runs with the full budget.
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(okResult([geofonEvent])), 200)),
      );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result, unmount } = await renderHook(() => useRegionEvents(), { wrapper });

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false), {
      timeout: 1_000,
    });
    expect(result.current.events.map((event) => event.id)).toEqual([usgsEvent.id]);

    await waitFor(
      () =>
        expect(result.current.events.map((event) => event.id)).toContain(geofonEvent.id),
      { timeout: 2_000 },
    );
    expect(mockGeofon).toHaveBeenCalledTimes(2);

    unmount();
    client.clear();
  });
});
