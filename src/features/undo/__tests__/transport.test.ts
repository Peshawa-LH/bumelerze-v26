import { parseRecentlyDeleted, SupabaseUndoTransport } from "../transport";

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

const COMMENT = {
  kind: "comment",
  item_id: "c1",
  body: "Felt it",
  deleted_at: "2026-10-08T09:00:00Z",
  expires_at: "2026-10-09T09:00:00Z",
  hub_id: "bml202610aa",
  place: "Duhok",
  magnitude: "4.2",
};

describe("parseRecentlyDeleted", () => {
  it("reads comments and posts, with the moment Restore stops working", () => {
    const rows = parseRecentlyDeleted([
      COMMENT,
      {
        kind: "post",
        item_id: "p1",
        body: "A post",
        deleted_at: "2026-10-08T10:00:00Z",
        expires_at: "2026-10-09T10:00:00Z",
        hub_id: null,
        place: null,
        magnitude: null,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "comment",
      id: "c1",
      hubId: "bml202610aa",
      place: "Duhok",
      magnitude: 4.2,
    });
    expect(rows[0]?.expiresAt).toBe(Date.parse("2026-10-09T09:00:00Z"));
    expect(rows[1]).toMatchObject({
      kind: "post",
      id: "p1",
      hubId: null,
      magnitude: null,
    });
  });

  it("drops malformed rows and answers [] for a non-list", () => {
    expect(
      parseRecentlyDeleted([
        COMMENT,
        { ...COMMENT, kind: "photo" },
        { ...COMMENT, expires_at: "nope" },
        { item_id: "x" },
        3,
      ]),
    ).toHaveLength(1);
    expect(parseRecentlyDeleted(undefined)).toEqual([]);
  });
});

describe("SupabaseUndoTransport", () => {
  beforeEach(() => mockRpc.mockReset());

  it("reads my_recently_deleted", async () => {
    mockRpc.mockResolvedValueOnce({ data: [COMMENT], error: null });
    const rows = await SupabaseUndoTransport.fetchRecentlyDeleted();
    expect(mockRpc).toHaveBeenCalledWith("my_recently_deleted");
    expect(rows).toHaveLength(1);
  });

  it("is 'unavailable' before the migration is applied", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    await expect(SupabaseUndoTransport.fetchRecentlyDeleted()).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
