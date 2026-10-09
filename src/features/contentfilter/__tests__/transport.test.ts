import {
  SupabaseContentFilterTransport,
  filterInputProblem,
  parseHolds,
  parseSurgeStatus,
  parseTerms,
  parseTestResult,
} from "../transport";

/**
 * The word filter transport (migration 0059) against a fake Supabase client:
 * the parsers drop odd rows instead of throwing, and every call names the
 * server function and arguments the migration defines.
 */

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  }),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("parsers", () => {
  it("reads the list and drops malformed rows", () => {
    const rows = parseTerms([
      {
        term_id: "t1",
        term: "quake tomorrow",
        lang: "en",
        kind: "prediction",
        is_pattern: false,
        active: true,
        draft: true,
        holds_30d: "4",
      },
      { term_id: "t2", term: "x", lang: "fr", kind: "weird" },
      { term: "no id" },
      null,
    ]);
    expect(rows).toEqual([
      {
        id: "t1",
        term: "quake tomorrow",
        lang: "en",
        kind: "prediction",
        isPattern: false,
        active: true,
        draft: true,
        holds30d: 4,
      },
      {
        id: "t2",
        term: "x",
        lang: "any",
        kind: "other",
        isPattern: false,
        active: true,
        draft: false,
        holds30d: 0,
      },
    ]);
    expect(parseTerms("nope")).toEqual([]);
  });

  it("reads the test box answer", () => {
    expect(
      parseTestResult({
        held: true,
        matches: [
          { term: "quake tonight", kind: "prediction", lang: "en", is_pattern: false },
        ],
        surge: false,
      }),
    ).toEqual({
      held: true,
      matches: [
        { term: "quake tonight", kind: "prediction", lang: "en", isPattern: false },
      ],
      surge: false,
    });
    expect(parseTestResult(null)).toEqual({ held: false, matches: [], surge: false });
  });

  it("reads busy-time status with its reason and thresholds", () => {
    const status = parseSurgeStatus({
      active: true,
      mode: "auto",
      until: "2026-10-10T08:00:00Z",
      reason: "magnitude",
      event_ref: "bml2026big",
      magnitude: 5.2,
      place: "Halabja",
      min_magnitude: 5,
      felt_reports: 50,
      account_days: 7,
    });
    expect(status).toMatchObject({
      active: true,
      mode: "auto",
      until: Date.parse("2026-10-10T08:00:00Z"),
      reason: "magnitude",
      eventRef: "bml2026big",
      magnitude: 5.2,
      place: "Halabja",
      minMagnitude: 5,
      feltReports: 50,
      accountDays: 7,
    });
    expect(parseSurgeStatus(null)).toMatchObject({
      active: false,
      mode: "auto",
      until: null,
    });
  });

  it("reads holds and drops unknown reasons", () => {
    expect(
      parseHolds([
        { target_id: "c1", reason: "filter", term: "kys", kind: "abuse" },
        { target_id: "c2", reason: "surge", term: null, kind: null },
        { target_id: "c3", reason: "other" },
      ]),
    ).toEqual([
      { targetId: "c1", reason: "filter", term: "kys", kind: "abuse" },
      { targetId: "c2", reason: "surge", term: null, kind: null },
    ]);
  });

  it("names the server's validation problems", () => {
    expect(filterInputProblem(new Error("admin_add_filter_term: term_invalid"))).toBe(
      "term_invalid",
    );
    expect(filterInputProblem(new Error("boom"))).toBeNull();
  });
});

describe("SupabaseContentFilterTransport", () => {
  it("calls the 0059 functions with their arguments", async () => {
    mockRpc.mockResolvedValueOnce({ data: "new-id", error: null });
    await expect(
      SupabaseContentFilterTransport.addTerm("  free iphone ", "en", "spam"),
    ).resolves.toBe("new-id");
    expect(mockRpc).toHaveBeenLastCalledWith("admin_add_filter_term", {
      p_term: "free iphone",
      p_lang: "en",
      p_kind: "spam",
    });
    await SupabaseContentFilterTransport.setTermActive("t1", false);
    expect(mockRpc).toHaveBeenLastCalledWith("admin_set_filter_term", {
      p_term_id: "t1",
      p_active: false,
    });
    await SupabaseContentFilterTransport.setSurgeMode("on");
    expect(mockRpc).toHaveBeenLastCalledWith("admin_set_surge_mode", { p_mode: "on" });
    await SupabaseContentFilterTransport.approvePost("p1");
    expect(mockRpc).toHaveBeenLastCalledWith("admin_approve_post", {
      p_post_id: "p1",
      p_note: null,
    });
    await SupabaseContentFilterTransport.pinComment("c1");
    expect(mockRpc).toHaveBeenLastCalledWith("pin_hub_comment", { p_comment_id: "c1" });
    await SupabaseContentFilterTransport.unpinComment("c1");
    expect(mockRpc).toHaveBeenLastCalledWith("unpin_hub_comment", { p_comment_id: "c1" });
    await SupabaseContentFilterTransport.fetchHolds("post", ["p1", "p2"]);
    expect(mockRpc).toHaveBeenLastCalledWith("content_holds_for", {
      p_target_type: "post",
      p_ids: ["p1", "p2"],
    });
  });

  it("asks nothing for an empty id list, and at most 200 ids", async () => {
    await expect(
      SupabaseContentFilterTransport.fetchHolds("comment", []),
    ).resolves.toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`);
    await SupabaseContentFilterTransport.fetchHolds("comment", ids);
    expect((mockRpc.mock.calls[0]?.[1] as { p_ids: string[] }).p_ids).toHaveLength(200);
  });

  it("shows no banner on a server before 0059, and passes other failures on", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(SupabaseContentFilterTransport.fetchSurgeActive()).resolves.toBe(true);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "missing" },
    });
    await expect(SupabaseContentFilterTransport.fetchSurgeActive()).resolves.toBe(false);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    await expect(SupabaseContentFilterTransport.fetchSurgeActive()).rejects.toThrow();
  });
});
