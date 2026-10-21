/**
 * The event's registry id is READ first (a GET on `event_source_records`,
 * public read since migration 0023) and registered through the POST
 * `upsert_event_from_client` only when the registry does not know the event
 * yet. Read-only review builds (`EXPO_PUBLIC_REVIEW_READONLY=1`) refuse
 * every POST, so the POST-only lookup failed there for every event: no live
 * SHAKEmap, no felt map, no Event hub pill (2026-10-22).
 *
 * Drives a REAL supabase-js client, so the methods, paths and filters
 * checked are the ones supabase-js actually sends; the "network" is a jest
 * mock behind the app's own read-only wrapper (as `review-readonly.test.ts`
 * does). No real network anywhere.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Event } from "@/features/events";
import { createReviewReadonlyFetch } from "@/lib/review-readonly";
import { getSupabaseClient } from "@/lib/supabase";

import { lookUpEventUuidForEvent } from "../live-transport";

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

// Mutate the flag on the SAME `process.env` object (never replace it).
const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_REVIEW_READONLY;
const SUPABASE_URL = "https://example.supabase.co";
const REGISTRY_ID = "44444444-4444-4444-8444-444444444444";

type Network = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The server as the network sees it: the registry table answers `rows`,
 * the registration RPC answers `rpcId`. */
function network(rows: unknown[], rpcId: string | null = REGISTRY_ID): Network {
  return jest.fn<Promise<Response>, Parameters<typeof fetch>>(async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/event_source_records")) {
      return json(rows);
    }
    if (url.includes("/rest/v1/rpc/upsert_event_from_client")) {
      return json(rpcId);
    }
    return json({ message: `unexpected ${url}` }, 404);
  });
}

/** The client `getSupabaseClient` builds: the plain fetch, or the
 * read-only wrapper in a review build. */
function useClient(base: Network, readOnly: boolean): void {
  if (readOnly) {
    process.env.EXPO_PUBLIC_REVIEW_READONLY = "1";
  } else {
    delete process.env.EXPO_PUBLIC_REVIEW_READONLY;
  }
  const client: SupabaseClient = createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: readOnly
        ? createReviewReadonlyFetch(base)
        : (input, init) => base(input, init),
    },
  });
  mockedGetSupabaseClient.mockReturnValue(client);
}

/** Each test uses its own event: found ids are remembered for the session. */
function quake(providerId: string): Event {
  return {
    id: providerId,
    bumelerzeId: null,
    originTime: Date.UTC(2026, 9, 20, 8, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.4, type: "mb" },
    placeName: "Sulaymaniyah, Iraq",
    provenance: {
      provider: "usgs",
      providerId,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "",
  };
}

function methods(base: Network): string[] {
  return base.mock.calls.map(([, init]) => (init?.method ?? "GET").toUpperCase());
}

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.EXPO_PUBLIC_REVIEW_READONLY;
  } else {
    process.env.EXPO_PUBLIC_REVIEW_READONLY = ORIGINAL_FLAG;
  }
});

describe("lookUpEventUuidForEvent reads the registry first", () => {
  it("finds a known event with one GET, by provider and provider event id, and writes nothing", async () => {
    const base = network([{ event_id: REGISTRY_ID }]);
    useClient(base, false);

    await expect(lookUpEventUuidForEvent(quake("us_known_read"))).resolves.toBe(
      REGISTRY_ID,
    );

    expect(methods(base)).toEqual(["GET"]);
    const url = new URL(String(base.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/rest/v1/event_source_records");
    expect(url.searchParams.get("select")).toBe("event_id");
    expect(url.searchParams.get("provider")).toBe("eq.usgs");
    expect(url.searchParams.get("provider_event_id")).toBe("eq.us_known_read");
  });

  it("registers the event through the RPC only when the registry does not know it", async () => {
    const base = network([], REGISTRY_ID);
    useClient(base, false);

    await expect(lookUpEventUuidForEvent(quake("us_new_event"))).resolves.toBe(
      REGISTRY_ID,
    );

    expect(methods(base)).toEqual(["GET", "POST"]);
    expect(String(base.mock.calls[1]?.[0])).toContain(
      "/rest/v1/rpc/upsert_event_from_client",
    );
  });

  it("remembers a found id for the session", async () => {
    const base = network([{ event_id: REGISTRY_ID }]);
    useClient(base, false);
    const event = quake("us_read_once");

    await lookUpEventUuidForEvent(event);
    await lookUpEventUuidForEvent(event);

    expect(base).toHaveBeenCalledTimes(1);
  });

  it("throws when the read cannot reach the registry, and never answers 'no id'", async () => {
    const base = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => {
      throw new TypeError("Network request failed");
    });
    useClient(base, false);

    await expect(lookUpEventUuidForEvent(quake("us_read_offline"))).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/network request failed/i),
      }),
    );
    expect(methods(base)).toEqual(["GET"]);
  });

  // supabase-js retries a failed read three times (1, 2 and 4 s); the
  // lookup fails at once like the POST did, and the queries retry it once.
  it("fails at once on a dropped connection, without supabase-js's own retries", async () => {
    const base = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => {
      throw new TypeError("Network request failed");
    });
    useClient(base, false);
    const started = Date.now();

    await expect(
      lookUpEventUuidForEvent(quake("us_read_no_retries")),
    ).rejects.toBeTruthy();

    expect(base).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("throws when the registry answers the read with an error", async () => {
    const base = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () =>
      json({ message: "upstream timeout", code: "57014" }, 500),
    );
    useClient(base, false);

    await expect(lookUpEventUuidForEvent(quake("us_read_500"))).rejects.toEqual(
      expect.objectContaining({ message: "upstream timeout" }),
    );
    expect(methods(base)).toEqual(["GET"]);
  });
});

describe("lookUpEventUuidForEvent in a read-only review build", () => {
  // The bug: the lookup was a POST, which these builds refuse as if
  // offline, so it failed for every event.
  it("finds a known event's id", async () => {
    const base = network([{ event_id: REGISTRY_ID }]);
    useClient(base, true);

    await expect(lookUpEventUuidForEvent(quake("us_readonly_known"))).resolves.toBe(
      REGISTRY_ID,
    );
    expect(methods(base)).toEqual(["GET"]);
  });

  it("answers 'no id' for an event the registry does not know, without trying the POST", async () => {
    const base = network([]);
    useClient(base, true);

    await expect(
      lookUpEventUuidForEvent(quake("us_readonly_unknown")),
    ).resolves.toBeNull();
    expect(methods(base)).toEqual(["GET"]);
  });

  it("still throws when the read fails", async () => {
    const base = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => {
      throw new TypeError("Network request failed");
    });
    useClient(base, true);

    await expect(lookUpEventUuidForEvent(quake("us_readonly_offline"))).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/network request failed/i),
      }),
    );
  });
});
