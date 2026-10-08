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

describe("SupabasePostsTransport.fetchPosts", () => {
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
    await SupabasePostsTransport.adminRemovePost("p1", "abuse");
    expect(mockRpc).toHaveBeenNthCalledWith(1, "report_post", {
      p_post: "p1",
      p_reason: "spam",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "admin_remove_post", {
      p_post_id: "p1",
      p_reason: "abuse",
    });
  });
});
