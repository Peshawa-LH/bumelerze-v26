import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import ProfileScreen from "../../../../app/(tabs)/profile";
import PublicProfileScreen from "../../../../app/u/[username]/index";
import {
  clearQueryClients,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "@/features/building/__fixtures__/testing";
import { useFeltQueueStore } from "@/features/felt";
import type { UseAccountResult } from "@/features/account/use-account";
import type { Permission } from "@/features/eventhub/types";
import i18n from "@/i18n";

/**
 * D79: the Profile tab (the owner's own merged page), `/u/<someone>` (the
 * public view) and `/u/<me>` (the same merged own page). The key property: a
 * visitor's page mounts NONE of the owner-only sections and starts none of
 * their queries.
 */

const mockPush = jest.fn();
let mockUsername = "shilan";
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ username: mockUsername }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "test-device-uuid-abcdefgh" }));

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

let mockAccount: UseAccountResult;
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

const mockFetchRoles = jest.fn();
const mockFetchPermissions = jest.fn();
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchRoles: (...args: unknown[]) => mockFetchRoles(...args),
    fetchMyPermissions: (...args: unknown[]) => mockFetchPermissions(...args),
  },
}));

jest.mock("@/features/building/transport", () => ({
  ...jest.requireActual("@/features/building/transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("@/features/building/__fixtures__/testing")
    .mockTransport,
}));

jest.mock("@/features/posts/transport", () => ({
  ...jest.requireActual("@/features/posts/transport"),
  SupabasePostsTransport: {
    fetchPosts: async () => ({ posts: [], nextCursor: null }),
    createPost: jest.fn(),
    deletePost: jest.fn(),
    reportPost: jest.fn(),
    adminRemovePost: jest.fn(),
  },
}));

const mockShare = jest.fn();
jest.mock("@/features/share/share-text", () => ({
  shareText: (...args: unknown[]) => mockShare(...args),
  copyText: jest.fn(),
}));

jest.mock("@/features/account/service", () => ({
  ...jest.requireActual("@/features/account/service"),
  getAvatarUrl: () => null,
}));

function account(username: string | null): UseAccountResult {
  return {
    status: "account",
    userId: "u-owner",
    email: "shilan@example.com",
    profile: {
      userId: "u-owner",
      displayName: "Shilan",
      avatarPath: null,
      username,
      isPrivate: false,
      communityReady: true,
    },
    privateProfile: null,
    profileLoaded: true,
    refreshProfile: async () => undefined,
  };
}

const PUBLIC_BASE = {
  avatar_path: null,
  is_private: false,
  roles: [],
  follow_status: "none",
  is_blocked: false,
  can_view_full: true,
  member_since: "2026-10-04T10:00:00Z",
  badges_hidden: false,
  posts_count: 0,
  recent_comments: [
    {
      comment_id: "c1",
      body: "Felt it in the kitchen",
      created_at: "2026-10-01T10:00:00Z",
      helpful_count: 0,
      hub_id: null,
      place: null,
      magnitude: null,
    },
  ],
};

const OWN_PROFILE = {
  ...PUBLIC_BASE,
  user_id: "u-owner",
  username: "shilan",
  display_name: "Shilan",
  is_self: true,
  followers: 3,
  following: 2,
  comments: 9,
  helpful_received: 31,
  milestones: { reports: 12, detailed_reports: 4, photo_reports: 2 },
};

const OTHER_PROFILE = {
  ...PUBLIC_BASE,
  user_id: "u-dilan",
  username: "dilan.k",
  display_name: "Dilan Ahmed",
  is_self: false,
  followers: 4,
  following: 1,
  comments: 9,
  helpful_received: 31,
  milestones: { reports: 12, detailed_reports: 4, photo_reports: 2 },
};

const STATS_ROW = {
  member_since: "2026-10-04T10:00:00Z",
  reports: 12,
  detailed_reports: 4,
  photo_reports: 2,
  comments: 9,
  helpful_received: 31,
  family_linked: false,
};

/** Every owner-only block the Profile page can hold. */
const OWNER_ONLY_TEST_IDS = [
  "only-you-divider",
  "owner-sections",
  "home-section",
  "my-reports-section",
  "account-community-group",
  "account-people-row",
  "account-admin-row",
  "account-password-row",
  "account-privacy-row",
  "account-sign-out",
  "account-delete",
  "follow-requests",
  "badges-see-all",
  "public-profile-edit",
  "public-profile-share",
];

function setRpc(options: { publicProfile?: unknown; publicProfileError?: unknown }) {
  mockRpc.mockImplementation(async (name: string, args?: { p_username?: string }) => {
    if (name === "public_profile") {
      if (options.publicProfileError) {
        return { data: null, error: options.publicProfileError };
      }
      if (options.publicProfile) {
        return { data: options.publicProfile, error: null };
      }
      return {
        data: args?.p_username === "shilan" ? OWN_PROFILE : OTHER_PROFILE,
        error: null,
      };
    }
    if (name === "my_stats") {
      return { data: [STATS_ROW], error: null };
    }
    if (name === "my_follow_requests") {
      return { data: [], error: null };
    }
    return { data: null, error: null };
  });
}

function setPermissions(permissions: Permission[]) {
  mockFetchPermissions.mockResolvedValue(permissions);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Position of a testID in the rendered tree, for "A comes before B". */
function position(testID: string): number {
  const at = JSON.stringify(screen.toJSON()).indexOf(`"testID":"${testID}"`);
  if (at < 0) {
    throw new Error(`testID ${testID} is not rendered`);
  }
  return at;
}

function rpcNames(): string[] {
  return mockRpc.mock.calls.map((call) => call[0] as string);
}

describe("Profile page (D79)", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockUsername = "shilan";
    mockAccount = account("shilan");
    mockFetchRoles.mockResolvedValue({});
    setPermissions([]);
    setRpc({});
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    await cleanup();
    await clearQueryClients();
    await i18n.changeLanguage(originalLanguage);
  });

  describe("the owner's Profile tab", () => {
    it("shows the public part first, then 'Only you see this', then the owner-only sections in order", async () => {
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      const order = [
        "public-profile-name",
        "public-profile-username",
        "public-profile-edit",
        "public-profile-share",
        "profile-counts",
        "profile-badges",
        "posts-section",
        "only-you-divider",
        "home-section",
        "my-reports-section",
        "account-people-row",
        "account-password-row",
        "account-privacy-row",
        "account-sign-out",
        "account-delete",
      ].map(position);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(screen.getByText("Only you see this")).toBeTruthy();
      expect(screen.getByText("People and requests")).toBeTruthy();
    });

    it("asks for the owner's recently deleted comments and posts (owner-only, migration 0053)", async () => {
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      expect(rpcNames()).toContain("my_recently_deleted");
      // an empty list adds nothing to the page
      expect(screen.queryByTestId("recently-deleted")).toBeNull();
    });

    it("the public part: name, @username, member since, ONE counts row, no Follow button and no recent comments", async () => {
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      expect(screen.getByTestId("public-profile-name").props.children).toBe("Shilan");
      expect(screen.getByTestId("public-profile-username").props.children).toBe(
        "⁦@shilan⁩",
      );
      expect(screen.getByText("Member since Oct 2026")).toBeTruthy();
      expect(screen.getAllByTestId("profile-counts")).toHaveLength(1);
      expect(screen.getByLabelText("Reports: 12")).toBeTruthy();
      expect(screen.getByLabelText("Comments: 9")).toBeTruthy();
      expect(screen.getByLabelText("Followers: 3")).toBeTruthy();
      expect(screen.getByLabelText("Following: 2")).toBeTruthy();
      expect(screen.queryByLabelText(/^Helpful:/)).toBeNull();
      expect(screen.queryByTestId("follow-button")).toBeNull();
      expect(screen.queryByText("Felt it in the kitchen")).toBeNull();
    });

    it("Edit profile opens the editor; Share profile shares the profile link", async () => {
      mockShare.mockResolvedValue("shared");
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("public-profile-edit");
      await act(async () => {
        fireEvent.press(screen.getByTestId("public-profile-edit"));
      });
      expect(mockPush).toHaveBeenCalledWith("/account/profile");
      await act(async () => {
        fireEvent.press(screen.getByTestId("public-profile-share"));
      });
      expect(mockShare).toHaveBeenCalledWith(
        "https://bumelerze.com/app/u/shilan",
        "Shilan",
      );
    });

    it("says 'Link copied' where the share sheet falls back to the clipboard", async () => {
      mockShare.mockResolvedValue("copied");
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("public-profile-share");
      await act(async () => {
        fireEvent.press(screen.getByTestId("public-profile-share"));
      });
      expect(screen.getByTestId("public-profile-notice")).toBeTruthy();
      expect(screen.getByText("Link copied")).toBeTruthy();
    });

    it("badges: only the EARNED ones on the page, 'See all (N)' for the full collection", async () => {
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("profile-badges");
      await flush();
      expect(screen.getByLabelText("First report, earned")).toBeTruthy();
      expect(screen.getByLabelText("Very helpful, earned")).toBeTruthy();
      expect(screen.queryByLabelText(/locked/)).toBeNull();
      expect(screen.queryByLabelText(/Engineer/)).toBeNull();
      expect(screen.getByTestId("badges-see-all")).toBeTruthy();
      expect(screen.getByText(/^See all \(\d+\)$/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId("badges-see-all"));
      });
      expect(mockPush).toHaveBeenCalledWith("/badges");
    });

    it("has the Admin row only for an account with admin access, after People and requests", async () => {
      setPermissions(["comments.moderate"]);
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("account-admin-row");
      expect(position("account-people-row")).toBeLessThan(position("account-admin-row"));
      expect(position("account-admin-row")).toBeLessThan(
        position("account-password-row"),
      );
    });

    it("shows no Admin row to an ordinary account", async () => {
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("account-people-row");
      await flush();
      expect(screen.queryByTestId("account-admin-row")).toBeNull();
    });

    it("keeps working when the public profile cannot be read: header from the device, owner sections intact", async () => {
      setRpc({
        publicProfileError: {
          code: "PGRST202",
          message: "Could not find the function public.public_profile",
        },
      });
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("own-profile-local");
      await flush();
      expect(screen.getByText("Shilan")).toBeTruthy();
      expect(screen.getByLabelText("Reports: 12")).toBeTruthy();
      expect(screen.getByTestId("only-you-divider")).toBeTruthy();
      expect(screen.getByTestId("account-sign-out")).toBeTruthy();
    });

    it("an account without a @username yet still gets the page: local header and owner sections, no public fetch", async () => {
      mockAccount = account(null);
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("own-profile-local");
      expect(rpcNames()).not.toContain("public_profile");
      expect(screen.getByTestId("only-you-divider")).toBeTruthy();
    });
  });

  describe("a visitor on /u/<someone else>", () => {
    beforeEach(() => {
      mockUsername = "dilan.k";
    });

    it("sees the public part with Follow and recent comments, but not a single owner-only part", async () => {
      await renderWithProviders(<PublicProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      expect(screen.getByTestId("public-profile-name").props.children).toBe(
        "Dilan Ahmed",
      );
      expect(screen.getByLabelText("Followers: 4")).toBeTruthy();
      expect(screen.getByTestId("follow-button")).toBeTruthy();
      expect(screen.getByText("Felt it in the kitchen")).toBeTruthy();
      for (const id of OWNER_ONLY_TEST_IDS) {
        expect({ id, shown: screen.queryByTestId(id) !== null }).toEqual({
          id,
          shown: false,
        });
      }
      expect(screen.queryByText("Only you see this")).toBeNull();
      expect(screen.queryByText("Request this badge")).toBeNull();
    });

    it("never starts the owner-only queries (my_stats, follow requests, homes)", async () => {
      await renderWithProviders(<PublicProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      await flush();
      expect(rpcNames()).toContain("public_profile");
      expect(rpcNames()).not.toContain("my_stats");
      expect(rpcNames()).not.toContain("my_follow_requests");
      // nor the owner's "Recently deleted" list (migration 0053)
      expect(rpcNames()).not.toContain("my_recently_deleted");
      expect(mockTransport.fetchMemberships).not.toHaveBeenCalled();
      expect(mockTransport.fetchTags).not.toHaveBeenCalled();
    });

    it("shows even an admin viewer no Admin row on someone else's page", async () => {
      setPermissions(["comments.moderate", "badges.grant"]);
      await renderWithProviders(<PublicProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      await flush();
      expect(screen.queryByTestId("account-admin-row")).toBeNull();
      expect(screen.queryByTestId("account-people-row")).toBeNull();
    });

    it("shows earned badges only: no locked ones, no 'See all', no rank requests", async () => {
      await renderWithProviders(<PublicProfileScreen />);
      await screen.findByTestId("profile-badges");
      expect(screen.getByLabelText("First report, earned")).toBeTruthy();
      expect(screen.queryByLabelText(/locked/)).toBeNull();
      expect(screen.queryByTestId("badges-see-all")).toBeNull();
      expect(screen.queryByTestId("badge-home_tagged")).toBeNull();
    });

    it("a visitor who is a guest gets the same public page", async () => {
      mockAccount = {
        ...account(null),
        status: "anonymous",
        userId: "anon-1",
        email: null,
        profile: null,
      };
      await renderWithProviders(<PublicProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      expect(screen.queryByTestId("only-you-divider")).toBeNull();
      expect(rpcNames()).not.toContain("my_stats");
    });
  });

  describe("/u/<my own username>", () => {
    it("renders the same merged own page (public part, divider, owner sections)", async () => {
      mockUsername = "shilan";
      await renderWithProviders(<PublicProfileScreen />);
      await screen.findByTestId("public-profile-edit");
      await flush();
      expect(screen.getByTestId("only-you-divider")).toBeTruthy();
      expect(screen.getByTestId("account-sign-out")).toBeTruthy();
      expect(screen.getByTestId("own-profile")).toBeTruthy();
    });
  });

  describe("Sorani (RTL)", () => {
    it("renders the own page in ckb with the divider line and localized digits", async () => {
      await i18n.changeLanguage("ckb");
      await renderWithProviders(<ProfileScreen />);
      await screen.findByTestId("public-profile-name");
      await flush();
      expect(screen.getByText("تەنها تۆ ئەمە دەبینیت")).toBeTruthy();
      expect(screen.getByLabelText("ڕاپۆرت: ١٢")).toBeTruthy();
      expect(screen.getByLabelText("شوێنکەوتووان: ٣")).toBeTruthy();
    });
  });
});
