import {
  SupabaseCheckInTransport,
  SupabaseFamilyCheckInTransport,
  classifyCheckInError,
  parseFamilyCheckIns,
} from "../transport";

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
const mockRpc = jest.fn<Promise<Result>, [string, Record<string, unknown>]>();
let mockConfigured = true;

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  getSupabaseClient: () =>
    mockConfigured
      ? { rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args) }
      : null,
  signInAnonymously: jest.fn(),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockConfigured = true;
});

describe("check_in call", () => {
  it("sends exactly the client id, the event id and the time: no location", async () => {
    mockRpc.mockResolvedValue({ data: { client_id: "c1", status: "safe" }, error: null });
    const result = await SupabaseCheckInTransport.checkIn({
      clientId: "c1",
      eventId: "e1",
      checkedInAt: Date.UTC(2026, 9, 8, 11, 30),
    });
    expect(result).toEqual({ outcome: "sent" });
    const [name, args] = mockRpc.mock.calls[0] ?? [];
    expect(name).toBe("check_in");
    expect(Object.keys(args ?? {}).sort()).toEqual([
      "p_checked_in_at",
      "p_client_id",
      "p_event_id",
    ]);
    expect(args).toEqual({
      p_client_id: "c1",
      p_event_id: "e1",
      p_checked_in_at: "2026-10-08T11:30:00.000Z",
    });
  });

  it("a server tombstone reads as 'retracted'", async () => {
    mockRpc.mockResolvedValue({
      data: { client_id: "c1", status: "retracted" },
      error: null,
    });
    await expect(
      SupabaseCheckInTransport.checkIn({ clientId: "c1", eventId: "e1", checkedInAt: 0 }),
    ).resolves.toEqual({ outcome: "retracted" });
  });

  it("classifies errors: terminal vs retried", () => {
    expect(
      classifyCheckInError({ code: "42501", message: "check_in: not_account" }),
    ).toEqual({
      retryable: false,
      reason: "not_account",
    });
    expect(
      classifyCheckInError({ code: "22023", message: "check_in: event_too_old" }),
    ).toEqual({
      retryable: false,
      reason: "event",
    });
    expect(
      classifyCheckInError({ code: "54000", message: "check_in: rate_limited" })
        .retryable,
    ).toBe(true);
    expect(classifyCheckInError({ message: "Failed to fetch" })).toEqual({
      retryable: true,
      reason: "network",
    });
    // 0057 not applied yet: function missing. Kept, retried later.
    expect(
      classifyCheckInError({ code: "PGRST202", message: "Could not find the function" })
        .retryable,
    ).toBe(true);
  });

  it("network exceptions keep the check-in queued", async () => {
    mockRpc.mockRejectedValue(new Error("network request failed"));
    await expect(
      SupabaseCheckInTransport.checkIn({ clientId: "c1", eventId: "e1", checkedInAt: 0 }),
    ).resolves.toEqual({ outcome: "failed", retryable: true, reason: "network" });
  });

  it("retract: done on success, and when there is no account any more", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await expect(SupabaseCheckInTransport.retract("c1")).resolves.toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("retract_checkin", { p_client_id: "c1" });
    mockRpc.mockResolvedValueOnce({ error: { code: "42501" } });
    await expect(SupabaseCheckInTransport.retract("c1")).resolves.toBe(true);
    mockRpc.mockResolvedValueOnce({ error: { code: "XX000" } });
    await expect(SupabaseCheckInTransport.retract("c1")).resolves.toBe(false);
  });
});

describe("family status", () => {
  const row = {
    user_id: "u1",
    checked_in_at: "2026-10-08T11:30:00Z",
    event_id: "e1",
    bumelerze_id: "bml1",
    magnitude: 5.1,
    place: "Halabja",
    origin_time: "2026-10-08T11:21:00Z",
  };

  it("parses rows and drops broken ones", () => {
    const parsed = parseFamilyCheckIns({
      my_share: false,
      sharing: ["u1", "u2"],
      checkins: [
        row,
        { ...row, user_id: 3 },
        { ...row, checked_in_at: "nonsense" },
        { ...row, magnitude: "5.4", user_id: "u2" },
      ],
    });
    expect(parsed.myShare).toBe(false);
    expect(parsed.sharing).toEqual(["u1", "u2"]);
    expect(parsed.checkins.map((c) => [c.userId, c.event.magnitude])).toEqual([
      ["u1", 5.1],
      ["u2", 5.4],
    ]);
  });

  it("ignores any extra (e.g. location) field the server might ever add", () => {
    const parsed = parseFamilyCheckIns({
      sharing: ["u1"],
      checkins: [{ ...row, lat: 35.1, lon: 45.9, geohash: "sv3" }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/lat|lon|geohash/);
  });

  it("malformed payload: empty, not a crash", () => {
    expect(parseFamilyCheckIns(null)).toEqual({
      myShare: null,
      sharing: [],
      checkins: [],
    });
  });

  it("reads through the fixed function only, and sets my switch", async () => {
    mockRpc.mockResolvedValueOnce({ data: { sharing: [], checkins: [] }, error: null });
    await SupabaseFamilyCheckInTransport.fetchFamily("tag-1");
    expect(mockRpc).toHaveBeenLastCalledWith("family_checkins", { p_tag: "tag-1" });
    mockRpc.mockResolvedValueOnce({ error: null });
    await SupabaseFamilyCheckInTransport.setSharing("tag-1", false);
    expect(mockRpc).toHaveBeenLastCalledWith("set_checkin_sharing", {
      p_tag: "tag-1",
      p_on: false,
    });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "members only" },
    });
    await expect(SupabaseFamilyCheckInTransport.fetchFamily("tag-1")).rejects.toThrow(
      "members only",
    );
  });
});
