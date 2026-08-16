import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { useFeltMap } from "../queries";
import type { FeltMapTransport } from "../transport";
import type { FeltCellRow } from "../types";

/**
 * Deliberately delete/set individual keys rather than reassigning
 * `process.env` wholesale (`process.env = {...}`) — under this repo's
 * jest-expo + `@tanstack/react-query` combination, replacing the whole
 * `process.env` object (even with equivalent contents) somehow starves
 * `notifyManager`'s scheduled re-render from ever reaching this hook,
 * leaving `useFeltMap` stuck reporting its pre-fetch "hidden" state forever
 * — `waitFor` times out even though the fixture transport's promise
 * resolves immediately (confirmed via a standalone repro outside this
 * file). Per-key delete/set (this function, used in both `beforeEach` and
 * inside individual tests) does not trigger it.
 */
function setSupabaseConfigured(configured: boolean): void {
  if (configured) {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key-value";
  } else {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  }
}

function row(overrides: Partial<FeltCellRow> = {}): FeltCellRow {
  return {
    event_id: "us2000bmcg",
    geohash: "tn263",
    precision: 5,
    n_reports: 12,
    n_tier2: 4,
    cdi: 4.5,
    version: 1,
    computed_at: "2026-08-14T02:00:00.000Z",
    ...overrides,
  };
}

function fixtureTransport(rows: FeltCellRow[]): FeltMapTransport {
  return { fetchFeltCells: jest.fn(async () => rows) };
}

function throwingTransport(error: unknown): FeltMapTransport {
  return {
    fetchFeltCells: jest.fn(async () => {
      throw error;
    }),
  };
}

async function renderFeltMap(eventId: string, transport: FeltMapTransport) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useFeltMap(eventId, transport), { wrapper });
}

describe("useFeltMap", () => {
  beforeEach(async () => {
    setSupabaseConfigured(false);
    await AsyncStorage.clear();
  });

  afterEach(() => {
    setSupabaseConfigured(false);
  });

  it("resolves to hidden and never calls the transport when Supabase is unconfigured", async () => {
    setSupabaseConfigured(false);
    const transport = fixtureTransport([row()]);

    const { result } = await renderFeltMap("us2000bmcg", transport);

    await waitFor(() => expect(result.current.status).toBe("hidden"));
    expect(result.current.cells).toEqual([]);
    expect(transport.fetchFeltCells).not.toHaveBeenCalled();
  });

  it("resolves to ready with the transport's cells once configured", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport([
      row({ geohash: "tn263", n_reports: 12 }),
      row({ geohash: "tn264", n_reports: 8 }),
    ]);

    const { result } = await renderFeltMap("us2000bmcg", transport);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.cells).toHaveLength(2);
    expect(result.current.totalReports).toBe(20);
    expect(transport.fetchFeltCells).toHaveBeenCalledWith("us2000bmcg");
  });

  it("resolves to hidden (not an error) when configured but the cell list comes back empty", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport([]);

    const { result } = await renderFeltMap("us2000bmcg", transport);

    await waitFor(() => expect(result.current.status).toBe("hidden"));
    expect(result.current.cells).toEqual([]);
  });

  it("resolves to hidden when every returned cell is superseded by a finer precision (net-empty after selection)", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport([
      row({ geohash: "tn263", precision: 5 }),
      row({ geohash: "tn263c", precision: 6 }),
    ]);

    const { result } = await renderFeltMap("us2000bmcg", transport);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.cells.map((c) => c.geohash)).toEqual(["tn263c"]);
  });

  it("resolves to offline when configured but the transport throws", async () => {
    setSupabaseConfigured(true);
    const transport = throwingTransport(new Error("network down"));

    const { result } = await renderFeltMap("us2000bmcg", transport);

    await waitFor(() => expect(result.current.status).toBe("offline"));
    expect(result.current.cells).toEqual([]);
  });

  it("never fires the transport for an empty event id", async () => {
    setSupabaseConfigured(true);
    const transport = fixtureTransport([row()]);

    await renderFeltMap("", transport);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.fetchFeltCells).not.toHaveBeenCalled();
  });
});
