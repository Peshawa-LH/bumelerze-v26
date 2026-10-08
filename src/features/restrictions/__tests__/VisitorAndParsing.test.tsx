import { cleanup, screen } from "@testing-library/react-native";

import { PublicProfileView } from "@/features/community/components/PublicProfileView";
import { parsePublicProfile, toCommunityError } from "@/features/community/transport";
import type { CommunityActions } from "@/features/community/queries";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { toHubError } from "@/features/eventhub/transport";
import i18n from "@/i18n";

import { parseAdminRestrictions, parseMyRestriction } from "../transport";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));

const SUSPENDED_PAYLOAD = {
  user_id: "u1",
  username: "dilan.k",
  display_name: null,
  avatar_path: null,
  is_private: false,
  roles: [],
  is_self: false,
  follow_status: "none",
  is_blocked: false,
  can_view_full: false,
  suspended: true,
};

const actions = {} as CommunityActions;

describe("a suspended account, seen by a visitor", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("parses to a profile with the flag, the @username as its name and no details", () => {
    const profile = parsePublicProfile(SUSPENDED_PAYLOAD);
    expect(profile).toMatchObject({
      username: "dilan.k",
      displayName: "dilan.k",
      suspended: true,
      canViewFull: false,
      details: null,
    });
  });

  it("an ordinary profile is not suspended", () => {
    expect(
      parsePublicProfile({
        ...SUSPENDED_PAYLOAD,
        display_name: "Dilan",
        suspended: false,
      }),
    ).toMatchObject({ suspended: false });
    // a server from before the migration has no flag at all
    const { suspended: _omit, ...old } = { ...SUSPENDED_PAYLOAD, display_name: "Dilan" };
    expect(parsePublicProfile(old)).toMatchObject({ suspended: false });
  });

  it("shows 'This account is suspended' instead of any content, follow button or counts", async () => {
    const profile = parsePublicProfile(SUSPENDED_PAYLOAD);
    if (!profile) {
      throw new Error("profile should parse");
    }
    await renderWithProviders(<PublicProfileView profile={profile} actions={actions} />);
    expect(screen.getByTestId("public-profile-suspended")).toBeTruthy();
    expect(screen.getByTestId("public-profile-username")).toHaveTextContent(/@dilan\.k/);
    expect(screen.getByTestId("public-profile-suspended-note")).toHaveTextContent(
      "This account is suspended",
    );
    expect(screen.queryByTestId("public-profile")).toBeNull();
    expect(screen.queryByTestId("profile-counts")).toBeNull();
    expect(screen.queryByTestId("posts-section")).toBeNull();
    expect(screen.queryByTestId("public-profile-block")).toBeNull();
    expect(screen.queryByText(/Follow/)).toBeNull();
  });

  it("reads in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    const profile = parsePublicProfile(SUSPENDED_PAYLOAD);
    if (!profile) {
      throw new Error("profile should parse");
    }
    await renderWithProviders(<PublicProfileView profile={profile} actions={actions} />);
    expect(screen.getByTestId("public-profile-suspended-note")).toHaveTextContent(
      "ئەم هەژمارە ڕاگیراوە",
    );
  });

  it("the person themself still gets their full page", async () => {
    const profile = parsePublicProfile({
      ...SUSPENDED_PAYLOAD,
      display_name: "Dilan Ahmed",
      is_self: true,
      can_view_full: true,
      member_since: "2026-01-02T10:00:00Z",
      followers: 0,
      following: 0,
      comments: 0,
      helpful_received: 0,
      posts_count: 0,
      badges_hidden: true,
      milestones: null,
      recent_comments: [],
    });
    if (!profile) {
      throw new Error("profile should parse");
    }
    expect(profile.suspended).toBe(true);
    await renderWithProviders(<PublicProfileView profile={profile} actions={actions} />);
    expect(screen.getByTestId("public-profile")).toBeTruthy();
    expect(screen.queryByTestId("public-profile-suspended")).toBeNull();
  });
});

describe("error words from migration 0054", () => {
  it("maps the SQL tokens to community errors", () => {
    const code = (message: string) => toCommunityError({ message, code: "42501" }).code;
    expect(code("event_comments: account_restricted")).toBe("restricted");
    expect(code("follow_user: account_restricted")).toBe("restricted");
    expect(code("admin_restrict_account: protected_account")).toBe("protected_account");
    expect(code("admin_restrict_account: self_restriction")).toBe("protected_account");
    expect(code("admin_restrict_account: ends_required")).toBe("bad_end_date");
    expect(code("admin_restrict_account: ends_too_long")).toBe("bad_end_date");
    expect(code("admin_restrict_account: ends_invalid")).toBe("bad_end_date");
    expect(code("admin_restrict_account: reason_required")).toBe("reason_required");
    // the old meanings are untouched
    expect(code("follow_user: blocked")).toBe("blocked");
    expect(code("something else")).toBe("forbidden");
  });

  it("maps the same token to a hub error", () => {
    expect(
      toHubError({ message: "event_comments: account_restricted", code: "42501" }).code,
    ).toBe("restricted");
    expect(toHubError({ message: "comment_flags: flag_limit", code: "54000" }).code).toBe(
      "flag_limit",
    );
  });
});

describe("restriction rows from the server", () => {
  it("parses my_restriction() and ignores a malformed row", () => {
    const row = {
      restriction_id: "r1",
      level: "suspend",
      reason: "rumour",
      starts_at: "2026-10-08T10:00:00Z",
      ends_at: null,
      appeal_requested_at: "2026-10-08T11:00:00Z",
    };
    expect(parseMyRestriction([row])).toEqual({
      id: "r1",
      level: "suspend",
      reason: "rumour",
      startsAt: Date.parse("2026-10-08T10:00:00Z"),
      endsAt: null,
      appealRequestedAt: Date.parse("2026-10-08T11:00:00Z"),
    });
    expect(parseMyRestriction([])).toBeNull();
    expect(parseMyRestriction(null)).toBeNull();
    expect(parseMyRestriction([{ ...row, level: "ban" }])).toBeNull();
  });

  it("parses admin_account_restrictions() and drops rows it cannot read", () => {
    const good = {
      restriction_id: "r1",
      user_id: "u1",
      user_name: "Dilan",
      user_username: "dilan.k",
      is_guest: false,
      level: "restrict",
      reason: "spam",
      note: "n",
      starts_at: "2026-10-08T10:00:00Z",
      ends_at: "2026-10-09T10:00:00Z",
      created_at: "2026-10-08T10:00:00Z",
      created_by_name: "Mona",
      lifted_at: null,
      lifted_by_name: null,
      appeal_requested_at: null,
      active: true,
    };
    const rows = parseAdminRestrictions([
      good,
      { ...good, level: "ban" },
      { nonsense: true },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "r1",
      note: "n",
      active: true,
      createdByName: "Mona",
    });
  });
});
