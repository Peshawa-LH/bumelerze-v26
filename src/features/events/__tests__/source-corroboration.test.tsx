import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import {
  SupabaseSourceCorroborationTransport,
  useEventSourceAgencies,
  type SourceCorroboration,
  type SourceCorroborationTransport,
} from "../source-corroboration";
import type { Event } from "../types";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
  getSupabaseClient: jest.fn(),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;
const mockedIsSupabaseConfigured = isSupabaseConfigured as jest.MockedFunction<
  typeof isSupabaseConfigured
>;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    originTime: Date.now(),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

interface SourceRecordFixtureRow {
  event_id: string;
  provider: string;
  provider_event_id: string;
}

interface EventsWithSourcesFixtureRow {
  event_id: string;
  sources: { provider: string; authorAgency: string | null }[];
}

/**
 * A tiny in-memory fake standing in for the two PostgREST surfaces this
 * transport reads — mirrors `shakemap/__tests__/
 * event-detail-live-shakemap.integration.test.tsx`'s `buildFakeSupabaseClient`
 * approach (a hand-rolled chain matching the exact shape the real code
 * calls) rather than asserting on `jest.fn` call chains directly, since this
 * transport's two-step, per-provider-chunked query shape is easier to prove
 * correct against actual filtering behaviour than against mock plumbing.
 */
function buildFakeSupabaseClient(fixture: {
  sourceRecords: SourceRecordFixtureRow[];
  eventsWithSources: EventsWithSourcesFixtureRow[];
}) {
  const eventSourceRecordsIn = jest.fn(
    async (_col: string, ids: readonly string[], provider: string) => ({
      data: fixture.sourceRecords.filter(
        (row) => row.provider === provider && ids.includes(row.provider_event_id),
      ),
      error: null as { message: string } | null,
    }),
  );
  const eventsWithSourcesIn = jest.fn(async (_col: string, ids: readonly string[]) => ({
    data: fixture.eventsWithSources.filter((row) => ids.includes(row.event_id)),
    error: null as { message: string } | null,
  }));

  const from = jest.fn((table: string) => {
    if (table === "event_source_records") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn((_col: string, provider: string) => ({
            in: jest.fn((col2: string, ids: readonly string[]) =>
              eventSourceRecordsIn(col2, ids, provider),
            ),
          })),
        })),
      };
    }
    if (table === "events_with_sources") {
      return {
        select: jest.fn(() => ({
          in: eventsWithSourcesIn,
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, eventSourceRecordsIn, eventsWithSourcesIn };
}

describe("SupabaseSourceCorroborationTransport.fetchCorroboration", () => {
  beforeEach(() => {
    mockedGetSupabaseClient.mockReset();
  });

  it("returns an empty map without querying when unconfigured (defensive-only branch)", async () => {
    mockedGetSupabaseClient.mockReturnValue(null);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result.size).toBe(0);
  });

  it("returns an empty map without querying for an empty event list", async () => {
    const fake = buildFakeSupabaseClient({ sourceRecords: [], eventsWithSources: [] });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([]);

    expect(result.size).toBe(0);
    expect(fake.eventSourceRecordsIn).not.toHaveBeenCalled();
  });

  it("resolves one event, one corroborating agency, via the (provider, provider_event_id) join key", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "usgs", provider_event_id: "us7000abcd" },
      ],
      eventsWithSources: [
        {
          event_id: "internal-1",
          sources: [{ provider: "usgs", authorAgency: "NEIC" }],
        },
      ],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result.get("us7000abcd")).toEqual<SourceCorroboration>({
      agencies: ["NEIC"],
    });
  });

  it("falls back to the upper-cased provider tag when a source record has no named author agency", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "geofon", provider_event_id: "gfz2024abcd" },
      ],
      eventsWithSources: [
        {
          event_id: "internal-1",
          sources: [{ provider: "geofon", authorAgency: null }],
        },
      ],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent({
        id: "gfz2024abcd",
        provenance: {
          provider: "geofon",
          providerId: "gfz2024abcd",
          fetchedAt: Date.now(),
          providerUpdatedAt: Date.now(),
        },
      }),
    ]);

    expect(result.get("gfz2024abcd")).toEqual<SourceCorroboration>({
      agencies: ["GEOFON"],
    });
  });

  it("dedupes repeated agencies across source records, preserving first-seen order", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "usgs", provider_event_id: "us7000abcd" },
      ],
      eventsWithSources: [
        {
          event_id: "internal-1",
          sources: [
            { provider: "usgs", authorAgency: "NEIC" },
            { provider: "emsc", authorAgency: "AFAD" },
            { provider: "isc", authorAgency: "AFAD" },
            { provider: "isc", authorAgency: "ISN" },
          ],
        },
      ],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    // Three DISTINCT agencies (NEIC, AFAD, ISN) — the repeated AFAD sighting
    // (relayed via EMSC, then again via the ISC bulletin) is ONE agency
    // agreeing, not two (source-and-ingestion-plan.md §6.2 / this module's
    // own doc comment).
    expect(result.get("us7000abcd")).toEqual<SourceCorroboration>({
      agencies: ["NEIC", "AFAD", "ISN"],
    });
  });

  it("groups events by provider into one batched request per provider, not one per card", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "usgs", provider_event_id: "us1" },
        { event_id: "internal-2", provider: "usgs", provider_event_id: "us2" },
        { event_id: "internal-3", provider: "emsc", provider_event_id: "em1" },
      ],
      eventsWithSources: [
        { event_id: "internal-1", sources: [{ provider: "usgs", authorAgency: "NEIC" }] },
        { event_id: "internal-2", sources: [{ provider: "usgs", authorAgency: "NEIC" }] },
        { event_id: "internal-3", sources: [{ provider: "emsc", authorAgency: "AFAD" }] },
      ],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const events = [
      makeEvent({
        id: "us1",
        provenance: {
          provider: "usgs",
          providerId: "us1",
          fetchedAt: Date.now(),
          providerUpdatedAt: Date.now(),
        },
      }),
      makeEvent({
        id: "us2",
        provenance: {
          provider: "usgs",
          providerId: "us2",
          fetchedAt: Date.now(),
          providerUpdatedAt: Date.now(),
        },
      }),
      makeEvent({
        id: "em1",
        provenance: {
          provider: "emsc",
          providerId: "em1",
          fetchedAt: Date.now(),
          providerUpdatedAt: Date.now(),
        },
      }),
    ];

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration(events);

    // Two providers present -> exactly two `event_source_records` requests
    // (one per provider group), never three (one per card).
    expect(fake.eventSourceRecordsIn).toHaveBeenCalledTimes(2);
    expect(result.get("us1")).toEqual({ agencies: ["NEIC"] });
    expect(result.get("us2")).toEqual({ agencies: ["NEIC"] });
    expect(result.get("em1")).toEqual({ agencies: ["AFAD"] });
  });

  it("leaves an event out of the result map when it isn't in the registry yet", async () => {
    const fake = buildFakeSupabaseClient({ sourceRecords: [], eventsWithSources: [] });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result.has("us7000abcd")).toBe(false);
  });

  it("throws (no silent catch) when the event_source_records lookup errors", async () => {
    const client = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            in: jest.fn(async () => ({
              data: null,
              error: { message: "connection refused" },
            })),
          })),
        })),
      })),
    };
    mockedGetSupabaseClient.mockReturnValue(client as never);

    await expect(
      SupabaseSourceCorroborationTransport.fetchCorroboration([makeEvent()]),
    ).rejects.toEqual(expect.objectContaining({ message: "connection refused" }));
  });
});

// ---------------------------------------------------------------------------
// useEventSourceAgencies — same "unconfigured -> never calls the transport"
// contract as usePossibleEvents/useFeltMap.
// ---------------------------------------------------------------------------
function fixtureTransport(
  map: Map<string, SourceCorroboration>,
): SourceCorroborationTransport {
  return { fetchCorroboration: jest.fn(async () => map) };
}

async function renderSourceAgencies(
  events: Event[],
  transport: SourceCorroborationTransport,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useEventSourceAgencies(events, transport), { wrapper });
}

describe("useEventSourceAgencies", () => {
  beforeEach(() => {
    mockedIsSupabaseConfigured.mockReturnValue(true);
  });

  it("never calls the transport when Supabase is unconfigured", async () => {
    mockedIsSupabaseConfigured.mockReturnValue(false);
    const transport = fixtureTransport(new Map());

    const { result } = await renderSourceAgencies([makeEvent()], transport);

    expect(result.current.size).toBe(0);
    expect(transport.fetchCorroboration).not.toHaveBeenCalled();
  });

  it("never calls the transport for an empty event list", async () => {
    const transport = fixtureTransport(new Map());

    const { result } = await renderSourceAgencies([], transport);

    expect(result.current.size).toBe(0);
    expect(transport.fetchCorroboration).not.toHaveBeenCalled();
  });

  it("resolves the transport's map once configured with events", async () => {
    const event = makeEvent();
    const transport = fixtureTransport(
      new Map([[event.id, { agencies: ["NEIC", "AFAD"] }]]),
    );

    const { result } = await renderSourceAgencies([event], transport);

    await waitFor(() => {
      expect(result.current.get(event.id)).toEqual({ agencies: ["NEIC", "AFAD"] });
    });
  });
});
