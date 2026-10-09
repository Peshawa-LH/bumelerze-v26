import { buildPostThreads, countShown, isDeletedAccountPostComment } from "../threads";
import {
  SupabasePostCommentsTransport,
  parsePostCommentQueue,
  parsePostComments,
} from "../transport";
import { comment } from "../__fixtures__/fake-comments";

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

describe("buildPostThreads (the Event hub's order)", () => {
  it("top comments newest first, replies oldest first under them", () => {
    const threads = buildPostThreads(
      [
        comment("old", 60),
        comment("new", 5),
        comment("r2", 2, { parentId: "old" }),
        comment("r1", 30, { parentId: "old" }),
      ],
      { userId: "me" },
    );
    expect(threads.map((t) => t.root.id)).toEqual(["new", "old"]);
    expect(threads[1]?.replies.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(countShown(threads)).toBe(4);
  });

  it("drops a reply whose top comment is not shown, and a muted person's comments", () => {
    const threads = buildPostThreads(
      [
        comment("a", 10),
        comment("orphan", 5, { parentId: "gone" }),
        comment("m", 3, { userId: "muted" }),
        comment("under-m", 2, { parentId: "m" }),
        comment("mine", 1, { userId: "me" }),
      ],
      { userId: "me", mutedIds: new Set(["muted", "me"]) },
    );
    expect(threads.map((t) => t.root.id)).toEqual(["mine", "a"]);
  });

  it("keeps a removed or deleted-account comment only above live replies", () => {
    const deleted = comment("d", 50, { userId: null, username: null, body: "" });
    expect(isDeletedAccountPostComment(deleted)).toBe(true);
    const threads = buildPostThreads(
      [
        comment("removed-alone", 40, { status: "removed", userId: null, body: "" }),
        comment("removed-head", 30, { status: "removed", userId: null, body: "" }),
        comment("reply", 20, { parentId: "removed-head" }),
        deleted,
        comment("removed-reply", 10, { parentId: "reply-parent", status: "removed" }),
      ],
      { userId: "me" },
    );
    expect(threads.map((t) => t.root.id)).toEqual(["removed-head"]);
    expect(countShown(threads)).toBe(1);
  });
});

describe("parsing", () => {
  it("keeps public fields and known ranks only, drops bad rows", () => {
    const rows = parsePostComments([
      {
        comment_id: "c1",
        post_id: "p1",
        parent_id: null,
        user_id: "u1",
        username: "shirin",
        display_name: "Shirin",
        avatar_path: "u1/a.jpg",
        roles: [{ role: "engineer", org_name: null }, { role: "admin" }],
        body: "hello @aso",
        status: "visible",
        created_at: "2026-10-09T10:00:00Z",
        email: "x@y.org",
      },
      {
        comment_id: "c2",
        post_id: "p1",
        parent_id: null,
        user_id: null,
        body: "",
        status: "hidden",
        created_at: "2026-10-09T10:00:00Z",
      },
      {
        comment_id: "c3",
        post_id: "p1",
        parent_id: null,
        user_id: null,
        body: "",
        status: "removed",
        created_at: "bad",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "c1",
      username: "shirin",
      roles: [{ role: "engineer", orgName: null }],
      body: "hello @aso",
    });
    expect(JSON.stringify(rows)).not.toContain("x@y.org");
  });

  it("parses the moderators' queue", () => {
    const [row] = parsePostCommentQueue([
      {
        comment_id: "c1",
        post_id: "p1",
        post_author_username: "dilan",
        author_id: "u1",
        username: "shirin",
        display_name: "Shirin",
        body: "x",
        status: "pending",
        report_count: "2",
        last_reason: "spam",
        last_note: null,
        created_at: "2026-10-09T10:00:00Z",
      },
    ]);
    expect(row).toMatchObject({
      commentId: "c1",
      postAuthorUsername: "dilan",
      status: "pending",
      reportCount: 2,
    });
  });
});

describe("SupabasePostCommentsTransport", () => {
  beforeEach(() => mockRpc.mockReset());

  it("sends the client id so a retry never makes a second comment", async () => {
    mockRpc.mockResolvedValue({
      data: { comment_id: "cid", status: "pending" },
      error: null,
    });
    const result = await SupabasePostCommentsTransport.addComment({
      postId: "p1",
      body: "  hi @shirin  ",
      parentId: null,
      clientId: "cid",
    });
    expect(mockRpc).toHaveBeenCalledWith("add_post_comment", {
      p_post_id: "p1",
      p_body: "hi @shirin",
      p_parent_id: null,
      p_comment_id: "cid",
    });
    expect(result).toEqual({ id: "cid", status: "pending" });
  });

  it("says who deleted, and maps comments_off", async () => {
    mockRpc.mockResolvedValueOnce({ data: "owner", error: null });
    expect(await SupabasePostCommentsTransport.deleteComment("c1")).toBe("owner");
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "post_comments: comments_off", code: "42501" },
    });
    await expect(
      SupabasePostCommentsTransport.addComment({
        postId: "p",
        body: "x",
        parentId: null,
        clientId: "c",
      }),
    ).rejects.toMatchObject({ code: "comments_off" });
  });

  it("reports with the shared reasons and the trimmed note", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabasePostCommentsTransport.reportComment("c1", "spam", "  rude  ");
    expect(mockRpc).toHaveBeenCalledWith("report_post_comment", {
      p_comment_id: "c1",
      p_reason: "spam",
      p_note: "rude",
    });
  });
});
