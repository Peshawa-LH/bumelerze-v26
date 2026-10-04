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
    expect(isCommentShown(pending, { userId: "someone", isModerator: false })).toBe(false);
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
