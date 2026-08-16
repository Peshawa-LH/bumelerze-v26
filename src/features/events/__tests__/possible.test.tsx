import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { getSupabaseClient } from "@/lib/supabase";
import {
  parsePossibleEventRows,
  POSSIBLE_EVENT_ROW_COLUMNS,
  SupabasePossibleEventsTransport,
  usePossibleEvents,
  type PossibleEvent,
  type PossibleEventsTransport,
} from "../possible";

// ---------------------------------------------------------------------------
// zod contract: parsePossibleEventRows
// ---------------------------------------------------------------------------
describe("parsePossibleEventRows", () => {
  function validRow(overrides: Record<string, unknown> = {}) {
    return {
      event_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
      origin_time: "2026-08-16T10:00:00.000Z",
      lat: 35.56,
      lon: 45.43,
      created_at: "2026-08-16T10:02:00.000Z",
      ...overrides,
    };
  }

  it("maps valid rows to the PossibleEvent domain shape", () => {
    const { events, skippedCount } = parsePossibleEventRows([validRow()]);

    expect(skippedCount).toBe(0);
    expect(events).toEqual<PossibleEvent[]>([
      {
        id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        originTime: Date.parse("2026-08-16T10:00:00.000Z"),
        lat: 35.56,
        lon: 45.43,
        createdAt: Date.parse("2026-08-16T10:02:00.000Z"),
      },
    ]);
  });

  it("tolerantly drops malformed rows and counts them, without failing the whole parse", () => {
    const { events, skippedCount } = parsePossibleEventRows([
      validRow(),
      { not: "a valid row" },
      validRow({ lat: 999 }), // out of range
    ]);

    expect(events).toHaveLength(1);
    expect(skippedCount).toBe(2);
  });

  it("returns empty for a non-array response", () => {
    expect(parsePossibleEventRows(null)).toEqual({ events: [], skippedCount: 0 });
    expect(parsePossibleEventRows(undefined)).toEqual({ events: [], skippedCount: 0 });
    expect(parsePossibleEventRows({ not: "an array" })).toEqual({
      events: [],
      skippedCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// SupabasePossibleEventsTransport — no real network call anywhere in this
// block (same discipline as feltmap/__tests__/transport.test.ts).
// ---------------------------------------------------------------------------
const mockOrder = jest.fn();
const mockGte = jest.fn(() => ({ order: mockOrder }));
const mockEq = jest.fn(() => ({ gte: mockGte }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(() => ({ from: mockFrom })),
  isSupabaseConfigured: jest.fn(() => true),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

describe("SupabasePossibleEventsTransport.fetchPossibleEvents", () => {
  function validRow(overrides: Record<string, unknown> = {}) {
    return {
      event_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
      origin_time: "2026-08-16T10:00:00.000Z",
      lat: 35.56,
      lon: 45.43,
      created_at: "2026-08-16T10:02:00.000Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockEq.mockClear();
    mockGte.mockClear();
    mockOrder.mockReset();
    mockedGetSupabaseClient.mockReturnValue({ from: mockFrom } as never);
  });

  it("queries events filtered to status=possible, selecting the full contract column list, newest first", async () => {
    mockOrder.mockResolvedValue({ data: [validRow()], error: null });

    const rows = await SupabasePossibleEventsTransport.fetchPossibleEvents();

    expect(mockFrom).toHaveBeenCalledWith("events");
    expect(mockSelect).toHaveBeenCalledWith(POSSIBLE_EVENT_ROW_COLUMNS.join(", "));
    expect(mockEq).toHaveBeenCalledWith("status", "possible");
    expect(mockGte).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(rows).toHaveLength(1);
  });

  it("throws (no silent catch) when PostgREST returns an error", async () => {
    mockOrder.mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "ECONNREFUSED" },
    });

    await expect(SupabasePossibleEventsTransport.fetchPossibleEvents()).rejects.toEqual(
      expect.objectContaining({ message: "connection refused" }),
    );
  });

  it("returns an empty array without querying when unconfigured (defensive-only branch)", async () => {
    mockedGetSupabaseClient.mockReturnValue(null);

    const rows = await SupabasePossibleEventsTransport.fetchPossibleEvents();

    expect(rows).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// usePossibleEvents hook gating — same "unconfigured hidden / configured
// fires the transport" contract as feltmap/__tests__/queries.test.tsx.
// ---------------------------------------------------------------------------
function fixtureTransport(events: PossibleEvent[]): PossibleEventsTransport {
  return { fetchPossibleEvents: jest.fn(async () => events) };
}

const sampleEvent: PossibleEvent = {
  id: "possible-1",
  originTime: Date.now() - 60_000,
  lat: 35.56,
  lon: 45.43,
  createdAt: Date.now() - 30_000,
};

async function renderPossibleEvents(transport: PossibleEventsTransport) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => usePossibleEvents(transport), { wrapper });
}

describe("usePossibleEvents", () => {
  it("resolves not-ready and never calls the transport when Supabase is unconfigured", async () => {
    const { isSupabaseConfigured } = jest.requireMock("@/lib/supabase") as {
      isSupabaseConfigured: jest.Mock;
    };
    isSupabaseConfigured.mockReturnValue(false);

    const transport = fixtureTransport([sampleEvent]);
    const { result } = await renderPossibleEvents(transport);

    expect(result.current.isReady).toBe(false);
    expect(result.current.events).toEqual([]);
    expect(transport.fetchPossibleEvents).not.toHaveBeenCalled();
  });

  it("resolves ready with the transport's events once configured", async () => {
    const { isSupabaseConfigured } = jest.requireMock("@/lib/supabase") as {
      isSupabaseConfigured: jest.Mock;
    };
    isSupabaseConfigured.mockReturnValue(true);

    const transport = fixtureTransport([sampleEvent]);
    const { result } = await renderPossibleEvents(transport);

    await waitFor(() => expect(result.current.isReady).toBe(true));
    await waitFor(() => expect(result.current.events).toEqual([sampleEvent]));
    expect(transport.fetchPossibleEvents).toHaveBeenCalled();
  });
});
