import {
  parseActivity,
  parseHiddenRemoved,
  parseQueue,
  parseReportedPosts,
  parseReportedProfiles,
  parseRoleHolders,
} from "../transport";
import { GRANTABLE_RANKS } from "../types";

describe("admin parsers", () => {
  it("reads the review queue and drops malformed rows", () => {
    const rows = parseQueue([
      {
        comment_id: "c1",
        event_id: "e1",
        hub_id: "bml202610aa",
        author_id: "u1",
        author_name: "Dilan",
        body: "hello",
        status: "pending",
        flag_count: 0,
        created_at: "2026-10-07T10:00:00Z",
      },
      { comment_id: "c2", status: "removed" },
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "c1", hubId: "bml202610aa", status: "pending" });
  });

  it("reads role holders and ignores unknown ranks", () => {
    const rows = parseRoleHolders([
      {
        holder_id: "u1",
        username: "dilan",
        display_name: "Dilan",
        role: "professor",
        org_name: null,
        granted_at: "2026-10-07T10:00:00Z",
        granted_by_name: "Bumelerze team",
        note: "checked by email",
      },
      { holder_id: "u2", role: "wizard", granted_at: "2026-10-07T10:00:00Z" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "professor", grantedByName: "Bumelerze team" });
  });

  it("reads reported profiles", () => {
    expect(
      parseReportedProfiles([
        {
          reported_id: "u1",
          username: "x",
          display_name: "X",
          report_count: 3,
          last_reason: "spam",
          last_note: "copies my name",
        },
        {
          reported_id: "u2",
          username: null,
          display_name: null,
          report_count: 1,
          last_reason: "abuse",
        },
      ]),
    ).toEqual([
      {
        userId: "u1",
        username: "x",
        displayName: "X",
        reportCount: 3,
        lastReason: "spam",
        lastNote: "copies my name",
      },
      {
        userId: "u2",
        username: null,
        displayName: null,
        reportCount: 1,
        lastReason: "abuse",
        lastNote: null,
      },
    ]);
  });

  it("never offers the official rank for granting", () => {
    expect(GRANTABLE_RANKS).not.toContain("official");
    expect(GRANTABLE_RANKS).toEqual([
      "moderator",
      "seismologist",
      "professor",
      "researcher",
      "engineer",
      "partner",
    ]);
  });
});

describe("parseReportedPosts", () => {
  it("reads the reported-post queue and drops malformed rows", () => {
    const rows = parseReportedPosts([
      {
        post_id: "p1",
        author_id: "u1",
        username: "dilan",
        display_name: "Dilan",
        body: "buy now",
        report_count: "3",
        last_reason: "spam",
        last_note: "ad for a shop",
        last_reported_at: "2026-10-08T10:00:00Z",
        created_at: "2026-10-08T09:00:00Z",
      },
      { post_id: "p2" },
      null,
    ]);
    expect(rows).toEqual([
      {
        postId: "p1",
        authorId: "u1",
        username: "dilan",
        displayName: "Dilan",
        body: "buy now",
        reportCount: 3,
        lastReason: "spam",
        lastNote: "ad for a shop",
      },
    ]);
  });

  it("is empty for an answer that is not a list", () => {
    expect(parseReportedPosts(undefined)).toEqual([]);
  });
});

describe("parseActivity", () => {
  const row = {
    log_id: "l1",
    created_at: "2026-10-08T10:00:00.123456+00:00",
    action: "comment_hide",
    actor_id: "a1",
    actor_name: "Mona",
    actor_username: "mona",
    actor_rank: "moderator",
    target_type: "comment",
    target_id: "c1",
    target_user_id: "u1",
    target_name: "Dilan",
    target_username: "dilan",
    target_summary: "bml202610aa",
    reason: "spam",
    note: null,
    reverted_by: null,
  };

  it("reads a log row, keeping the raw timestamp as the paging cursor", () => {
    const [entry] = parseActivity([row]);
    expect(entry).toMatchObject({
      id: "l1",
      cursor: "2026-10-08T10:00:00.123456+00:00",
      action: "comment_hide",
      actorRank: "moderator",
      targetSummary: "bml202610aa",
      reason: "spam",
      revertedBy: null,
    });
    expect(entry?.createdAt).toBe(Date.parse("2026-10-08T10:00:00.123Z"));
  });

  it("accepts a system row (no actor) and an action a newer server adds", () => {
    const [entry] = parseActivity([
      { ...row, actor_id: null, actor_name: null, actor_rank: null, action: "future_x" },
    ]);
    expect(entry).toMatchObject({ actorId: null, actorRank: null, action: "future_x" });
  });

  it("drops malformed rows and answers [] for a non-list", () => {
    expect(
      parseActivity([row, { log_id: "x" }, { ...row, created_at: "nope" }, 7]),
    ).toHaveLength(1);
    expect(parseActivity(null)).toEqual([]);
  });
});

describe("parseHiddenRemoved", () => {
  const row = {
    kind: "comment",
    item_id: "c1",
    status: "removed",
    acted_at: "2026-10-08T09:00:00.123456+00:00",
    actor_name: "Bumelerze",
    reason: "spam",
    author_id: "u1",
    author_name: "Dilan",
    author_username: "dilan",
    hub_id: "bml202610aa",
    place: "Duhok",
    body: "the evidence",
    can_restore: true,
  };

  it("reads a row and keeps the raw timestamp as the paging cursor", () => {
    const [item] = parseHiddenRemoved([row]);
    expect(item).toMatchObject({
      kind: "comment",
      id: "c1",
      status: "removed",
      cursor: "2026-10-08T09:00:00.123456+00:00",
      hubId: "bml202610aa",
      body: "the evidence",
      canRestore: true,
    });
    expect(item?.actedAt).toBe(Date.parse("2026-10-08T09:00:00.123Z"));
  });

  it("keeps a missing text as null (the viewer may not read it) and treats an unknown flag as no", () => {
    const [item] = parseHiddenRemoved([
      { ...row, kind: "post", body: null, can_restore: "yes", hub_id: null, place: null },
    ]);
    expect(item).toMatchObject({ kind: "post", body: null, canRestore: false });
  });

  it("drops malformed rows, unknown kinds and statuses, and answers [] for a non-list", () => {
    expect(
      parseHiddenRemoved([
        row,
        { ...row, kind: "photo" },
        { ...row, status: "visible" },
        { ...row, acted_at: "nope" },
        7,
      ]),
    ).toHaveLength(1);
    expect(parseHiddenRemoved(null)).toEqual([]);
  });
});

describe("SupabaseAdminTransport (migration 0053)", () => {
  it("asks for the hidden and removed list with the cursor, and undoes through the dispatcher", async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    jest.doMock("@/lib/supabase", () => ({
      getSupabaseClient: () => ({ rpc }),
    }));
    const { SupabaseAdminTransport } = await import("../transport");
    await SupabaseAdminTransport.fetchHiddenRemoved("2026-10-08T09:00:00.000001+00:00");
    await SupabaseAdminTransport.fetchHiddenRemoved(null);
    await SupabaseAdminTransport.undoAction("log-1");
    expect(rpc.mock.calls).toEqual([
      [
        "admin_hidden_removed",
        { p_before: "2026-10-08T09:00:00.000001+00:00", p_limit: 50 },
      ],
      ["admin_hidden_removed", { p_before: null, p_limit: 50 }],
      ["admin_undo_action", { p_log_id: "log-1", p_note: null }],
    ]);
    jest.dontMock("@/lib/supabase");
  });
});
