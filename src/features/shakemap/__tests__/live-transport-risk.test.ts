/**
 * `SupabaseLiveShakeMapTransport.fetchLiveProduct`'s risk-bundle fetch
 * (`fetchRiskBundle`, D46 `risk-dashboard` wave) and the `storage_path`
 * relative/absolute resolution fix (`resolveArtifactUrl`) — a SEPARATE
 * fixture file from `live-transport.test.ts` because these cases need a
 * genuinely chainable query-builder mock (`.eq(...).eq(...).in(...)` in
 * any order), not that file's fixed 3-`.eq()`-deep chain. No real network
 * call anywhere in this file (same discipline `live-transport.test.ts`
 * documents).
 */
import { getSupabaseClient } from "@/lib/supabase";
import type { Event } from "@/features/events";
import { ATLAS_BASE_URL } from "../config";
import { SupabaseLiveShakeMapTransport } from "../live-transport";

/** A tiny chainable query-builder stub — `.eq()`/`.in()` both return
 * `this` so the transport can call them in any order/count, and the
 * builder itself is thenable so `await builder` resolves to the
 * configured `{ data, error }`. Real `@supabase/supabase-js` query
 * builders work exactly this way (thenable, not a real `Promise`). */
function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: {
    eq: jest.Mock;
    in: jest.Mock;
    then: (resolve: (value: typeof result) => void, reject?: (reason: unknown) => void) => void;
  } = {
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

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

const INTERNAL_UUID = "33333333-3333-4333-8333-333333333333";

function contoursRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 5,
    storage_path: "https://example.test/events/us2000bmcg/v5/cont_mi.json",
    data_used: { conditioning_applied: {} },
    review_status: "automatic",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

describe("SupabaseLiveShakeMapTransport.fetchLiveProduct — risk bundle", () => {
  const originalFetch = global.fetch;
  const fetchedUrls: string[] = [];

  function client(
    contoursResult: { data: unknown; error: unknown },
    riskResult: { data: unknown; error: unknown },
  ) {
    const rpc = jest.fn().mockResolvedValue({ data: INTERNAL_UUID, error: null });
    const from = jest.fn((table: string) => {
      expect(table).toBe("shakemap_products");
      return {
        select: jest.fn((columns: string) =>
          // The risk-bundle query selects "product_type, storage_path"
          // (needs product_type to tell the three risk artifact types
          // apart); the contours query never selects product_type at all.
          columns.includes("product_type") ? queryBuilder(riskResult) : queryBuilder(contoursResult),
        ),
      };
    });
    return { rpc, from };
  }

  beforeEach(() => {
    fetchedUrls.length = 0;
    global.fetch = jest.fn(async (url: string) => {
      fetchedUrls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ url }),
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches summary + districts + damage-contour artifacts for the same version and attaches them as risk", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow()], error: null },
        {
          data: [
            { product_type: "risk_summary", storage_path: "https://example.test/v5/risk_summary.json" },
            { product_type: "risk_districts", storage_path: "https://example.test/v5/districts.json" },
            { product_type: "risk_contours", storage_path: "https://example.test/v5/cont_damage.json" },
          ],
          error: null,
        },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(product?.risk).toEqual({
      summary: { url: "https://example.test/v5/risk_summary.json" },
      districts: { url: "https://example.test/v5/districts.json" },
      damageContours: { url: "https://example.test/v5/cont_damage.json" },
    });
  });

  it("resolves a relative risk storage_path against ATLAS_BASE_URL before fetching", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow()], error: null },
        {
          data: [
            { product_type: "risk_summary", storage_path: "events/us2000bmcg/v5/risk_summary.json" },
            { product_type: "risk_districts", storage_path: "events/us2000bmcg/v5/districts.json" },
          ],
          error: null,
        },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(fetchedUrls).toContain(`${ATLAS_BASE_URL}/events/us2000bmcg/v5/risk_summary.json`);
    expect(fetchedUrls).toContain(`${ATLAS_BASE_URL}/events/us2000bmcg/v5/districts.json`);
  });

  it("resolves a relative CONTOURS storage_path against ATLAS_BASE_URL too (not just risk artifacts)", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow({ storage_path: "events/us2000bmcg/v5/cont_mi.json" })], error: null },
        { data: [], error: null },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(fetchedUrls).toContain(`${ATLAS_BASE_URL}/events/us2000bmcg/v5/cont_mi.json`);
  });

  it("degrades to risk: null when only a partial risk publish exists (summary present, districts missing)", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow()], error: null },
        {
          data: [
            { product_type: "risk_summary", storage_path: "https://example.test/v5/risk_summary.json" },
          ],
          error: null,
        },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(product).not.toBeNull();
    expect(product?.risk).toBeNull();
    // The always-present intensity map must still come through untouched.
    expect(product?.contours).toEqual({ url: "https://example.test/events/us2000bmcg/v5/cont_mi.json" });
  });

  it("degrades to risk: null (never throws, never blocks the contours map) when the risk query itself errors", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow()], error: null },
        { data: null, error: { message: "connection refused" } },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(product).not.toBeNull();
    expect(product?.risk).toBeNull();
  });

  it("degrades to risk: null when no risk rows exist at all for this version (ordinary hazard-only product)", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow()], error: null },
        { data: [], error: null },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(product).not.toBeNull();
    expect(product?.risk).toBeNull();
  });

  it("degrades to risk: null when a risk artifact fetch fails (slow/unreachable, never throws the whole call)", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      client(
        { data: [contoursRow()], error: null },
        {
          data: [
            { product_type: "risk_summary", storage_path: "https://example.test/v5/risk_summary.json" },
            { product_type: "risk_districts", storage_path: "https://example.test/v5/districts.json" },
          ],
          error: null,
        },
      ) as unknown as ReturnType<typeof getSupabaseClient>,
    );
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes("districts")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    }) as unknown as typeof fetch;

    const product = await SupabaseLiveShakeMapTransport.fetchLiveProduct(HALABJA_EVENT);

    expect(product).not.toBeNull();
    expect(product?.risk).toBeNull();
  });
});
