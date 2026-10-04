import {
  SupabaseEventHubTransport,
  parseCommentRows,
  parseSummary,
  toHubError,
} from "../transport";
import { HubError } from "../types";

/**
 * `SupabaseEventHubTransport` against a fake Supabase client: no network.
 * `@/lib/supabase` is mocked at its seam, like the felt-map transport tests.
 */

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };

interface Recorded {
  table: string;
  calls: [string, unknown[]][];
}

let tableResults: Record<string, Result> = {};
let recorded: Recorded[] = [];
const mockRpc = jest.fn<Promise<Result>, [string, Record<string, unknown>]>();
const mockGetSession = jest.fn();
const mockSignInAnonymously = jest.fn();

/** A chainable, awaitable stand-in for a PostgREST query builder. */
function makeBuilder(table: string) {
  const entry: Recorded = { table, calls: [] };
  recorded.push(entry);
  const result = tableResults[table] ?? { data: [], error: null };
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          entry.calls.push([prop, args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

const mockClient = {
  from: (table: string) => makeBuilder(table),
  rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  auth: { getSession: () => mockGetSession() },
};

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: () => mockSignInAnonymously(),
}));

function callsOf(table: string): [string, unknown[]][] {
  return recorded.filter((r) => r.table === table).flatMap((r) => r.calls);
}

beforeEach(() => {
  tableResults = {};
  recorded = [];
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  mockSignInAnonymously.mockReset();
  mockSignInAnonymously.mockResolvedValue(undefined);
});

const COMMENT_ROW = {
  comment_id: "c1",
  event_id: "e1",
  parent_id: null,
  user_id: "u1",
  body: "Felt it strongly",
  area_geohash: "sx7ce",
  status: "visible",
  helpful_count: 2,
  reply_count: 1,
  created_at: "2026-10-04T10:00:00.000Z",
};

describe("parsers", () => {
  it("camel-cases a comment row and drops malformed rows", () => {
    const parsed = parseCommentRows([
      COMMENT_ROW,
      { ...COMMENT_ROW, comment_id: "bad", status: "weird" },
      { ...COMMENT_ROW, comment_id: "bad-date", created_at: "not a date" },
      null,
    ]);
    expect(parsed).toEqual([
      {
        id: "c1",
        eventId: "e1",
        parentId: null,
        userId: "u1",
        body: "Felt it strongly",
        areaGeohash: "sx7ce",
        status: "visible",
        helpfulCount: 2,
        replyCount: 1,
        createdAt: Date.parse("2026-10-04T10:00:00.000Z"),
      },
    ]);
  });

  it("returns [] for a non-array body", () => {
    expect(parseCommentRows(null)).toEqual([]);
  });

  it("parses the summary jsonb", () => {
    expect(
      parseSummary({
        reports: 12,
        people: 9,
        levels: { "3": 4, "5": 8, "0": 2, "13": 1 },
        first_report_at: "2026-10-04T10:00:00Z",
        comments: 3,
      }),
    ).toEqual({
      reports: 12,
      people: 9,
      levels: { 3: 4, 5: 8 },
      firstReportAt: Date.parse("2026-10-04T10:00:00Z"),
      comments: 3,
    });
  });

  it("parses an empty event summary", () => {
    expect(
      parseSummary({ reports: 0, people: 0, levels: {}, first_report_at: null, comments: 0 }),
    ).toEqual({ reports: 0, people: 0, levels: {}, firstReportAt: null, comments: 0 });
  });

  it("rejects a summary that is not that shape", () => {
    expect(parseSummary("nope")).toBeNull();
  });
});

describe("toHubError", () => {
  it("maps the rate-limit trigger (54000) to rate_limited", () => {
    expect(toHubError({ code: "54000", message: "too many comments" }).code).toBe("rate_limited");
  });
  it("maps fetch failures to network", () => {
    expect(toHubError(new Error("Failed to fetch")).code).toBe("network");
  });
  it("maps anything else to unknown and keeps a HubError as is", () => {
    expect(toHubError({ code: "42501" }).code).toBe("unknown");
    const original = new HubError("not_signed_in");
    expect(toHubError(original)).toBe(original);
  });
});

describe("reads", () => {
  it("calls event_hub_summary with the event uuid", async () => {
    mockRpc.mockResolvedValue({
      data: { reports: 3, people: 3, levels: { "4": 3 }, first_report_at: null, comments: 0 },
      error: null,
    });
    const summary = await SupabaseEventHubTransport.fetchSummary("event-uuid");
    expect(mockRpc).toHaveBeenCalledWith("event_hub_summary", { p_event_id: "event-uuid" });
    expect(summary?.levels).toEqual({ 4: 3 });
  });

  it("throws a HubError when the summary rpc fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(SupabaseEventHubTransport.fetchSummary("e")).rejects.toBeInstanceOf(HubError);
  });

  it("reads the event's comments newest first", async () => {
    tableResults.event_comments = { data: [COMMENT_ROW], error: null };
    const comments = await SupabaseEventHubTransport.fetchComments("event-uuid");
    expect(comments).toHaveLength(1);
    const calls = callsOf("event_comments");
    expect(calls).toContainEqual(["eq", ["event_id", "event-uuid"]]);
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
  });

  it("maps profiles by user id and chunks long id lists", async () => {
    tableResults.profiles = {
      data: [{ user_id: "u1", display_name: "Awat", avatar_path: "u1/a.jpg" }],
      error: null,
    };
    const ids = Array.from({ length: 130 }, (_, i) => `u${i}`);
    const authors = await SupabaseEventHubTransport.fetchAuthors(ids);
    expect(authors.u1).toEqual({ userId: "u1", displayName: "Awat", avatarPath: "u1/a.jpg" });
    // 130 ids at 60 per request = 3 requests.
    expect(recorded.filter((r) => r.table === "profiles")).toHaveLength(3);
  });

  it("maps roles and ignores unknown ones", async () => {
    tableResults.user_roles = {
      data: [
        { user_id: "u1", role: "partner", org_name: "KRG Civil Defence" },
        { user_id: "u1", role: "wizard", org_name: null },
        { user_id: "u2", role: "moderator", org_name: null },
      ],
      error: null,
    };
    const roles = await SupabaseEventHubTransport.fetchRoles(["u1", "u2"]);
    expect(roles.u1).toEqual([{ role: "partner", orgName: "KRG Civil Defence" }]);
    expect(roles.u2).toEqual([{ role: "moderator", orgName: null }]);
  });

  it("reads the caller's helpful marks", async () => {
    tableResults.comment_reactions = { data: [{ comment_id: "c1" }], error: null };
    await expect(SupabaseEventHubTransport.fetchMyHelpful(["c1", "c2"])).resolves.toEqual(["c1"]);
  });
});

describe("writes", () => {
  it("posts a comment as the signed-in user, sending only the four client columns", async () => {
    await SupabaseEventHubTransport.postComment({
      eventUuid: "event-uuid",
      parentId: "root-1",
      body: "Hello",
    });
    expect(mockSignInAnonymously).toHaveBeenCalled();
    expect(callsOf("event_comments")).toContainEqual([
      "insert",
      [{ event_id: "event-uuid", parent_id: "root-1", user_id: "user-1", body: "Hello" }],
    ]);
  });

  it("surfaces the rate limit as a HubError with code rate_limited", async () => {
    tableResults.event_comments = {
      error: { code: "54000", message: "too many comments, try again in a few minutes" },
    };
    await expect(
      SupabaseEventHubTransport.postComment({ eventUuid: "e", parentId: null, body: "x" }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("fails with not_signed_in when there is no session even after the anonymous sign-in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(
      SupabaseEventHubTransport.postComment({ eventUuid: "e", parentId: null, body: "x" }),
    ).rejects.toMatchObject({ code: "not_signed_in" });
  });

  it("marks and unmarks helpful", async () => {
    await SupabaseEventHubTransport.setHelpful("c1", true);
    expect(callsOf("comment_reactions")).toContainEqual([
      "insert",
      [{ comment_id: "c1", user_id: "user-1", kind: "helpful" }],
    ]);
    recorded = [];
    await SupabaseEventHubTransport.setHelpful("c1", false);
    const calls = callsOf("comment_reactions");
    expect(calls.map(([name]) => name)).toContain("delete");
    expect(calls).toContainEqual(["eq", ["comment_id", "c1"]]);
    expect(calls).toContainEqual(["eq", ["user_id", "user-1"]]);
  });

  it("treats a duplicate helpful mark as success", async () => {
    tableResults.comment_reactions = { error: { code: "23505" } };
    await expect(SupabaseEventHubTransport.setHelpful("c1", true)).resolves.toBeUndefined();
  });

  it("flags a comment with a reason", async () => {
    await SupabaseEventHubTransport.flagComment("c1", "spam");
    expect(callsOf("comment_flags")).toContainEqual([
      "insert",
      [{ comment_id: "c1", user_id: "user-1", reason: "spam" }],
    ]);
  });

  it("deletes through delete_my_comment and moderates through moderate_comment", async () => {
    await SupabaseEventHubTransport.deleteComment("c1");
    expect(mockRpc).toHaveBeenCalledWith("delete_my_comment", { p_comment_id: "c1" });

    await SupabaseEventHubTransport.moderateComment("c2", "approve");
    expect(mockRpc).toHaveBeenCalledWith("moderate_comment", {
      p_comment_id: "c2",
      p_action: "approve",
      p_reason: null,
    });
    await SupabaseEventHubTransport.moderateComment("c2", "hide", "spam");
    expect(mockRpc).toHaveBeenLastCalledWith("moderate_comment", {
      p_comment_id: "c2",
      p_action: "hide",
      p_reason: "spam",
    });
  });

  it("raises when a moderation call is refused", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "moderators only" } });
    await expect(SupabaseEventHubTransport.moderateComment("c", "hide")).rejects.toBeInstanceOf(
      HubError,
    );
  });
});
