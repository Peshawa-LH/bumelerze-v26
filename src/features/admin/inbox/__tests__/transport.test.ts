import i18n from "@/i18n";

import { guessRequestedRank } from "../rank-guess";
import {
  normalizeSearch,
  parseFeedbackDetail,
  parseFeedbackRows,
  parseInboxCounts,
  SupabaseInboxTransport,
} from "../transport";

const mockRpc = jest.fn();
const mockSign = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (p: string[], s: number) => mockSign(bucket, p, s),
      }),
    },
  }),
}));

const ROW = {
  feedback_id: "f1",
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
  status: "unseen",
  category: "badge_request",
  preview: "Badge request: Seismologist",
  platform: "android",
  app_version: "1.2.3",
  locale: "ckb",
  user_id: "u1",
  display_name: "Aso",
  username: "aso",
  photo_count: 2,
  has_note: false,
};

describe("feedback inbox parsers", () => {
  it("parses list rows and drops broken ones", () => {
    const rows = parseFeedbackRows([
      ROW,
      { feedback_id: "x" },
      { ...ROW, feedback_id: "f2", status: "weird", category: "unknown" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "f1",
      cursor: "2026-10-09T10:00:00Z",
      status: "unseen",
      category: "badge_request",
      photoCount: 2,
      username: "aso",
    });
    // an unknown status reads as new, an unknown category as none
    expect(rows[1]).toMatchObject({ status: "unseen", category: null });
    expect(parseFeedbackRows(null)).toEqual([]);
  });

  it("parses the detail with person, photos and the appeal's restriction", () => {
    const d = parseFeedbackDetail({
      ...ROW,
      category: "appeal",
      message: "Please look again",
      contact: "aso@example.org",
      triage_note: null,
      person: {
        user_id: "u1",
        is_account: true,
        display_name: "Aso",
        username: "aso",
        ranks: ["engineer", "admin", "nonsense"],
      },
      photos: [{ photo_id: "p1", storage_path: "u1/f1/p1.jpg" }],
      restriction: {
        restriction_id: "r1",
        level: "restrict",
        reason: "spam",
        ends_at: "2026-10-12T00:00:00Z",
        lifted_at: null,
        active: true,
      },
    });
    expect(d.person).toEqual({
      userId: "u1",
      isAccount: true,
      displayName: "Aso",
      username: "aso",
      ranks: ["engineer"],
    });
    expect(d.photos).toEqual([{ id: "p1", storagePath: "u1/f1/p1.jpg" }]);
    expect(d.restriction).toMatchObject({ id: "r1", level: "restrict", active: true });
    expect(d.contact).toBe("aso@example.org");
    expect(Object.keys(d)).not.toContain("deviceId");
  });

  it("throws not_found on a broken detail", () => {
    expect(() => parseFeedbackDetail({})).toThrow();
  });

  it("parses counts, with null for a part the viewer may not see", () => {
    expect(
      parseInboxCounts({
        feedback: {
          unseen: 3,
          in_review: 1,
          solved: 9,
          wont_do: 0,
          badge_requests_open: 2,
          appeals_open: 1,
        },
        photos_pending: 4,
      }),
    ).toEqual({
      feedback: {
        unseen: 3,
        inReview: 1,
        solved: 9,
        wontDo: 0,
        badgeRequestsOpen: 2,
        appealsOpen: 1,
      },
      photosPending: 4,
    });
    expect(parseInboxCounts({ feedback: null, photos_pending: 0 })).toEqual({
      feedback: null,
      photosPending: 0,
    });
  });

  it("trims and caps the search", () => {
    expect(normalizeSearch("  hello  ")).toBe("hello");
    expect(normalizeSearch("x".repeat(150))).toHaveLength(100);
  });
});

describe("guessRequestedRank", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("reads the prefilled rank in any of the four languages", () => {
    expect(
      guessRequestedRank("Badge request: Seismologist\nI work at the university"),
    ).toBe("seismologist");
    expect(guessRequestedRank("داواکاری نیشانە: ئەندازیار")).toBe("engineer");
    expect(guessRequestedRank("Daxwaza nîşanê: Lêkolîner")).toBe("researcher");
    expect(guessRequestedRank("طلب شارة: أستاذ")).toBe("professor");
  });

  it("takes the first rank named and returns null when none is", () => {
    expect(guessRequestedRank("Partner, or maybe engineer")).toBe("partner");
    expect(guessRequestedRank("Please give me something")).toBeNull();
    expect(guessRequestedRank("I want the Bumelerze official tick")).toBeNull();
  });
});

describe("SupabaseInboxTransport", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockSign.mockReset();
  });

  it("sends the filters and the keyset cursor", async () => {
    mockRpc.mockResolvedValue({ data: [ROW], error: null });
    const rows = await SupabaseInboxTransport.list(
      { status: "open", category: "badge_request", search: "  sara " },
      "2026-10-09T10:00:00Z",
    );
    expect(rows).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith("admin_feedback_list", {
      p_status: "open",
      p_category: "badge_request",
      p_search: "sara",
      p_before: "2026-10-09T10:00:00Z",
      p_limit: 50,
    });
  });

  it("sends no search for an empty box", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await SupabaseInboxTransport.list(
      { status: null, category: null, search: "   " },
      null,
    );
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_status: null,
      p_category: null,
      p_search: null,
    });
  });

  it("signs screenshots in the private bucket, for ten minutes", async () => {
    mockSign.mockResolvedValue({
      data: [
        { path: "a.jpg", signedUrl: "https://x/a" },
        { path: "b.jpg", signedUrl: null, error: "not found" },
      ],
      error: null,
    });
    const out = await SupabaseInboxTransport.signScreenshots(["a.jpg", "b.jpg"]);
    expect(mockSign).toHaveBeenCalledWith("feedback-photos", ["a.jpg", "b.jpg"], 600);
    expect(out).toEqual([{ path: "a.jpg", url: "https://x/a" }]);
    expect(await SupabaseInboxTransport.signScreenshots([])).toEqual([]);
  });

  it("maps a server refusal to a community error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "admin_feedback_list: not_allowed" },
    });
    await expect(
      SupabaseInboxTransport.list({ status: null, category: null, search: "" }, null),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("status, note and grant go to their RPCs", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await SupabaseInboxTransport.setStatus("f1", "solved", "done");
    await SupabaseInboxTransport.grantBadge("f1", "partner", "KRG");
    expect(mockRpc).toHaveBeenCalledWith("admin_feedback_set_status", {
      p_feedback_id: "f1",
      p_status: "solved",
      p_note: "done",
    });
    expect(mockRpc).toHaveBeenCalledWith("admin_feedback_grant_badge", {
      p_feedback_id: "f1",
      p_role: "partner",
      p_org_name: "KRG",
    });
  });
});
