import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import {
  SupabaseSourceCorroborationTransport,
  useEventSourceAgencies,
  type SourceCorroboration,
  type SourceCorroborationByEventId,
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
    bumelerzeId: null,
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
  /** Internal event ids that have at least one published product. Omitted
   * means none, which is the pre-existing fixtures' expectation. */
  shakemapProducts?: string[];
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

  const shakemapProductsIn = jest.fn(async (_col: string, ids: readonly string[]) => ({
    data: (fixture.shakemapProducts ?? [])
      .filter((eventId) => ids.includes(eventId))
      .map((eventId) => ({ event_id: eventId })),
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
    if (table === "shakemap_products") {
      return {
        select: jest.fn(() => ({
          in: shakemapProductsIn,
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, eventSourceRecordsIn, eventsWithSourcesIn, shakemapProductsIn };
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

    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns an empty map without querying for an empty event list", async () => {
    const fake = buildFakeSupabaseClient({ sourceRecords: [], eventsWithSources: [] });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([]);

    expect(Object.keys(result)).toHaveLength(0);
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

    expect(result["us7000abcd"]).toEqual<SourceCorroboration>({
      agencies: ["NEIC"],
      hasShakemap: false,
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

    expect(result["gfz2024abcd"]).toEqual<SourceCorroboration>({
      agencies: ["GEOFON"],
      hasShakemap: false,
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
    expect(result["us7000abcd"]).toEqual<SourceCorroboration>({
      agencies: ["NEIC", "AFAD", "ISN"],
      hasShakemap: false,
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
    expect(result["us1"]).toEqual({ agencies: ["NEIC"], hasShakemap: false });
    expect(result["us2"]).toEqual({ agencies: ["NEIC"], hasShakemap: false });
    expect(result["em1"]).toEqual({ agencies: ["AFAD"], hasShakemap: false });
  });

  it("marks an event whose shaking map Bumelerze has published", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "usgs", provider_event_id: "us7000abcd" },
      ],
      eventsWithSources: [
        { event_id: "internal-1", sources: [{ provider: "usgs", authorAgency: "NEIC" }] },
      ],
      shakemapProducts: ["internal-1"],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result["us7000abcd"]).toEqual<SourceCorroboration>({
      agencies: ["NEIC"],
      hasShakemap: true,
    });
    // Read-only, and batched with the other two steps rather than one
    // request per card: a list must never go through the per-event live
    // path, which resolves via `upsert_event_from_client` and CREATES a row.
    expect(fake.shakemapProductsIn).toHaveBeenCalledTimes(1);
  });

  it("marks an event that has a map but no corroboration row", async () => {
    // Keying the result off corroboration alone would drop the tag for
    // exactly the events the registry knows least about.
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "usgs", provider_event_id: "us7000abcd" },
      ],
      eventsWithSources: [],
      shakemapProducts: ["internal-1"],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result["us7000abcd"]).toEqual<SourceCorroboration>({
      agencies: [],
      hasShakemap: true,
    });
  });

  it("leaves hasShakemap false for an event with no published products", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { event_id: "internal-1", provider: "usgs", provider_event_id: "us7000abcd" },
      ],
      eventsWithSources: [
        { event_id: "internal-1", sources: [{ provider: "usgs", authorAgency: "NEIC" }] },
      ],
      shakemapProducts: ["internal-other"],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result["us7000abcd"]?.hasShakemap).toBe(false);
  });

  it("leaves an event out of the result map when it isn't in the registry yet", async () => {
    const fake = buildFakeSupabaseClient({ sourceRecords: [], eventsWithSources: [] });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await SupabaseSourceCorroborationTransport.fetchCorroboration([
      makeEvent(),
    ]);

    expect(result["us7000abcd"]).toBeUndefined();
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
  byEventId: SourceCorroborationByEventId,
): SourceCorroborationTransport {
  return { fetchCorroboration: jest.fn(async () => byEventId) };
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
    const transport = fixtureTransport({});

    const { result } = await renderSourceAgencies([makeEvent()], transport);

    expect(result.current.size).toBe(0);
    expect(transport.fetchCorroboration).not.toHaveBeenCalled();
  });

  it("never calls the transport for an empty event list", async () => {
    const transport = fixtureTransport({});

    const { result } = await renderSourceAgencies([], transport);

    expect(result.current.size).toBe(0);
    expect(transport.fetchCorroboration).not.toHaveBeenCalled();
  });

  it("resolves the transport's map once configured with events", async () => {
    const event = makeEvent();
    const transport = fixtureTransport({
      [event.id]: { agencies: ["NEIC", "AFAD"], hasShakemap: false },
    });

    const { result } = await renderSourceAgencies([event], transport);

    await waitFor(() => {
      expect(result.current.get(event.id)).toEqual({ agencies: ["NEIC", "AFAD"], hasShakemap: false });
    });
  });
});
