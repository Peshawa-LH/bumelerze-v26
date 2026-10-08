import { SupabasePostsTransport, parsePosts } from "../transport";

const mockCalls: { method: string; args: unknown[] }[] = [];
let mockResult: { data: unknown; error: unknown } = { data: [], error: null };

/** A chainable stand-in for the PostgREST query mockBuilder. */
function mockBuilder() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt", "order", "limit", "insert", "delete"]) {
    chain[method] = (...args: unknown[]) => {
      mockCalls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(mockResult);
  return chain;
}

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      mockCalls.push({ method: "from", args: [table] });
      return mockBuilder();
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

const ROW = (n: number) => ({
  post_id: `p${n}`,
  user_id: "u1",
  body: `post ${n}`,
  status: "visible",
  created_at: `2026-10-0${n}T10:00:00.123456+00:00`,
});

beforeEach(() => {
  mockCalls.length = 0;
  mockRpc.mockReset();
  mockResult = { data: [], error: null };
});

describe("parsePosts", () => {
  it("keeps valid rows and drops malformed ones", () => {
    const posts = parsePosts([
      ROW(2),
      { post_id: "bad" },
      { ...ROW(3), status: "weird" },
      { ...ROW(4), created_at: "not a date" },
    ]);
    expect(posts.map((post) => post.id)).toEqual(["p2"]);
    expect(posts[0]?.cursor).toBe("2026-10-02T10:00:00.123456+00:00");
    expect(posts[0]?.createdAt).toBe(Date.parse("2026-10-02T10:00:00.123Z"));
  });

  it("ignores a non-array answer", () => {
    expect(parsePosts(null)).toEqual([]);
    expect(parsePosts({})).toEqual([]);
  });
});

describe("SupabasePostsTransport.fetchPosts before migration 0058 (plain table read)", () => {
  beforeEach(() => {
    // profile_posts_page() does not exist yet
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
  });

  it("asks for one author's visible posts, newest first, one row more than a page", async () => {
    await SupabasePostsTransport.fetchPosts({
      userId: "u1",
      before: null,
      includeRemoved: false,
      limit: 2,
    });
    const names = mockCalls.map((call) => call.method);
    expect(mockCalls[0]).toEqual({ method: "from", args: ["profile_posts"] });
    expect(names).toContain("select");
    expect(
      mockCalls.find((c) => c.method === "eq" && c.args[0] === "user_id")?.args[1],
    ).toBe("u1");
    expect(
      mockCalls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1],
    ).toBe("visible");
    expect(mockCalls.find((c) => c.method === "order")?.args).toEqual([
      "created_at",
      { ascending: false },
    ]);
    expect(mockCalls.find((c) => c.method === "limit")?.args).toEqual([3]);
    expect(names).not.toContain("lt");
  });

  it("the author also asks for removed posts and pages with the raw cursor", async () => {
    await SupabasePostsTransport.fetchPosts({
      userId: "me",
      before: "2026-10-02T10:00:00.123456+00:00",
      includeRemoved: true,
    });
    expect(mockCalls.some((c) => c.method === "eq" && c.args[0] === "status")).toBe(
      false,
    );
    expect(mockCalls.find((c) => c.method === "lt")?.args).toEqual([
      "created_at",
      "2026-10-02T10:00:00.123456+00:00",
    ]);
  });

  it("returns a next cursor only when there is another page", async () => {
    mockResult = { data: [ROW(3), ROW(2), ROW(1)], error: null };
    const first = await SupabasePostsTransport.fetchPosts({
      userId: "u1",
      before: null,
      includeRemoved: false,
      limit: 2,
    });
    expect(first.posts.map((p) => p.id)).toEqual(["p3", "p2"]);
    expect(first.nextCursor).toBe(ROW(2).created_at);

    mockResult = { data: [ROW(3), ROW(2)], error: null };
    const last = await SupabasePostsTransport.fetchPosts({
      userId: "u1",
      before: null,
      includeRemoved: false,
      limit: 2,
    });
    expect(last.nextCursor).toBeNull();
  });

  it("maps a missing table (migration not applied) to 'unavailable'", async () => {
    mockResult = {
      data: null,
      error: { code: "PGRST205", message: "Could not find the table" },
    };
    await expect(
      SupabasePostsTransport.fetchPosts({
        userId: "u1",
        before: null,
        includeRemoved: false,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

const RPC_ROW = (n: number, extra: Record<string, unknown> = {}) => ({
  ...ROW(n),
  kind: "text",
  edited_at: null,
  event_ref: null,
  event_magnitude: null,
  event_lat: null,
  event_lon: null,
  event_time: null,
  helpful_count: 0,
  my_helpful: false,
  edit_locked: false,
  ...extra,
});

describe("SupabasePostsTransport.fetchPosts (migration 0058)", () => {
  it("reads one page through profile_posts_page with one extra row and the raw cursor", async () => {
    mockRpc.mockResolvedValue({
      data: [RPC_ROW(3), RPC_ROW(2), RPC_ROW(1)],
      error: null,
    });
    const page = await SupabasePostsTransport.fetchPosts({
      userId: "u1",
      before: "2026-10-09T10:00:00.123456+00:00",
      includeRemoved: true,
      limit: 2,
    });
    expect(mockRpc).toHaveBeenCalledWith("profile_posts_page", {
      p_user: "u1",
      p_before: "2026-10-09T10:00:00.123456+00:00",
      p_limit: 3,
      p_include_removed: true,
    });
    expect(mockCalls.find((c) => c.method === "from")).toBeUndefined();
    expect(page.posts.map((p) => p.id)).toEqual(["p3", "p2"]);
    expect(page.nextCursor).toBe(ROW(2).created_at);
  });

  it("parses the edited mark, helpful count, my mark and the author's edit lock", async () => {
    mockRpc.mockResolvedValue({
      data: [
        RPC_ROW(2, {
          edited_at: "2026-10-03T08:00:00Z",
          helpful_count: 4,
          my_helpful: true,
          edit_locked: true,
        }),
      ],
      error: null,
    });
    const [p] = (
      await SupabasePostsTransport.fetchPosts({
        userId: "u1",
        before: null,
        includeRemoved: false,
      })
    ).posts;
    expect(p).toMatchObject({
      kind: "text",
      event: null,
      editedAt: Date.parse("2026-10-03T08:00:00Z"),
      helpfulCount: 4,
      myHelpful: true,
      editLocked: true,
    });
  });

  it("parses an event post into a card of the earthquake's public data only", async () => {
    mockRpc.mockResolvedValue({
      data: [
        RPC_ROW(2, {
          kind: "event",
          body: "",
          event_ref: "bml2026abc",
          event_magnitude: "5.1",
          event_lat: 35.2,
          event_lon: 45.9,
          event_time: "2026-10-01T03:00:00Z",
        }),
      ],
      error: null,
    });
    const [p] = (
      await SupabasePostsTransport.fetchPosts({
        userId: "u1",
        before: null,
        includeRemoved: false,
      })
    ).posts;
    expect(p?.event).toEqual({
      ref: "bml2026abc",
      magnitude: 5.1,
      lat: 35.2,
      lon: 45.9,
      time: Date.parse("2026-10-01T03:00:00Z"),
    });
    expect(p?.body).toBe("");
  });

  it("fetches one post by id (the pinned one), null when it cannot be read", async () => {
    mockRpc.mockResolvedValueOnce({ data: [RPC_ROW(5)], error: null });
    expect((await SupabasePostsTransport.fetchPost("u1", "p5"))?.id).toBe("p5");
    expect(mockRpc).toHaveBeenCalledWith("profile_posts_page", {
      p_user: "u1",
      p_limit: 1,
      p_post_id: "p5",
    });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await SupabasePostsTransport.fetchPost("u1", "hidden")).toBeNull();
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "x" },
    });
    expect(await SupabasePostsTransport.fetchPost("u1", "p5")).toBeNull();
  });

  it("does not fall back to the table for other errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "network down" },
    });
    await expect(
      SupabasePostsTransport.fetchPosts({
        userId: "u1",
        before: null,
        includeRemoved: false,
      }),
    ).rejects.toMatchObject({ code: "network" });
    expect(mockCalls.find((c) => c.method === "from")).toBeUndefined();
  });
});

describe("SupabasePostsTransport 0058 writes", () => {
  it("edits through edit_my_post with the trimmed text", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabasePostsTransport.editPost("p1", "  fixed  ");
    expect(mockRpc).toHaveBeenCalledWith("edit_my_post", {
      p_post_id: "p1",
      p_body: "fixed",
    });
  });

  it("words the edit lock of a reported post", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "profile_posts: edit_locked" },
    });
    await expect(SupabasePostsTransport.editPost("p1", "x")).rejects.toMatchObject({
      code: "edit_locked",
    });
  });

  it("words a too long text, without confusing the admin's ends_too_long", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "edit_my_post: too_long" },
    });
    await expect(SupabasePostsTransport.editPost("p1", "x")).rejects.toMatchObject({
      code: "too_long",
    });
    const { toCommunityError } = jest.requireActual("@/features/community/transport");
    expect(
      toCommunityError({ message: "admin_restrict_account: ends_too_long" }).code,
    ).toBe("bad_end_date");
  });

  it("sets Helpful and returns the server's count", async () => {
    mockRpc.mockResolvedValue({ data: { helpful: true, count: 3 }, error: null });
    await expect(SupabasePostsTransport.setHelpful("p1", true)).resolves.toEqual({
      helpful: true,
      count: 3,
    });
    expect(mockRpc).toHaveBeenCalledWith("set_post_helpful", {
      p_post_id: "p1",
      p_helpful: true,
    });
  });

  it("pins and unpins through set_pinned_post", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabasePostsTransport.setPinned("p1");
    await SupabasePostsTransport.setPinned(null);
    expect(mockRpc).toHaveBeenNthCalledWith(1, "set_pinned_post", { p_post_id: "p1" });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "set_pinned_post", { p_post_id: null });
  });

  it("shares an earthquake with the event id and the text only (never a location)", async () => {
    mockRpc.mockResolvedValue({ data: "new-post", error: null });
    await expect(
      SupabasePostsTransport.shareEvent("bml2026abc", "  felt it  "),
    ).resolves.toBe("new-post");
    expect(mockRpc).toHaveBeenCalledWith("share_event_to_profile", {
      p_event: "bml2026abc",
      p_body: "felt it",
    });
    const args = mockRpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_event"]);
  });
});

describe("SupabasePostsTransport writes", () => {
  it("inserts only the author and the trimmed text", async () => {
    await SupabasePostsTransport.createPost("me", "  hello  ");
    expect(mockCalls.find((c) => c.method === "insert")?.args).toEqual([
      { user_id: "me", body: "hello" },
    ]);
  });

  it("surfaces a rate limit from the server", async () => {
    mockResult = {
      data: null,
      error: { code: "54000", message: "profile_posts: rate_limited" },
    };
    await expect(SupabasePostsTransport.createPost("me", "x")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("deletes through delete_my_post (a soft delete the author can undo), never a table delete", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabasePostsTransport.deletePost("p1");
    expect(mockRpc).toHaveBeenCalledWith("delete_my_post", { p_post_id: "p1" });
    expect(mockCalls.find((c) => c.method === "delete")).toBeUndefined();
  });

  it("restores through restore_my_post and admin_restore_post", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabasePostsTransport.restorePost("p1");
    await SupabasePostsTransport.adminRestorePost("p2");
    expect(mockRpc).toHaveBeenNthCalledWith(1, "restore_my_post", { p_post_id: "p1" });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "admin_restore_post", {
      p_post_id: "p2",
      p_note: null,
    });
  });

  it("words a too-late restore as expired", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "restore_my_post: expired" },
    });
    await expect(SupabasePostsTransport.restorePost("p1")).rejects.toMatchObject({
      code: "expired",
    });
  });

  it("reports and removes through their functions", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabasePostsTransport.reportPost("p1", "spam");
    await SupabasePostsTransport.reportPost(
      "p2",
      "rumour_prediction",
      "  predicts tonight ",
    );
    await SupabasePostsTransport.adminRemovePost("p1", "abuse");
    expect(mockRpc).toHaveBeenNthCalledWith(1, "report_post", {
      p_post: "p1",
      p_reason: "spam",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "report_post", {
      p_post: "p2",
      p_reason: "rumour_prediction",
      p_note: "predicts tonight",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(3, "admin_remove_post", {
      p_post_id: "p1",
      p_reason: "abuse",
    });
  });
});
