import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import type { Event } from "@/features/events";
import { useLiveShakeMap } from "../live-queries";
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
});
