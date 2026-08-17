/**
 * `SupabaseLiveShakeMapTransport.fetchLiveProduct` — no real network call
 * anywhere in this file (same "no real network calls in tests" discipline
 * as `feltmap/__tests__/transport.test.ts`). `getSupabaseClient` is mocked
 * at the `@/lib/supabase` seam; `fetch` is mocked globally for the artifact
 * request.
 */
import { getSupabaseClient } from "@/lib/supabase";
import type { Event } from "@/features/events";
import { SupabaseLiveShakeMapTransport } from "../live-transport";

const mockRpc = jest.fn();
const mockEq3 = jest.fn();
const mockEq2 = jest.fn(() => ({ eq: mockEq3 }));
const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
const mockSelect = jest.fn(() => ({ eq: mockEq1 }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

const HALABJA_EVENT: Event = {
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

const INTERNAL_UUID = "11111111-1111-4111-8111-111111111111";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    storage_path: "https://example.test/events/us2000bmcg/v2/cont_mi.json",
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

  it("resolves the event uuid, queries shakemap_products with the right filters, and fetches the artifact", async () => {
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
    expect(mockEq3).toHaveBeenCalledWith("product_type", "contours");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/events/us2000bmcg/v2/cont_mi.json",
    );

    expect(product).not.toBeNull();
    expect(product?.version).toBe(2);
    expect(product?.reviewStatus).toBe("automatic");
    expect(product?.dataUsedSummaryKey).toBe("stationConditioned");
    expect(product?.engineVersion?.serviceVersion).toBe("0.1.0");
    expect(product?.contours).toEqual(CONTOURS_PAYLOAD);
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

  it("returns null (never throws) when resolution fails — degrades to no live product", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct({
      ...HALABJA_EVENT,
      provenance: { ...HALABJA_EVENT.provenance, providerId: "us_resolution_fails" },
    });

    expect(product).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
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
