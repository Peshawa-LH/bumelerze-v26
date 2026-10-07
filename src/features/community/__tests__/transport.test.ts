import {
  SupabaseCommunityTransport,
  parseFollowRequests,
  parsePersonRows,
  parsePublicProfile,
  toCommunityError,
} from "../transport";

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

const FULL = {
  user_id: "u1",
  username: "dilan.k",
  display_name: "Dilan",
  avatar_path: "u1/a.jpg",
  is_private: false,
  roles: [{ role: "professor", org_name: null }],
  is_self: false,
  follow_status: "none",
  is_blocked: false,
  can_view_full: true,
  member_since: "2026-01-02T10:00:00Z",
  followers: 4,
  following: 2,
  comments: 9,
  helpful_received: 12,
  badges_hidden: false,
  milestones: { reports: 3, detailed_reports: 1, photo_reports: 0 },
  recent_comments: [
    {
      comment_id: "c1",
      body: "Felt it",
      created_at: "2026-10-01T10:00:00Z",
      helpful_count: 2,
      hub_id: "bml202610aa",
      place: "Near Slemani",
      magnitude: 4.2,
    },
  ],
};

describe("parsePublicProfile", () => {
  it("reads the public-safe payload", () => {
    const profile = parsePublicProfile(FULL);
    expect(profile).toMatchObject({
      userId: "u1",
      username: "dilan.k",
      displayName: "Dilan",
      isPrivate: false,
      followStatus: "none",
      canViewFull: true,
      roles: [{ role: "professor", orgName: null }],
    });
    expect(profile?.details).toMatchObject({
      followers: 4,
      following: 2,
      comments: 9,
      helpfulReceived: 12,
      milestones: { reports: 3, detailedReports: 1, photoReports: 0 },
    });
    expect(profile?.details?.recentComments[0]).toMatchObject({
      id: "c1",
      hubId: "bml202610aa",
      magnitude: 4.2,
    });
  });

  it("drops every field it does not know, so a leaked private column cannot reach the UI", () => {
    const profile = parsePublicProfile({
      ...FULL,
      email: "dilan@example.com",
      profession: "engineer",
      latitude: 35.5,
      geohash_p5: "sx8dx",
      home_tags: ["BMH-AAAAAA"],
      device_id: "device-abc",
      research_consent_at: "2026-01-01",
      recent_comments: [
        { ...FULL.recent_comments[0], area_geohash: "sx8dx", user_email: "x@y.z" },
      ],
    });
    const text = JSON.stringify(profile);
    for (const secret of [
      "dilan@example.com",
      "engineer",
      "35.5",
      "sx8dx",
      "BMH-AAAAAA",
      "device-abc",
      "research_consent",
      "x@y.z",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("gives a viewer without full access no details, even if the payload carried some", () => {
    const profile = parsePublicProfile({
      ...FULL,
      is_private: true,
      can_view_full: false,
    });
    expect(profile?.canViewFull).toBe(false);
    expect(profile?.details).toBeNull();
  });

  it("shows nothing beyond the basics for a profile the viewer blocked", () => {
    const profile = parsePublicProfile({ ...FULL, is_blocked: true });
    expect(profile?.isBlocked).toBe(true);
    expect(profile?.canViewFull).toBe(false);
    expect(profile?.details).toBeNull();
  });

  it("drops the milestone counts when the owner hides their badges", () => {
    const profile = parsePublicProfile({ ...FULL, badges_hidden: true });
    expect(profile?.details?.badgesHidden).toBe(true);
    expect(profile?.details?.milestones).toBeNull();
  });

  it("returns null for a missing or malformed profile", () => {
    expect(parsePublicProfile(null)).toBeNull();
    expect(parsePublicProfile({ username: "x" })).toBeNull();
  });

  it("ignores unknown ranks and malformed comment rows", () => {
    const profile = parsePublicProfile({
      ...FULL,
      roles: [{ role: "wizard" }, { role: "engineer", org_name: null }],
      recent_comments: [{ nope: true }, FULL.recent_comments[0]],
    });
    expect(profile?.roles.map((r) => r.role)).toEqual(["engineer"]);
    expect(profile?.details?.recentComments).toHaveLength(1);
  });
});

describe("person lists", () => {
  it("maps rows to people with public fields only", () => {
    const people = parsePersonRows([
      {
        person_id: "u1",
        username: "dilan.k",
        display_name: "Dilan",
        avatar_path: null,
        roles: [],
        email: "secret@example.com",
      },
      { broken: true },
    ]);
    expect(people).toEqual([
      {
        userId: "u1",
        username: "dilan.k",
        displayName: "Dilan",
        avatarPath: null,
        roles: [],
      },
    ]);
  });

  it("carries the request time on follow requests", () => {
    const [request] = parseFollowRequests([
      {
        person_id: "u2",
        username: null,
        display_name: "Aso",
        requested_at: "2026-10-05T10:00:00Z",
      },
    ]);
    expect(request?.requestedAt).toBe(Date.parse("2026-10-05T10:00:00Z"));
    expect(request?.username).toBeNull();
  });
});

describe("toCommunityError", () => {
  it("maps the server's tokens and codes", () => {
    expect(toCommunityError({ message: "follow_user: not_account" }).code).toBe(
      "not_account",
    );
    expect(toCommunityError({ message: "follow_user: profile_required" }).code).toBe(
      "profile_required",
    );
    expect(toCommunityError({ message: "follow_user: blocked" }).code).toBe("blocked");
    expect(toCommunityError({ code: "54000", message: "x" }).code).toBe("rate_limited");
    expect(toCommunityError({ code: "PGRST202", message: "x" }).code).toBe("unavailable");
    expect(toCommunityError({ status: 0, message: "Failed to fetch" }).code).toBe(
      "network",
    );
    expect(toCommunityError({ message: "???" }).code).toBe("unknown");
  });
});

describe("SupabaseCommunityTransport", () => {
  beforeEach(() => mockRpc.mockReset());

  it("calls public_profile with the username", async () => {
    mockRpc.mockResolvedValueOnce({ data: FULL, error: null });
    const profile = await SupabaseCommunityTransport.fetchPublicProfile("dilan.k");
    expect(mockRpc).toHaveBeenCalledWith("public_profile", { p_username: "dilan.k" });
    expect(profile?.username).toBe("dilan.k");
  });

  it("throws 'unavailable' while the function is missing", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "x" },
    });
    await expect(
      SupabaseCommunityTransport.fetchPublicProfile("a"),
    ).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("follows, unfollows, accepts, declines, blocks, unblocks and reports through the RPCs", async () => {
    mockRpc.mockResolvedValue({ data: "pending", error: null });
    await expect(SupabaseCommunityTransport.follow("u1")).resolves.toBe("pending");
    mockRpc.mockResolvedValue({ data: "accepted", error: null });
    await expect(SupabaseCommunityTransport.follow("u1")).resolves.toBe("accepted");
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabaseCommunityTransport.unfollow("u1");
    await SupabaseCommunityTransport.acceptRequest("u2");
    await SupabaseCommunityTransport.declineRequest("u3");
    await SupabaseCommunityTransport.block("u4");
    await SupabaseCommunityTransport.unblock("u4");
    await SupabaseCommunityTransport.reportProfile("u5", "spam");
    expect(mockRpc.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["follow_user", { p_followee: "u1" }],
      ["follow_user", { p_followee: "u1" }],
      ["unfollow_user", { p_followee: "u1" }],
      ["accept_follow_request", { p_follower: "u2" }],
      ["decline_follow_request", { p_follower: "u3" }],
      ["block_user", { p_user: "u4" }],
      ["unblock_user", { p_user: "u4" }],
      ["report_profile", { p_user: "u5", p_reason: "spam" }],
    ]);
  });

  it("reads the username check as a boolean", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(
      SupabaseCommunityTransport.isUsernameAvailable("free.name"),
    ).resolves.toBe(true);
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(SupabaseCommunityTransport.isUsernameAvailable("taken")).resolves.toBe(
      false,
    );
  });
});
