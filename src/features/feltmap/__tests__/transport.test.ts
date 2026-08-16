/**
 * `SupabaseFeltMapTransport` — no real network call anywhere in this file
 * (same "no real network calls in tests" discipline as
 * `features/felt/__tests__/supabase-transport.test.ts`). `getSupabaseClient`
 * is mocked at the `@/lib/supabase` seam.
 */
import { getSupabaseClient } from "@/lib/supabase";
import { SupabaseFeltMapTransport } from "../transport";
import { FELT_CELL_ROW_COLUMNS } from "../types";

const mockEq = jest.fn();
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));

const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

function validRow(overrides: Record<string, unknown> = {}) {
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

describe("SupabaseFeltMapTransport.fetchFeltCells", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockEq.mockReset();
    mockedGetSupabaseClient.mockReturnValue({ from: mockFrom } as never);
  });

  it("queries felt_cells_public filtered by event_id, selecting the full contract column list", async () => {
    mockEq.mockResolvedValue({ data: [validRow()], error: null });

    const rows = await SupabaseFeltMapTransport.fetchFeltCells("us2000bmcg");

    expect(mockFrom).toHaveBeenCalledWith("felt_cells_public");
    expect(mockSelect).toHaveBeenCalledWith(FELT_CELL_ROW_COLUMNS.join(", "));
    expect(mockEq).toHaveBeenCalledWith("event_id", "us2000bmcg");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.geohash).toBe("tn263");
  });

  it("tolerantly parses the response, dropping malformed rows", async () => {
    mockEq.mockResolvedValue({
      data: [validRow(), { not: "a valid row" }],
      error: null,
    });

    const rows = await SupabaseFeltMapTransport.fetchFeltCells("us2000bmcg");
    expect(rows).toHaveLength(1);
  });

  it("returns an empty array for a null data response", async () => {
    mockEq.mockResolvedValue({ data: null, error: null });

    const rows = await SupabaseFeltMapTransport.fetchFeltCells("us2000bmcg");
    expect(rows).toEqual([]);
  });

  it("throws (no silent catch) when PostgREST returns an error", async () => {
    mockEq.mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "ECONNREFUSED" },
    });

    await expect(SupabaseFeltMapTransport.fetchFeltCells("us2000bmcg")).rejects.toEqual(
      expect.objectContaining({ message: "connection refused" }),
    );
  });

  it("returns an empty array without querying when unconfigured (defensive-only branch)", async () => {
    mockedGetSupabaseClient.mockReturnValue(null);

    const rows = await SupabaseFeltMapTransport.fetchFeltCells("us2000bmcg");

    expect(rows).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
