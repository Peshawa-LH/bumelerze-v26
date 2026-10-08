import { CommunityError } from "@/features/community/types";
import {
  SupabasePeopleTransport,
  filtersToJson,
  parseNotes,
  parsePeoplePage,
  parsePeopleStats,
  parsePersonDetail,
  parsePersonFlags,
  parsePersonRow,
} from "../transport";
import { NO_FILTERS } from "../types";

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ rpc: (name: string, args: unknown) => mockRpc(name, args) }),
}));

const rawRow = {
  user_id: "u1",
  kind: "account",
  username: "aso",
  display_name: "Aso",
  avatar_path: null,
  ranks: ["moderator", "bogus"],
  status: "restricted",
  joined: "2026-09-01T10:00:00+01:00",
  last_seen: "2026-10-01T10:00:00+01:00",
  platform: "android",
  open_reports: 2,
  masked_email: "a***@x.org",
  counts: { felt_reports: 3, comments: "4", posts: 1, homes_owned: 1, homes_member: 2, feedback: 0 },
};

describe("parsePersonRow", () => {
  it("maps a row, keeps known ranks only and reads numbers sent as text", () => {
    const row = parsePersonRow(rawRow);
    expect(row).toMatchObject({
      userId: "u1",
      kind: "account",
      username: "aso",
      ranks: ["moderator"],
      status: "restricted",
      platform: "android",
      openReports: 2,
      maskedEmail: "a***@x.org",
    });
    expect(row?.counts).toEqual({
      feltReports: 3,
      comments: 4,
      posts: 1,
      homesOwned: 1,
      homesMember: 2,
      feedback: 0,
    });
    expect(row?.joined).toBe(Date.parse("2026-09-01T10:00:00+01:00"));
  });

  it("has no email for a moderator's row, and falls back to safe values", () => {
    const row = parsePersonRow({ user_id: "g1", kind: "guest", status: "weird", platform: "symbian" });
    expect(row).toMatchObject({
      kind: "guest",
      status: "active",
      platform: null,
      maskedEmail: null,
      username: null,
      openReports: 0,
    });
    expect(parsePersonRow({ kind: "account" })).toBeNull();
    expect(parsePersonRow(null)).toBeNull();
  });
});

describe("parsePeoplePage", () => {
  it("reads rows, the cursor and the idle guest count", () => {
    const page = parsePeoplePage({
      rows: [rawRow, { nope: 1 }],
      next_cursor: { k: "123.5", id: "u1" },
      idle_guests: 7,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toEqual({ k: "123.5", id: "u1" });
    expect(page.idleGuests).toBe(7);
  });

  it("treats a missing cursor and a null idle count as none", () => {
    const page = parsePeoplePage({ rows: [], next_cursor: null, idle_guests: null });
    expect(page).toEqual({ rows: [], nextCursor: null, idleGuests: null });
    expect(parsePeoplePage("garbage")).toEqual({ rows: [], nextCursor: null, idleGuests: null });
  });
});

describe("parsePeopleStats", () => {
  const raw = {
    accounts_total: 21,
    guests_total: null,
    new_accounts_7d: 3,
    new_accounts_30d: 9,
    active_accounts_7d: 2,
    active_accounts_30d: 4,
    active_guests_7d: null,
    active_guests_30d: null,
    presence_since: "2026-10-09T10:00:00Z",
    restricted: 1,
    suspended: 0,
    platforms: { ios: 1, android: 2, web: 3 },
  };
  it("keeps guest numbers null for a moderator", () => {
    const s = parsePeopleStats(raw);
    expect(s.guestsTotal).toBeNull();
    expect(s.activeGuests7d).toBeNull();
    expect(s.accountsTotal).toBe(21);
    expect(s.platforms).toEqual({ ios: 1, android: 2, web: 3 });
    expect(s.presenceSince).toBe(Date.parse("2026-10-09T10:00:00Z"));
  });
  it("reads guest numbers for an official and a missing presence date as null", () => {
    const s = parsePeopleStats({ ...raw, guests_total: 5, active_guests_7d: 1, presence_since: null });
    expect(s.guestsTotal).toBe(5);
    expect(s.activeGuests7d).toBe(1);
    expect(s.presenceSince).toBeNull();
  });
  it("throws on nonsense", () => {
    expect(() => parsePeopleStats("x")).toThrow(CommunityError);
  });
});

describe("parsePersonDetail", () => {
  const raw = {
    identity: {
      user_id: "u1",
      kind: "guest",
      username: null,
      display_name: null,
      ranks: [{ role: "official", org_name: null }, { role: "x" }],
      status: "suspended",
      joined: "2026-09-01T10:00:00Z",
      platform: "ios",
      has_password: true,
    },
    devices: [{ fingerprint: "1f2e3d4c", felt_reports: 2, feedback: 1, platform: "ios", first_seen: "2026-09-02T00:00:00Z", last_seen: "2026-09-03T00:00:00Z" }],
    same_device_users: [{ user_id: "u2", kind: "account", username: "bana", display_name: "Bana", fingerprint: "1f2e3d4c" }],
    counts: { felt_reports: 2, comments: 3, comments_visible: 1, notes: 2 },
    recent: {
      felt_reports: [{ report_id: "r1", created_at: "2026-09-02T00:00:00Z", event: "bml1", intensity: 5 }],
      comments: [{ comment_id: "c1", created_at: "2026-09-02T00:00:00Z", status: "removed", author_deleted: false, excerpt: null }],
      posts: [],
      feedback: [{ feedback_id: "f1", created_at: "2026-09-02T00:00:00Z", category: "bug", status: "unseen" }],
    },
    restrictions: [{ restriction_id: "x1", level: "restrict", reason: "spam", active: true, ends_at: "2026-10-20T00:00:00Z" }],
  };

  it("maps every section", () => {
    const d = parsePersonDetail(raw);
    expect(d.identity.kind).toBe("guest");
    expect(d.identity.status).toBe("suspended");
    expect(d.identity.ranks).toEqual([{ role: "official", orgName: null }]);
    expect(d.identity.hasPassword).toBe(true);
    expect(d.identity.maskedEmail).toBeNull();
    expect(d.devices[0]).toMatchObject({ fingerprint: "1f2e3d4c", feltReports: 2, platform: "ios" });
    expect(d.sameDeviceUsers[0]).toMatchObject({ userId: "u2", kind: "account" });
    expect(d.counts).toMatchObject({ feltReports: 2, comments: 3, commentsVisible: 1, notes: 2, posts: 0 });
    expect(d.recent.feltReports[0]).toMatchObject({ event: "bml1", intensity: 5 });
    expect(d.recent.comments[0]).toMatchObject({ status: "removed", excerpt: null });
    expect(d.restrictions[0]).toMatchObject({ restrictionId: "x1", level: "restrict", active: true });
  });

  it("returns only the fields the server was allowed to send (nothing like a location can be invented)", () => {
    const withExtras = parsePersonDetail({
      ...raw,
      identity: { ...raw.identity, lat: 36.1, device_id: "RAW-DEVICE", push_token: "tok" },
      recent: { ...raw.recent, felt_reports: [{ ...raw.recent.felt_reports[0], lat: 36.1, lon: 44.2 }] },
    });
    const text = JSON.stringify(withExtras);
    expect(text).not.toMatch(/RAW-DEVICE|tok|36\.1|44\.2|"lat"|"lon"/);
  });

  it("throws not_found when the server sends no identity", () => {
    expect(() => parsePersonDetail({})).toThrow(CommunityError);
  });
});

describe("parseNotes and filtersToJson", () => {
  it("reads notes", () => {
    expect(
      parseNotes([{ id: "n1", body: "hi", created_at: "2026-09-02T00:00:00Z", author_id: "m", author_name: "Mona" }, { x: 1 }]),
    ).toEqual([{ id: "n1", body: "hi", createdAt: Date.parse("2026-09-02T00:00:00Z"), authorId: "m", authorName: "Mona" }]);
  });

  it("sends only the filters that are set", () => {
    expect(filtersToJson(NO_FILTERS)).toEqual({});
    expect(
      filtersToJson({
        rank: "any",
        status: "restricted",
        reported: true,
        joinedFrom: "2026-09-01T00:00:00.000Z",
        joinedTo: "2026-09-30T00:00:00.000Z",
        activeDays: 7,
        platform: "web",
        hasPassword: false,
      }),
    ).toEqual({
      rank: "any",
      status: "restricted",
      reported: true,
      joined_from: "2026-09-01T00:00:00.000Z",
      joined_to: "2026-09-30T00:00:00.000Z",
      active_days: 7,
      platform: "web",
      has_password: false,
    });
  });
});

describe("SupabasePeopleTransport", () => {
  beforeEach(() => mockRpc.mockReset());

  it("searches with the documented arguments and a null query when empty", async () => {
    mockRpc.mockResolvedValue({ data: { rows: [], next_cursor: null, idle_guests: null }, error: null });
    await SupabasePeopleTransport.search(
      { query: "  ", tab: "all", filters: { ...NO_FILTERS, reported: true }, sort: "open_reports" },
      { k: "1", id: "u9" },
    );
    expect(mockRpc).toHaveBeenCalledWith("admin_people_search", {
      p_query: null,
      p_kind: "all",
      p_filters: { reported: true },
      p_sort: "open_reports",
      p_cursor: { k: "1", id: "u9" },
      p_limit: 50,
    });
  });

  it("calls the person, reveal, reset and note functions", async () => {
    mockRpc.mockResolvedValue({ data: "aso@x.org", error: null });
    expect(await SupabasePeopleTransport.revealEmail("u1")).toBe("aso@x.org");
    expect(mockRpc).toHaveBeenLastCalledWith("admin_reveal_email", { p_user_id: "u1" });
    mockRpc.mockResolvedValue({ data: "log-1", error: null });
    expect(await SupabasePeopleTransport.resetProfile("u1", ["avatar"])).toBe("log-1");
    expect(mockRpc).toHaveBeenLastCalledWith("admin_reset_profile_fields", { p_user_id: "u1", p_fields: ["avatar"] });
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await SupabasePeopleTransport.resetProfile("u1", ["avatar"])).toBeNull();
    await SupabasePeopleTransport.addNote("u1", "hello");
    expect(mockRpc).toHaveBeenLastCalledWith("admin_add_person_note", { p_user_id: "u1", p_body: "hello" });
  });

  it("turns server errors into community errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "admin_person: not_found", code: "P0002" } });
    await expect(SupabasePeopleTransport.person("u1")).rejects.toMatchObject({ code: "not_found" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "admin_people_stats: not_allowed", code: "42501" } });
    await expect(SupabasePeopleTransport.stats()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("person flags (migration 0060)", () => {
  it("reads the private admin rank and the protection", () => {
    expect(parsePersonFlags({ admin_rank: true, protected: true, resets_passwords: true })).toEqual({
      privateAdmin: true,
      protected: true,
      resetsPasswords: true,
    });
    expect(parsePersonFlags(null)).toBeNull();
  });

  it("fetches the flags with the person, and falls back to none on an older server", async () => {
    const raw = {
      identity: { user_id: "u1", kind: "account", ranks: [], status: "active" },
    };
    mockRpc.mockImplementation(async (name: string) =>
      name === "admin_person"
        ? { data: raw, error: null }
        : { data: { admin_rank: true, protected: true, resets_passwords: false }, error: null },
    );
    const withFlags = await SupabasePeopleTransport.person("u1");
    expect(mockRpc).toHaveBeenCalledWith("admin_person_flags", { p_user_id: "u1" });
    expect(withFlags.flags).toEqual({ privateAdmin: true, protected: true, resetsPasswords: false });
    mockRpc.mockImplementation(async (name: string) =>
      name === "admin_person"
        ? { data: raw, error: null }
        : { data: null, error: { code: "PGRST202", message: "missing" } },
    );
    expect((await SupabasePeopleTransport.person("u1")).flags).toBeNull();
    mockRpc.mockReset();
  });
});
