/**
 * `SupabaseLiveShakeMapTransport.fetchLiveProduct` — no real network call
 * anywhere in this file (same "no real network calls in tests" discipline
 * as `feltmap/__tests__/transport.test.ts`). `getSupabaseClient` is mocked
 * at the `@/lib/supabase` seam; `fetch` is mocked globally for the artifact
 * request.
 */
import { getSupabaseClient } from "@/lib/supabase";
import type { Event } from "@/features/events";
import { lookUpEventUuidForEvent, SupabaseLiveShakeMapTransport } from "../live-transport";

const mockRpc = jest.fn();
const mockEq3 = jest.fn();
const mockEq2 = jest.fn(() => ({ eq: mockEq3 }));
const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
const mockSelect = jest.fn(() => ({ eq: mockEq1 }));
// The registry read (`event_source_records` by provider + provider event
// id) the lookup makes before it ever registers the event. Answers "not
// known yet" by default, so the registration RPC answers in these tests;
// `live-transport-registry-read.test.ts` covers the read itself.
const mockRegistryRead = jest.fn();
const mockRegistryEq2 = jest.fn(() => ({
  maybeSingle: () => ({ retry: () => mockRegistryRead() }),
}));
const mockRegistryEq1 = jest.fn(() => ({ eq: mockRegistryEq2 }));
const mockFrom = jest.fn((table: string) =>
  table === "event_source_records"
    ? { select: () => ({ eq: mockRegistryEq1 }) }
    : { select: mockSelect },
);

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

const HALABJA_EVENT: Event = {
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

const INTERNAL_UUID = "11111111-1111-4111-8111-111111111111";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    storage_path: "https://example.test/events/us2000bmcg/v2/bands_mi.json",
    data_used: {
      conditioning_applied: { ems: true },
      instrument_stations_parsed: 4,
      dyfi_boxes_parsed: 0,
      engine_version: { service_version: "0.1.0" },
    },
    review_status: "automatic",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

const CONTOURS_PAYLOAD = { type: "FeatureCollection", features: [] };

describe("SupabaseLiveShakeMapTransport.fetchLiveProduct", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockEq1.mockClear();
    mockEq2.mockClear();
    mockEq3.mockReset();
    mockRegistryRead.mockReset();
    mockRegistryRead.mockResolvedValue({ data: null, error: null });
    mockedGetSupabaseClient.mockReturnValue({ rpc: mockRpc, from: mockFrom } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => CONTOURS_PAYLOAD,
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("asks for the filled band product first, and fetches that artifact", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3.mockResolvedValue({ data: [validRow()], error: null });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_event_from_client",
      expect.objectContaining({ p_provider: "usgs", p_provider_event_id: "us2000bmcg" }),
    );
    expect(mockFrom).toHaveBeenCalledWith("shakemap_products");
    expect(mockEq1).toHaveBeenCalledWith("event_id", INTERNAL_UUID);
    expect(mockEq2).toHaveBeenCalledWith("producer", "bumelerze");
    // `contour_bands` is the FILLED geometry. The app never asks for
    // `contours` (the line product) while bands exist: an open contour in
    // a line product cannot be closed correctly by a client, and filling
    // it by joining its two ends draws a chord across open space.
    expect(mockEq3).toHaveBeenCalledWith("product_type", "contour_bands");
    expect(mockEq3).not.toHaveBeenCalledWith("product_type", "contours");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/events/us2000bmcg/v2/bands_mi.json",
    );

    expect(product).not.toBeNull();
    expect(product?.version).toBe(2);
    expect(product?.reviewStatus).toBe("automatic");
    expect(product?.dataUsedSummaryKey).toBe("stationConditioned");
    expect(product?.engineVersion?.serviceVersion).toBe("0.1.0");
    expect(product?.contours).toEqual(CONTOURS_PAYLOAD);
  });

  it("falls back to the line product for a version published before bands existed", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [validRow({ storage_path: "https://example.test/events/us2000bmcg/v2/cont_mi.json" })],
        error: null,
      });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(mockEq3).toHaveBeenNthCalledWith(1, "product_type", "contour_bands");
    expect(mockEq3).toHaveBeenNthCalledWith(2, "product_type", "contours");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/events/us2000bmcg/v2/cont_mi.json",
    );
    expect(product?.contours).toEqual(CONTOURS_PAYLOAD);
  });

  it("reads a known event's uuid from the registry and never registers it", async () => {
    mockRegistryRead.mockResolvedValue({ data: { event_id: INTERNAL_UUID }, error: null });
    mockEq3.mockResolvedValue({ data: [validRow()], error: null });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct({
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_registry_read" },
    });

    expect(mockFrom).toHaveBeenCalledWith("event_source_records");
    expect(mockRegistryEq1).toHaveBeenCalledWith("provider", "usgs");
    expect(mockRegistryEq2).toHaveBeenCalledWith("provider_event_id", "us_registry_read");
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEq1).toHaveBeenCalledWith("event_id", INTERNAL_UUID);
    expect(product?.version).toBe(2);
  });

  it("throws, without registering, when the registry read fails", async () => {
    mockRegistryRead.mockResolvedValue({
      data: null,
      error: { message: "TypeError: Network request failed" },
    });

    await expect(
      SupabaseLiveShakeMapTransport.fetchLiveProduct({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_registry_read_fails" },
      }),
    ).rejects.toEqual(expect.objectContaining({ message: "TypeError: Network request failed" }));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("shakemap_products");
  });

  it("caches the resolved event uuid across repeated calls for the same event (one RPC call)", async () => {
    // Deliberately a providerId unused by any other test in this file — the
    // uuid cache is module-level state that outlives a single `it()` block
    // (no `jest.resetModules()` between tests here), so reusing another
    // test's provider id would make this assertion depend on run order.
    const event: Event = {
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_cache_test" },
    };
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3.mockResolvedValue({ data: [validRow()], error: null });

    await SupabaseLiveShakeMapTransport.fetchLiveProduct(event);
    await SupabaseLiveShakeMapTransport.fetchLiveProduct(event);

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  // A failed registry lookup is a failure, not "this event has no map":
  // answered as `null`, the query stored "no SHAKEmap" as a success, kept it
  // fresh 15 minutes and saved it for a day, hiding a map the card promised
  // (iOS simulator, 2026-10-21).
  it("throws when the registry lookup fails, so the query never records 'no map'", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "TypeError: Network request failed" },
    });

    await expect(
      SupabaseLiveShakeMapTransport.fetchLiveProduct({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_resolution_fails" },
      }),
    ).rejects.toEqual(expect.objectContaining({ message: "TypeError: Network request failed" }));
    expect(mockFrom).not.toHaveBeenCalledWith("shakemap_products");
  });

  it("throws when the registry call itself rejects (no connection)", async () => {
    mockRpc.mockRejectedValue(new TypeError("Network request failed"));

    await expect(
      SupabaseLiveShakeMapTransport.fetchLiveProduct({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_resolution_rejects" },
      }),
    ).rejects.toThrow("Network request failed");
  });

  it("returns null when the registry answers without an id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct({
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_registry_no_id" },
    });

    expect(product).toBeNull();
    expect(mockFrom).not.toHaveBeenCalledWith("shakemap_products");
  });

  // The felt map and the Event hub: answered as "no id", a failed lookup
  // was kept for good and saved on the device (2026-10-21).
  it("lookUpEventUuidForEvent throws when the registry cannot be asked", async () => {
    mockRpc.mockRejectedValue(new TypeError("Network request failed"));
    await expect(
      lookUpEventUuidForEvent({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_lookup_rejects" },
      }),
    ).rejects.toThrow("Network request failed");

    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "TypeError: Network request failed" },
    });
    await expect(
      lookUpEventUuidForEvent({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_lookup_fails" },
      }),
    ).rejects.toEqual(
      expect.objectContaining({ message: "TypeError: Network request failed" }),
    );
  });

  it("lookUpEventUuidForEvent answers the id, or null when there is none or no registry", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    await expect(
      lookUpEventUuidForEvent({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_lookup_found" },
      }),
    ).resolves.toBe(INTERNAL_UUID);

    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(
      lookUpEventUuidForEvent({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_lookup_no_id" },
      }),
    ).resolves.toBeNull();

    mockedGetSupabaseClient.mockReturnValue(null);
    await expect(
      lookUpEventUuidForEvent({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_lookup_unconfigured" },
      }),
    ).resolves.toBeNull();
  });

  it("returns null when no shakemap_products row exists yet for this event", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3.mockResolvedValue({ data: [], error: null });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct({
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_no_product_yet" },
    });

    expect(product).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws (no silent catch) when the shakemap_products query itself errors", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3.mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "ECONNREFUSED" },
    });

    await expect(
      SupabaseLiveShakeMapTransport.fetchLiveProduct({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_query_errors" },
      }),
    ).rejects.toEqual(expect.objectContaining({ message: "connection refused" }));
  });

  it("throws when the artifact fetch returns a non-2xx response (slow/unreachable artifact)", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3.mockResolvedValue({ data: [validRow()], error: null });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    await expect(
      SupabaseLiveShakeMapTransport.fetchLiveProduct({
        ...HALABJA_EVENT,
        provenance: { ...HALABJA_EVENT.provenance, providerId: "us_artifact_down" },
      }),
    ).rejects.toThrow(/503/);
  });

  it("picks the newest version when multiple product versions are returned", async () => {
    mockRpc.mockResolvedValue({ data: INTERNAL_UUID, error: null });
    mockEq3.mockResolvedValue({
      data: [
        validRow({ version: 1, storage_path: "https://example.test/v1/cont_mi.json" }),
        validRow({ version: 3, storage_path: "https://example.test/v3/cont_mi.json" }),
        validRow({ version: 2, storage_path: "https://example.test/v2/cont_mi.json" }),
      ],
      error: null,
    });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct({
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_multi_version" },
    });

    expect(product?.version).toBe(3);
    expect(global.fetch).toHaveBeenCalledWith("https://example.test/v3/cont_mi.json");
  });

  it("returns null without querying anything when unconfigured (defensive-only branch)", async () => {
    mockedGetSupabaseClient.mockReturnValue(null);

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct({
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_unconfigured" },
    });

    expect(product).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
