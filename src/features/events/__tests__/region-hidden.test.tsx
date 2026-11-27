import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { indexHidden } from "@/features/home-extras/hidden";
import { homeExtrasKeys } from "@/features/home-extras/queries";
import type { HiddenEarthquake, HomeExtras } from "@/features/home-extras/transport";
import type { Event } from "../types";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
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
import { mergeProviderEvents, remergeWithout } from "../merge";
// eslint-disable-next-line import/first -- imported after the mocks above
import {
  eventsQueryKeys,
  fetchRegionEventsMerged,
  REGION_PROVIDER_ORDER,
  useRegionEvents,
} from "../queries";
// eslint-disable-next-line import/first -- imported after the mocks above
import { fetchUsgsRegionEvents } from "../usgs";

const mockUsgs = fetchUsgsRegionEvents as jest.Mock;
const mockEmsc = fetchEmscRegionEvents as jest.Mock;
const mockGeofon = fetchGeofonRegionEvents as jest.Mock;

const T = 1_764_000_000_000;

function quake(provider: Event["provenance"]["provider"], id: string, dt = 0): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: T + dt,
    lat: 35.2,
    lon: 45.9,
    depthKm: 10,
    magnitude: { value: 4.6, type: "mb" },
    placeName: "",
    provenance: { provider, providerId: id, fetchedAt: T, providerUpdatedAt: T },
    sig: 460,
    isRegional: true,
    url: "",
  };
}

// One earthquake, two agency records that match (5 s apart): the merge keeps
// USGS and drops EMSC.
const usgs = quake("usgs", "us7000qa01");
const emsc = quake("emsc", "20261127_0000042", 5_000);
// Another earthquake, nothing to do with the hidden one.
const other = quake("usgs", "us7000qa09", -3_600_000);

const hideUsgsKeepEmsc: HiddenEarthquake = {
  bumelerzeId: "bml20260a01",
  providerIds: ["us7000qa01"],
  reasonKind: "duplicate",
  kept: { bumelerzeId: "bml20260a02", providerIds: ["20261127_0000042"] },
};
const hideEmscKeepUsgs: HiddenEarthquake = {
  bumelerzeId: "bml20260a02",
  providerIds: ["20261127_0000042"],
  reasonKind: "duplicate",
  kept: { bumelerzeId: "bml20260a01", providerIds: ["us7000qa01"] },
};

function dropFor(list: HiddenEarthquake[]) {
  const index = indexHidden(list);
  return (event: Event) =>
    index.byId.has(event.id) || index.byId.has(event.provenance.providerId);
}

describe("remergeWithout: hidden agency records out BEFORE the merge (migration 0085)", () => {
  const merged = mergeProviderEvents([[usgs, other], [emsc], []]);
  const absorbed = [emsc];

  it("starts from today's merge: USGS kept, the matching EMSC record dropped", () => {
    expect(merged).toEqual([usgs, other]);
  });

  it("(a) USGS hidden, EMSC kept, the two matching: the EMSC card shows, the USGS one does not", () => {
    const out = remergeWithout(
      merged,
      absorbed,
      REGION_PROVIDER_ORDER,
      dropFor([hideUsgsKeepEmsc]),
    );
    expect(out.map((e) => e.id)).toEqual(["20261127_0000042", "us7000qa09"]);
    // The old way (filter after the merge only) lost the earthquake entirely.
    expect(
      merged.filter((e) => !dropFor([hideUsgsKeepEmsc])(e)).map((e) => e.id),
    ).toEqual(["us7000qa09"]);
  });

  it("(b) the reverse: EMSC hidden, USGS kept: the USGS card shows, the EMSC one does not", () => {
    const out = remergeWithout(
      merged,
      absorbed,
      REGION_PROVIDER_ORDER,
      dropFor([hideEmscKeepUsgs]),
    );
    expect(out.map((e) => e.id)).toEqual(["us7000qa01", "us7000qa09"]);
  });

  it("(c) nothing hidden: exactly today's list, the same array", () => {
    expect(remergeWithout(merged, absorbed, REGION_PROVIDER_ORDER, () => false)).toBe(
      merged,
    );
    expect(remergeWithout(merged, [], REGION_PROVIDER_ORDER, dropFor([]))).toBe(merged);
  });

  it("(d) a removed earthquake reported by two agencies: both records gone", () => {
    const removed: HiddenEarthquake = {
      bumelerzeId: "bml20260a03",
      providerIds: ["us7000qa01", "20261127_0000042"],
      reasonKind: "removed",
      kept: null,
    };
    const out = remergeWithout(
      merged,
      absorbed,
      REGION_PROVIDER_ORDER,
      dropFor([removed]),
    );
    expect(out.map((e) => e.id)).toEqual(["us7000qa09"]);
  });

  it("keeps the agencies' priority: a GEOFON copy loses to the EMSC card that stays", () => {
    const geofon = quake("geofon", "gfz2026qa01", 2_000);
    const all = mergeProviderEvents([[usgs], [emsc], [geofon]]);
    expect(all).toEqual([usgs]);
    const out = remergeWithout(
      all,
      [emsc, geofon],
      REGION_PROVIDER_ORDER,
      dropFor([hideUsgsKeepEmsc]),
    );
    expect(out).toEqual([emsc]);
  });
});

describe("fetchRegionEventsMerged keeps what the merge dropped", () => {
  beforeEach(() => {
    mockUsgs
      .mockReset()
      .mockResolvedValue({ events: [usgs, other], skippedCount: 0, fetchedAt: T });
    mockEmsc
      .mockReset()
      .mockResolvedValue({ events: [emsc], skippedCount: 0, fetchedAt: T });
    mockGeofon
      .mockReset()
      .mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: T });
  });

  it("returns today's merged list plus the absorbed records", async () => {
    const result = await fetchRegionEventsMerged();
    expect(result.events).toEqual([usgs, other]);
    expect(result.absorbed).toEqual([emsc]);
  });

  it("adds no absorbed key when nothing matched", async () => {
    mockEmsc.mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: T });
    const result = await fetchRegionEventsMerged();
    expect(result).not.toHaveProperty("absorbed");
  });
});

describe("useRegionEvents: the hidden list from the device copy, applied before the merge", () => {
  afterEach(cleanup);

  function setup(hidden: HiddenEarthquake[] | null, absorbed: Event[] | null = [emsc]) {
    // The feed is never fetched here: the saved copy is what the screen has.
    mockUsgs.mockReset().mockImplementation(() => new Promise(() => undefined));
    mockEmsc.mockReset().mockImplementation(() => new Promise(() => undefined));
    mockGeofon.mockReset().mockImplementation(() => new Promise(() => undefined));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      },
    });
    client.setQueryData(eventsQueryKeys.region, {
      events: [usgs, other],
      skippedCount: 0,
      fetchedAt: T,
      ...(absorbed ? { absorbed } : {}),
    });
    if (hidden) {
      const extras: HomeExtras = { notice: null, pins: [], hidden };
      client.setQueryData(homeExtrasKeys.all, extras);
    }
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    return { client, Wrapper };
  }

  it("(a) shows the EMSC card that stays, not the hidden USGS record", async () => {
    const { client, Wrapper } = setup([hideUsgsKeepEmsc]);
    const { result } = await renderHook(() => useRegionEvents(), { wrapper: Wrapper });
    expect(result.current.events.map((e) => e.id)).toEqual([
      "20261127_0000042",
      "us7000qa09",
    ]);
    client.clear();
  });

  it("(c) with no hidden list on the device, the feed is exactly today's", async () => {
    const { client, Wrapper } = setup(null);
    const { result } = await renderHook(() => useRegionEvents(), { wrapper: Wrapper });
    const saved = client.getQueryData<{ events: Event[] }>(eventsQueryKeys.region);
    expect(result.current.events).toBe(saved?.events);
    client.clear();
  });

  it("re-applies at once when the hidden list changes, without fetching anything", async () => {
    const { client, Wrapper } = setup([]);
    const { result } = await renderHook(() => useRegionEvents(), { wrapper: Wrapper });
    expect(result.current.events.map((e) => e.id)).toEqual(["us7000qa01", "us7000qa09"]);
    await act(async () => {
      client.setQueryData(homeExtrasKeys.all, {
        notice: null,
        pins: [],
        hidden: [hideUsgsKeepEmsc],
      });
    });
    await waitFor(() =>
      expect(result.current.events.map((e) => e.id)).toEqual([
        "20261127_0000042",
        "us7000qa09",
      ]),
    );
    // Shown again: back to today's list.
    await act(async () => {
      client.setQueryData(homeExtrasKeys.all, { notice: null, pins: [], hidden: [] });
    });
    await waitFor(() =>
      expect(result.current.events.map((e) => e.id)).toEqual([
        "us7000qa01",
        "us7000qa09",
      ]),
    );
    expect(mockUsgs).not.toHaveBeenCalled();
    client.clear();
  });

  it("a copy saved before 26.5.2 (no absorbed records) still drops the hidden one", async () => {
    const { client, Wrapper } = setup([hideUsgsKeepEmsc], null);
    const { result } = await renderHook(() => useRegionEvents(), { wrapper: Wrapper });
    expect(result.current.events.map((e) => e.id)).toEqual(["us7000qa09"]);
    client.clear();
  });
});
