import { getSupabaseClient } from "@/lib/supabase";
import {
  fetchSupabaseEventByBumelerzeId,
  normalizeSupabaseEventRow,
  type EventsWithSourcesRow,
  type PrimarySourceRow,
} from "../supabase-event";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
  getSupabaseClient: jest.fn(),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

function makeRow(overrides: Partial<EventsWithSourcesRow> = {}): EventsWithSourcesRow {
  return {
    event_id: "event-uuid-1",
    bumelerze_id: "bml20230002",
    origin_time: "2023-02-06T10:24:48.000Z",
    lat: 38.0106,
    lon: 37.1962,
    depth_km: 10,
    magnitude: 7.5,
    mag_type: "mww",
    place: "Elbistan, Kahramanmaraş, Türkiye",
    updated_at: "2023-02-07T00:00:00.000Z",
    ...overrides,
  };
}

const PRIMARY_SOURCE: PrimarySourceRow = {
  provider: "usgs",
  provider_event_id: "us6000jlqa",
  fetched_at: "2023-02-06T10:30:00.000Z",
};

describe("normalizeSupabaseEventRow", () => {
  it("populates bumelerzeId directly from the row — never null when the row has one", () => {
    const event = normalizeSupabaseEventRow(makeRow(), PRIMARY_SOURCE);

    expect(event.bumelerzeId).toBe("bml20230002");
    expect(event.id).toBe("us6000jlqa");
    expect(event.provenance).toEqual({
      provider: "usgs",
      providerId: "us6000jlqa",
      fetchedAt: expect.any(Number),
      providerUpdatedAt: Date.parse("2023-02-07T00:00:00.000Z"),
    });
    expect(event.magnitude).toEqual({ value: 7.5, type: "mww" });
    expect(event.placeName).toBe("Elbistan, Kahramanmaraş, Türkiye");
    // Elbistan's own lon (37.1962) falls outside REGION_BBOX (minLon 41.0,
    // config.ts) — same bbox rule every normalizer applies identically, not
    // a special case for a Supabase-sourced row.
    expect(event.isRegional).toBe(false);
  });

  it("degrades to a usable Event, with the row's own uuid as a last-resort id, when there is no readable primary source", () => {
    const event = normalizeSupabaseEventRow(makeRow(), null);

    expect(event.bumelerzeId).toBe("bml20230002");
    expect(event.id).toBe("event-uuid-1");
    expect(event.provenance.provider).toBe("usgs");
    expect(event.provenance.providerId).toBe("event-uuid-1");
  });

  it("narrows an exotic source provider tag to the app's own EventProvider union, without losing the raw place text used for citation", () => {
    const event = normalizeSupabaseEventRow(makeRow(), {
      provider: "iscgem",
      provider_event_id: "iscgem899464",
      fetched_at: "1944-07-17T10:00:00.000Z",
    });

    // Structural field narrows (TagRow/dedup-key safety) — but the raw
    // provider id and the row's own place text are preserved verbatim.
    expect(event.provenance.provider).toBe("usgs");
    expect(event.provenance.providerId).toBe("iscgem899464");
    expect(event.placeName).toBe(makeRow().place);
  });

  it("passes bumelerze_id through as null when the row genuinely has none yet", () => {
    const event = normalizeSupabaseEventRow(
      makeRow({ bumelerze_id: null }),
      PRIMARY_SOURCE,
    );
    expect(event.bumelerzeId).toBeNull();
  });
});

describe("fetchSupabaseEventByBumelerzeId", () => {
  beforeEach(() => {
    mockedGetSupabaseClient.mockReset();
  });

  it("returns null without querying when Supabase isn't configured", async () => {
    mockedGetSupabaseClient.mockReturnValue(null);

    const result = await fetchSupabaseEventByBumelerzeId("bml20230002");

    expect(result).toBeNull();
  });

  it("resolves a known bml id to a fully-normalized Event via the two-step read", async () => {
    const row = makeRow();
    const from = jest.fn((table: string) => {
      if (table === "events_with_sources") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn((_col: string, bumelerzeId: string) => ({
              maybeSingle: jest.fn(async () => ({
                data: bumelerzeId === row.bumelerze_id ? row : null,
                error: null as { message: string } | null,
              })),
            })),
          })),
        };
      }
      if (table === "event_source_records") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn((_col: string, eventId: string) => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(async () => ({
                    data: eventId === row.event_id ? PRIMARY_SOURCE : null,
                    error: null as { message: string } | null,
                  })),
                })),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    mockedGetSupabaseClient.mockReturnValue({ from } as never);

    const result = await fetchSupabaseEventByBumelerzeId("bml20230002");

    expect(result).not.toBeNull();
    expect(result?.bumelerzeId).toBe("bml20230002");
    expect(result?.id).toBe("us6000jlqa");
  });

  it("returns null (fails soft) when no event carries that bml id", async () => {
    const from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: null, error: null })),
        })),
      })),
    }));
    mockedGetSupabaseClient.mockReturnValue({ from } as never);

    const result = await fetchSupabaseEventByBumelerzeId("bml19000099");

    expect(result).toBeNull();
  });
});
