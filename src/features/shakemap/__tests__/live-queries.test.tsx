import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import type { Event } from "@/features/events";
import {
  liveShakeMapQueryKeys,
  useLiveShakeMap,
  useLiveShakeMapUnavailable,
} from "../live-queries";
import type { LiveShakeMapTransport } from "../live-transport";
import type { LiveShakeMapProduct } from "../live-types";

/** Same per-key env toggling as `feltmap/__tests__/queries.test.tsx` — see
 * that file's own doc comment for why a wholesale `process.env` reassign
 * breaks React Query's re-render notification under this repo's
 * jest-expo/react-query combination. */
function setSupabaseConfigured(configured: boolean): void {
  if (configured) {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key-value";
  } else {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  }
}

const EVENT: Event = {
  id: "us2000bmcg",
  bumelerzeId: null,
  originTime: 1510510697000,
  lat: 34.9109,
  lon: 45.9592,
  depthKm: 19,
  magnitude: { value: 7.3, type: "mww" },
  placeName: "29 km S of Halabja, Iraq",
  provenance: {
    provider: "usgs",
    providerId: "us2000bmcg",
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 730,
  isRegional: true,
  url: "",
};

function fixtureProduct(overrides: Partial<LiveShakeMapProduct> = {}): LiveShakeMapProduct {
  return {
    eventId: "us2000bmcg",
    producer: "bumelerze",
    version: 2,
    reviewStatus: "automatic",
    dataUsedSummaryKey: "stationConditioned",
    generatedAt: "2026-08-18T00:00:00.000Z",
    contours: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { value: 6 },
          geometry: { type: "MultiLineString", coordinates: [[[45, 35], [45.1, 35.1], [45.2, 35.2]]] },
        },
      ],
    },
    engineVersion: { serviceVersion: "0.1.0", gsimBranches: null, emsModel: null, mmiModel: null, conditioning: null },
    ...overrides,
  };
}

function fixtureTransport(product: LiveShakeMapProduct | null): LiveShakeMapTransport {
  return { fetchLiveProduct: jest.fn(async () => product) };
}

function throwingTransport(error: unknown): LiveShakeMapTransport {
  return {
    fetchLiveProduct: jest.fn(async () => {
      throw error;
    }),
  };
}

async function renderLiveShakeMap(event: Event, transport: LiveShakeMapTransport, enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useLiveShakeMap(event, enabled, transport), { wrapper });
}

describe("useLiveShakeMap", () => {
  beforeEach(() => {
    setSupabaseConfigured(false);
  });

  afterEach(() => {
    setSupabaseConfigured(false);
  });

  it("resolves to null and never calls the transport when Supabase is unconfigured", async () => {
    setSupabaseConfigured(false);
    const transport = fixtureTransport(fixtureProduct());

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
    expect(transport.fetchLiveProduct).not.toHaveBeenCalled();
  });

  it("resolves to a candidate with parsed contours once the transport returns a product", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(fixtureProduct());

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.product.version).toBe(2);
    expect(result.current?.contours.levels).toHaveLength(1);
    expect(result.current?.contours.levels[0]?.value).toBe(6);
  });

  it("resolves to null (not an error) when the transport has no product for this event", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(null);

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(transport.fetchLiveProduct).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });

  it("fails soft to null when the transport throws (network/DB failure never breaks the screen)", async () => {
    setSupabaseConfigured(true);
    const transport = throwingTransport(new Error("network down"));

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(transport.fetchLiveProduct).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });

  it("fails soft to null when the transport's product has a malformed/unparseable contours payload", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(
      fixtureProduct({ contours: { type: "NotAFeatureCollection" } }),
    );

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(transport.fetchLiveProduct).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });

  it("never fires the transport when disabled", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(fixtureProduct());

    await renderLiveShakeMap(EVENT, transport, false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.fetchLiveProduct).not.toHaveBeenCalled();
  });

  it("parses a risk bundle carried on the transport's product into the candidate's risk field", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(
      fixtureProduct({
        risk: {
          summary: {
            generated_at: "2026-09-01T00:00:00.000Z",
            stage: "pga_lognormal",
            time_of_day: "night",
            n_draws: 200,
            exposure: { buildings_in_grid: 100, countries: ["Turkey"] },
            buildings_heavy: 500,
            buildings_heavy_p05_p50_p95: [400, 500, 600],
            exposed_population: 10000,
          },
          districts: {
            stage: "pga_lognormal",
            time_of_day: "night",
            n_draws: 200,
            districts: [],
          },
          damageContours: null,
        },
      }),
    );

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.risk?.summary.buildingsHeavy).toBe(500);
    expect(result.current?.risk?.damageContours).toBeNull();
  });

  it("resolves risk to null (never breaks the contours candidate) when the risk field is malformed", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(
      fixtureProduct({ risk: { summary: "not-an-object" } as unknown as never }),
    );

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.contours.levels).toHaveLength(1);
    expect(result.current?.risk).toBeNull();
  });

  it("resolves risk to null when the transport's product carries none at all", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport(fixtureProduct());

    const { result } = await renderLiveShakeMap(EVENT, transport);

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.risk).toBeNull();
  });
});

describe("useLiveShakeMapUnavailable", () => {
  function setUp(transport: LiveShakeMapTransport, saved?: { product: LiveShakeMapProduct; updatedAt: number }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    if (saved) {
      client.setQueryData(liveShakeMapQueryKeys.event(EVENT.id), saved.product, {
        updatedAt: saved.updatedAt,
      });
    }
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    return renderHook(
      () => ({
        availability: useLiveShakeMapUnavailable(EVENT, true, transport),
        candidate: useLiveShakeMap(EVENT, true, transport),
      }),
      { wrapper },
    );
  }

  beforeEach(() => {
    setSupabaseConfigured(true);
  });

  afterEach(() => {
    setSupabaseConfigured(false);
    onlineManager.setOnline(true);
  });

  it("is false while the lookup runs, and true once it has failed (after its one retry)", async () => {
    const transport = throwingTransport(new TypeError("Network request failed"));
    const { result } = await setUp(transport);

    expect(result.current.availability.unavailable).toBe(false);
    await waitFor(() => expect(result.current.availability.unavailable).toBe(true), {
      timeout: 4000,
    });
    expect(transport.fetchLiveProduct).toHaveBeenCalledTimes(2);
  });

  it("is false once the lookup answered that this event has no map", async () => {
    const transport = fixtureTransport(null);
    const { result } = await setUp(transport);

    await waitFor(() => expect(transport.fetchLiveProduct).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.availability.unavailable).toBe(false);
  });

  it("is true offline when nothing was saved, and the lookup waits for the connection", async () => {
    onlineManager.setOnline(false);
    const transport = fixtureTransport(fixtureProduct());
    const { result } = await setUp(transport);

    await waitFor(() => expect(result.current.availability.unavailable).toBe(true));
    expect(transport.fetchLiveProduct).not.toHaveBeenCalled();

    // The connection comes back: the waiting lookup runs and the map arrives.
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(result.current.candidate).not.toBeNull());
    expect(result.current.availability.unavailable).toBe(false);
  });

  it("is false offline when a map was saved from an earlier visit, which still shows", async () => {
    onlineManager.setOnline(false);
    const transport = fixtureTransport(fixtureProduct());
    const { result } = await setUp(transport, {
      product: fixtureProduct(),
      updatedAt: Date.now() - 60 * 60 * 1000,
    });

    expect(result.current.availability.unavailable).toBe(false);
    expect(result.current.candidate?.product.version).toBe(2);
  });

  it("keeps showing a saved map when a later refresh fails", async () => {
    const transport = throwingTransport(new TypeError("Network request failed"));
    const { result } = await setUp(transport, {
      product: fixtureProduct(),
      // Older than the 15-minute freshness window, so the page asks again.
      updatedAt: Date.now() - 60 * 60 * 1000,
    });

    await waitFor(() => expect(transport.fetchLiveProduct).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.candidate?.product.version).toBe(2);
    expect(result.current.availability.unavailable).toBe(false);
  });
});

