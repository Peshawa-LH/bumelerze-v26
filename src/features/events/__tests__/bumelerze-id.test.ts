import { getSupabaseClient } from "@/lib/supabase";
import { isBumelerzeId, resolveBumelerzeId } from "../bumelerze-id";
import type { Event } from "../types";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
  getSupabaseClient: jest.fn(),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
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
    placeName: "32 km SE of Halabja, Iraq",
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
  provider: string;
  provider_event_id: string;
  event_id: string;
}
interface EventFixtureRow {
  event_id: string;
  bumelerze_id: string | null;
}

/**
 * Hand-rolled fake matching `resolveBumelerzeId`'s exact two-step call
 * shape (`event_source_records` by (provider, provider_event_id), then
 * `events` by `event_id`) — same "prove correctness against real filtering
 * behaviour, not mock-call assertions" approach
 * `source-corroboration.test.tsx`'s own `buildFakeSupabaseClient` uses for
 * the identical join.
 */
function buildFakeSupabaseClient(fixture: {
  sourceRecords: SourceRecordFixtureRow[];
  events: EventFixtureRow[];
}) {
  const from = jest.fn((table: string) => {
    if (table === "event_source_records") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn((_col1: string, provider: string) => ({
            eq: jest.fn((_col2: string, providerEventId: string) => ({
              maybeSingle: jest.fn(async () => ({
                data:
                  fixture.sourceRecords.find(
                    (row) =>
                      row.provider === provider &&
                      row.provider_event_id === providerEventId,
                  ) ?? null,
                error: null as { message: string } | null,
              })),
            })),
          })),
        })),
      };
    }
    if (table === "events") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn((_col: string, eventId: string) => ({
            maybeSingle: jest.fn(async () => ({
              data: fixture.events.find((row) => row.event_id === eventId) ?? null,
              error: null as { message: string } | null,
            })),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from };
}

describe("isBumelerzeId", () => {
  it("recognizes every canonical bml id shape", () => {
    expect(isBumelerzeId("bml20230002")).toBe(true);
    expect(isBumelerzeId("bml19440001")).toBe(true);
    // Grown past `zzzz` (base-36 counter > 4 chars) — still valid.
    expect(isBumelerzeId("bml202610000")).toBe(true);
  });

  it("rejects provider ids and other non-bml strings", () => {
    expect(isBumelerzeId("us6000jlqa")).toBe(false);
    expect(isBumelerzeId("iscgem899464")).toBe(false);
    expect(isBumelerzeId("gfz2026oyxe")).toBe(false);
    expect(isBumelerzeId("20230206_0000008")).toBe(false);
    expect(isBumelerzeId("")).toBe(false);
    // Too short a suffix / missing the 4-digit year are not canonical.
    expect(isBumelerzeId("bml2023")).toBe(false);
    expect(isBumelerzeId("bml202")).toBe(false);
  });
});

describe("resolveBumelerzeId", () => {
  beforeEach(() => {
    mockedGetSupabaseClient.mockReset();
  });

  it("returns null without querying when Supabase isn't configured", async () => {
    mockedGetSupabaseClient.mockReturnValue(null);

    const result = await resolveBumelerzeId(makeEvent());

    expect(result).toBeNull();
  });

  it("resolves a known (provider, providerId) pair to its bml id via the two-step join", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        { provider: "usgs", provider_event_id: "us7000abcd", event_id: "event-uuid-1" },
      ],
      events: [{ event_id: "event-uuid-1", bumelerze_id: "bml20230002" }],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const result = await resolveBumelerzeId(makeEvent());

    expect(result).toBe("bml20230002");
  });

  it("returns null (fails soft) when the event isn't registered in event_source_records yet", async () => {
    const fake = buildFakeSupabaseClient({ sourceRecords: [], events: [] });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    // A fresh providerId per test — `resolveBumelerzeId` caches by
    // (provider, providerId) at MODULE scope for the whole test file (this
    // module's own doc comment/session-lifetime contract), so reusing
    // `makeEvent()`'s default id across tests would read a previous test's
    // cached answer instead of exercising this fixture.
    const event = makeEvent({
      provenance: {
        provider: "usgs",
        providerId: "us-unregistered-test",
        fetchedAt: Date.now(),
        providerUpdatedAt: Date.now(),
      },
    });

    const result = await resolveBumelerzeId(event);

    expect(result).toBeNull();
  });

  it("returns null (fails soft) when the registered event has no bml id yet", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        {
          provider: "usgs",
          provider_event_id: "us-no-bml-yet",
          event_id: "event-uuid-1",
        },
      ],
      events: [{ event_id: "event-uuid-1", bumelerze_id: null }],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);

    const event = makeEvent({
      provenance: {
        provider: "usgs",
        providerId: "us-no-bml-yet",
        fetchedAt: Date.now(),
        providerUpdatedAt: Date.now(),
      },
    });

    const result = await resolveBumelerzeId(event);

    expect(result).toBeNull();
  });

  it("caches a resolved id for the session — a second call for the same event does not re-query", async () => {
    const fake = buildFakeSupabaseClient({
      sourceRecords: [
        {
          provider: "usgs",
          provider_event_id: "us-cache-test",
          event_id: "event-uuid-2",
        },
      ],
      events: [{ event_id: "event-uuid-2", bumelerze_id: "bml20260099" }],
    });
    mockedGetSupabaseClient.mockReturnValue(fake as never);
    const event = makeEvent({
      provenance: {
        provider: "usgs",
        providerId: "us-cache-test",
        fetchedAt: Date.now(),
        providerUpdatedAt: Date.now(),
      },
    });

    const first = await resolveBumelerzeId(event);
    const fromCallsAfterFirst = fake.from.mock.calls.length;
    const second = await resolveBumelerzeId(event);

    expect(first).toBe("bml20260099");
    expect(second).toBe("bml20260099");
    expect(fake.from.mock.calls.length).toBe(fromCallsAfterFirst);
  });
});
