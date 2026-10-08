import { buildThreads, isCommentShown } from "../threads";
import type { HubComment } from "../types";

function comment(overrides: Partial<HubComment> & { id: string }): HubComment {
  return {
    eventId: "e1",
    parentId: null,
    userId: "u-other",
    body: "text",
    areaGeohash: null,
    status: "visible",
    helpfulCount: 0,
    replyCount: 0,
    createdAt: 1_000,
    ...overrides,
  };
}

const anon = { userId: null, isModerator: false };

describe("isCommentShown", () => {
  it("shows visible comments to everyone and hidden ones to nobody", () => {
    expect(isCommentShown(comment({ id: "a" }), anon)).toBe(true);
    const hidden = comment({ id: "h", status: "hidden", userId: "me" });
    expect(isCommentShown(hidden, { userId: "me", isModerator: true })).toBe(false);
  });

  it("shows a pending comment to its author and to moderators only", () => {
    const pending = comment({ id: "p", status: "pending", userId: "me" });
    expect(isCommentShown(pending, anon)).toBe(false);
    expect(isCommentShown(pending, { userId: "someone", isModerator: false })).toBe(
      false,
    );
    expect(isCommentShown(pending, { userId: "me", isModerator: false })).toBe(true);
    expect(isCommentShown(pending, { userId: "mod", isModerator: true })).toBe(true);
  });
});

describe("buildThreads", () => {
  it("orders threads newest first and replies oldest first", () => {
    const threads = buildThreads(
      [
        comment({ id: "old", createdAt: 1_000 }),
        comment({ id: "new", createdAt: 5_000 }),
        comment({ id: "r2", parentId: "old", createdAt: 3_000 }),
        comment({ id: "r1", parentId: "old", createdAt: 2_000 }),
      ],
      anon,
    );
    expect(threads.map((t) => t.root.id)).toEqual(["new", "old"]);
    expect(threads[1]?.replies.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(threads[0]?.replies).toEqual([]);
  });

  it("drops replies whose parent is not shown", () => {
    const threads = buildThreads(
      [
        comment({ id: "gone", status: "hidden" }),
        comment({ id: "orphan", parentId: "gone" }),
        comment({ id: "alive" }),
      ],
      anon,
    );
    expect(threads.map((t) => t.root.id)).toEqual(["alive"]);
  });

  it("keeps a pending thread for a moderator, together with its visible replies", () => {
    const rows = [
      comment({ id: "p", status: "pending", createdAt: 2_000 }),
      comment({ id: "r", parentId: "p", createdAt: 3_000 }),
    ];
    expect(buildThreads(rows, anon)).toEqual([]);
    const forMod = buildThreads(rows, { userId: "mod", isModerator: true });
    expect(forMod[0]?.root.id).toBe("p");
    expect(forMod[0]?.replies.map((r) => r.id)).toEqual(["r"]);
  });
});

describe("removed comments and followed authors", () => {
  it("shows a removed comment to everyone, so its replies keep their parent", () => {
    const removed = comment({ id: "r", status: "removed", body: "" });
    expect(isCommentShown(removed, anon)).toBe(true);
    const threads = buildThreads(
      [removed, comment({ id: "reply", parentId: "r", createdAt: 2_000 })],
      anon,
    );
    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["reply"]);
  });

  it("leaves readers no trace of a removed thread or a removed reply", () => {
    const threads = buildThreads(
      [
        comment({ id: "gone", status: "removed", body: "" }),
        comment({
          id: "gone-reply",
          parentId: "gone",
          status: "removed",
          body: "",
          createdAt: 2_000,
        }),
        comment({ id: "kept", createdAt: 3_000 }),
        comment({
          id: "kept-removed-reply",
          parentId: "kept",
          status: "removed",
          body: "",
          createdAt: 4_000,
        }),
      ],
      anon,
    );
    expect(threads.map((t) => t.root.id)).toEqual(["kept"]);
    expect(threads[0]?.replies).toEqual([]);
  });

  it("still shows moderators every removed placeholder", () => {
    const threads = buildThreads(
      [
        comment({ id: "gone", status: "removed", body: "" }),
        comment({
          id: "gone-reply",
          parentId: "gone",
          status: "removed",
          body: "",
          createdAt: 2_000,
        }),
      ],
      { userId: "mod", isModerator: true },
    );
    expect(threads.map((t) => t.root.id)).toEqual(["gone"]);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["gone-reply"]);
  });

  it("puts threads by followed people first, each group newest first", () => {
    const comments = [
      comment({ id: "a", userId: "stranger", createdAt: 5_000 }),
      comment({ id: "b", userId: "friend", createdAt: 1_000 }),
      comment({ id: "c", userId: "friend", createdAt: 3_000 }),
      comment({ id: "d", userId: "stranger", createdAt: 4_000 }),
    ];
    const threads = buildThreads(comments, {
      userId: null,
      isModerator: false,
      followingIds: new Set(["friend"]),
    });
    expect(threads.map((t) => t.root.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("keeps the plain newest-first order without a following list", () => {
    const comments = [
      comment({ id: "a", createdAt: 1_000 }),
      comment({ id: "b", createdAt: 2_000 }),
    ];
    expect(buildThreads(comments, anon).map((t) => t.root.id)).toEqual(["b", "a"]);
  });
});

describe("comments of a deleted account", () => {
  const blank = (id: string, extra: Partial<HubComment> = {}) =>
    comment({ id, userId: null, body: "", ...extra });

  it("stays as the head of a conversation that still has replies", () => {
    const threads = buildThreads(
      [blank("b"), comment({ id: "r", parentId: "b", createdAt: 2_000 })],
      anon,
    );
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe("b");
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["r"]);
  });

  it("disappears when nothing is under it, for readers and moderators alike", () => {
    const rows = [blank("b"), comment({ id: "kept", createdAt: 2_000 })];
    expect(buildThreads(rows, anon).map((t) => t.root.id)).toEqual(["kept"]);
    expect(
      buildThreads(rows, { userId: "mod", isModerator: true }).map((t) => t.root.id),
    ).toEqual(["kept"]);
  });

  it("is dropped as a reply", () => {
    const threads = buildThreads(
      [
        comment({ id: "root" }),
        blank("b-reply", { parentId: "root", createdAt: 2_000 }),
        comment({ id: "reply", parentId: "root", createdAt: 3_000 }),
      ],
      anon,
    );
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["reply"]);
  });

  it("does not stay for replies a reader cannot see", () => {
    const threads = buildThreads(
      [
        blank("b"),
        comment({
          id: "r",
          parentId: "b",
          status: "removed",
          body: "",
          createdAt: 2_000,
        }),
      ],
      anon,
    );
    expect(threads).toEqual([]);
  });
});
