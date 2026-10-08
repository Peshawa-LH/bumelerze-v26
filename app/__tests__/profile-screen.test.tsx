import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "@/features/building/__fixtures__/testing";
import { useFeltQueueStore, type QueueItem, type Tier1Report } from "@/features/felt";
import i18n from "@/i18n";
import type { UseAccountResult } from "@/features/account/use-account";

/**
 * The Profile tab (D79, 2026-10-08), which replaced the My account page:
 * the owner's own page, built from the device (this file's accounts have no
 * @username yet, so the public profile is not fetched and the header comes
 * from the device) or, for a guest, the Guest page. The server numbers come
 * from `my_stats()`; the page must work (and never crash) without it. The
 * public part with a @username, the visitor view and the privacy rule are in
 * `src/features/profile/__tests__`.
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "test-device-uuid-abcdefgh",
}));

let mockConfigured = true;
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  getSupabaseClient: () => (mockConfigured ? { rpc: mockRpc } : null),
}));

let mockAccount: UseAccountResult;
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

const mockFetchRoles = jest.fn();
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchRoles: (...args: unknown[]) => mockFetchRoles(...args),
  },
}));

jest.mock("@/features/building/transport", () => ({
  ...jest.requireActual("@/features/building/transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("@/features/building/__fixtures__/testing")
    .mockTransport,
}));

const mockSignOut = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/features/account/service", () => ({
  ...jest.requireActual("@/features/account/service"),
  signOutAccount: () => mockSignOut(),
  deleteAccount: () => mockDelete(),
  getAvatarUrl: () => null,
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import ProfileScreen from "../(tabs)/profile";

function account(overrides: Partial<UseAccountResult>): UseAccountResult {
  return {
    status: "anonymous",
    userId: "u1",
    email: null,
    profile: null,
    privateProfile: null,
    profileLoaded: false,
    refreshProfile: async () => undefined,
    ...overrides,
  };
}

const ACCOUNT = account({
  status: "account",
  userId: "u-owner",
  email: "shilan@example.com",
  profile: {
    userId: "u-owner",
    displayName: "Shilan",
    avatarPath: null,
    username: null,
    isPrivate: false,
    communityReady: true,
  },
  profileLoaded: true,
});

const STATS_ROW = {
  member_since: "2026-10-04T10:00:00Z",
  reports: 12,
  detailed_reports: 4,
  photo_reports: 2,
  comments: 9,
  helpful_received: 31,
  family_linked: false,
};

const SAMPLE_TIER1: Tier1Report = {
  reportId: "report-1",
  deviceId: "device-abcdef1234567890",
  eventId: null,
  eventRegistration: null,
  cartoonLevel: 4,
  location: { quality: "gps", lat: 36.19, lon: 44.01 },
  feltAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  submittedAt: null,
};

function makeQueueItem(
  id: string,
  createdAt: number,
  overrides: Partial<QueueItem> = {},
): QueueItem {
  return {
    tier1: { ...SAMPLE_TIER1, reportId: id, createdAt },
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoState: null,
    ...overrides,
  };
}

function setFontScale(fontScale: number) {
  Dimensions.set({
    window: { width: 360, height: 640, scale: 2, fontScale },
    screen: { width: 360, height: 640, scale: 2, fontScale },
  });
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Profile tab", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockConfigured = true;
    mockAccount = account({ status: "anonymous" });
    mockRpc.mockResolvedValue({ data: [STATS_ROW], error: null });
    mockFetchRoles.mockResolvedValue({});
    mockSignOut.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    setFontScale(1);
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await clearQueryClients();
    setFontScale(2);
    await i18n.changeLanguage(originalLanguage);
  });

  describe("anonymous", () => {
    it("shows the Profile title, Guest and the single sign-up invitation", async () => {
      await renderWithProviders(<ProfileScreen />);
      expect(screen.getByText("Profile")).toBeTruthy();
      expect(screen.getByText("Guest")).toBeTruthy();
      expect(screen.getAllByTestId("account-create")).toHaveLength(1);
      expect(screen.getAllByText("Create an account")).toHaveLength(1);
      await press("account-create");
      expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
      await press("account-have");
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: "/account/sign-in",
        params: { mode: "signin" },
      });
    });

    it("a guest has no counts row, no earned badge yet and a See all link; no sign-out and no delete", async () => {
      // No server numbers have arrived: nothing earned yet.
      mockRpc.mockReturnValue(new Promise(() => undefined));
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByTestId("profile-counts")).toBeNull();
      expect(screen.getByTestId("badges-none-yet")).toBeTruthy();
      expect(screen.queryByTestId(/^badge-/)).toBeNull();
      expect(screen.queryByTestId("account-sign-out")).toBeNull();
      expect(screen.queryByTestId("account-password-row")).toBeNull();
      expect(screen.queryByTestId("account-delete")).toBeNull();
      expect(screen.queryByTestId("account-edit-profile")).toBeNull();
      expect(screen.queryByTestId("posts-section")).toBeNull();
      expect(screen.queryByTestId("only-you-divider")).toBeNull();
      await press("badges-see-all");
      expect(mockPush).toHaveBeenLastCalledWith("/badges");
    });

    it("hides the contributor ID until Privacy & data is opened, then shows it with a copy button", async () => {
      await renderWithProviders(<ProfileScreen />);
      await flush();
      expect(screen.queryByText(/TEST-DEV/)).toBeNull();
      expect(screen.queryByTestId("privacy-details")).toBeNull();
      expect(
        screen.getByTestId("account-privacy-row").props.accessibilityState.expanded,
      ).toBe(false);
      await press("account-privacy-row");
      await flush();
      expect(screen.getByTestId("privacy-details")).toBeTruthy();
      expect(screen.getByText("⁦TEST-DEV⁩")).toBeTruthy();
      expect(screen.getByLabelText("Copy")).toBeTruthy();
      expect(screen.getByText("Made on this device. Not your name.")).toBeTruthy();
      expect(screen.queryByTestId("account-email")).toBeNull();
    });

    it("My home is a locked preview row, not a button", async () => {
      await renderWithProviders(<ProfileScreen />);
      expect(screen.getByText("My home")).toBeTruthy();
      expect(screen.getByTestId("home-locked")).toBeTruthy();
      expect(screen.getByTestId("home-section-sign-in").props.accessibilityHint).toBe(
        "Needs an account",
      );
      expect(screen.queryByTestId("home-join")).toBeNull();
      expect(screen.queryByTestId("home-tag")).toBeNull();
    });

    it("earns first_report from a local report with no account and no server", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "function does not exist" },
      });
      useFeltQueueStore.setState({
        hasHydrated: true,
        items: [makeQueueItem("a", 1_700_000_000_000)],
      });
      await renderWithProviders(<ProfileScreen />);
      await flush();
      expect(screen.getByLabelText(/^First report, earned$/)).toBeTruthy();
    });

    it("empty reports: a compact card with one line and the report button", async () => {
      await renderWithProviders(<ProfileScreen />);
      expect(screen.getByText("My reports")).toBeTruthy();
      expect(screen.getByText("No reports yet.")).toBeTruthy();
      expect(screen.queryByTestId("my-reports-see-all")).toBeNull();
      await press("reports-empty-cta");
      expect(mockPush).toHaveBeenCalledWith("/felt-report");
    });

    it("does not flash the empty state before the persisted queue has hydrated", async () => {
      useFeltQueueStore.setState({ hasHydrated: false, items: [] });
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByTestId("reports-empty")).toBeNull();
    });

    it("shows the newest three reports and 'See all' to the full list when there are more", async () => {
      useFeltQueueStore.setState({
        hasHydrated: true,
        items: [1, 2, 3, 4].map((n) =>
          makeQueueItem(`r${n}`, 1_700_000_000_000 + n * 1000),
        ),
      });
      await renderWithProviders(<ProfileScreen />);
      expect(
        screen.getAllByTestId("mydata-level-artwork", { includeHiddenElements: true }),
      ).toHaveLength(3);
      expect(screen.getByTestId("my-reports-count").props.children).toBeTruthy();
      await press("my-reports-see-all");
      expect(mockPush).toHaveBeenCalledWith("/my-reports");
    });

    it("no 'See all' with three reports or fewer", async () => {
      useFeltQueueStore.setState({
        hasHydrated: true,
        items: [1, 2, 3].map((n) => makeQueueItem(`r${n}`, 1_700_000_000_000 + n)),
      });
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByTestId("my-reports-see-all")).toBeNull();
    });

    it("no longer holds My location or Notifications (they moved to Settings)", async () => {
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByTestId("account-location-row")).toBeNull();
      expect(screen.queryByTestId("account-notifications-row")).toBeNull();
      expect(screen.queryByText("HomeBase")).toBeNull();
      expect(screen.getByText("Privacy & data")).toBeTruthy();
    });

    it("never asks the server for stats numbers it cannot have without a session id", async () => {
      mockAccount = account({ status: "anonymous", userId: null });
      await renderWithProviders(<ProfileScreen />);
      await flush();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("unconfigured: no invitation, no home card, the page still works", async () => {
      mockConfigured = false;
      mockAccount = account({ status: "unconfigured" });
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByTestId("account-create")).toBeNull();
      expect(screen.queryByTestId("home-section")).toBeNull();
      expect(screen.getByText("Guest")).toBeTruthy();
      expect(screen.getByText("Privacy & data")).toBeTruthy();
    });
  });

  describe("signed in", () => {
    beforeEach(() => {
      mockAccount = ACCOUNT;
    });

    it("shows reports and comments from my_stats(), member since and no invitation", async () => {
      await renderWithProviders(<ProfileScreen />);
      await flush();
      expect(mockRpc).toHaveBeenCalledWith("my_stats");
      expect(screen.queryByTestId("account-create")).toBeNull();
      expect(screen.queryByTestId("sign-up-invite")).toBeNull();
      expect(screen.getByText("Shilan")).toBeTruthy();
      expect(screen.getByLabelText("Reports: 12")).toBeTruthy();
      expect(screen.getByLabelText("Comments: 9")).toBeTruthy();
      expect(screen.queryByLabelText(/^Helpful:/)).toBeNull();
      expect(screen.getByText("Member since Oct 2026")).toBeTruthy();
    });

    it("shows only EARNED badges (milestones and ranks) from my_stats(), with See all (N) for the rest", async () => {
      await renderWithProviders(<ProfileScreen />);
      await flush();
      for (const label of [
        "First report, earned",
        "10 reports, earned",
        "Detailed reporter, earned",
        "Photographer, earned",
        "First comment, earned",
        "Helpful, earned",
        "Very helpful, earned",
      ]) {
        expect(screen.getByLabelText(label)).toBeTruthy();
      }
      // Locked badges and requestable ranks are not on the page itself.
      expect(screen.queryByLabelText(/locked/)).toBeNull();
      expect(screen.queryByTestId("badge-home_tagged")).toBeNull();
      expect(screen.getByTestId("badges-see-all")).toBeTruthy();
    });

    it("leaves out the Comments figure while my_stats() is loading (no flicker of a wrong zero)", async () => {
      mockRpc.mockReturnValue(new Promise(() => undefined));
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByTestId("count-comments")).toBeNull();
      expect(screen.getByTestId("count-reports")).toBeTruthy();
    });

    it("degrades when my_stats() is missing: local numbers, no Comments figure, no crash", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.my_stats",
        },
      });
      useFeltQueueStore.setState({
        hasHydrated: true,
        items: [makeQueueItem("a", 1_700_000_000_000)],
      });
      await renderWithProviders(<ProfileScreen />);
      // One retry (about a second) before the app gives up on the server.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      });
      expect(screen.getByLabelText("Reports: 1")).toBeTruthy();
      expect(screen.queryByTestId("count-comments")).toBeNull();
      expect(screen.queryByText("Member since Oct 2026")).toBeNull();
      expect(screen.getByText("Shilan")).toBeTruthy();
    });

    it("keeps the larger of local and server report counts", async () => {
      mockRpc.mockResolvedValue({ data: [{ ...STATS_ROW, reports: 1 }], error: null });
      useFeltQueueStore.setState({
        hasHydrated: true,
        items: [1, 2, 3].map((n) => makeQueueItem(`r${n}`, 1_700_000_000_000 + n)),
      });
      await renderWithProviders(<ProfileScreen />);
      await flush();
      expect(screen.getByLabelText("Reports: 3")).toBeTruthy();
    });

    it("the email lives under Privacy & data, not in the header", async () => {
      await renderWithProviders(<ProfileScreen />);
      expect(screen.queryByText("shilan@example.com")).toBeNull();
      await press("account-privacy-row");
      expect(screen.getByTestId("account-email").props.children).toBe(
        "shilan@example.com",
      );
    });

    it("has a Password row that opens the set / change password screen", async () => {
      await renderWithProviders(<ProfileScreen />);
      await press("account-password-row");
      expect(mockPush).toHaveBeenLastCalledWith("/account/password");
    });

    it("signs out in one tap and has Delete as its own card, last", async () => {
      await renderWithProviders(<ProfileScreen />);
      await press("account-sign-out");
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      await press("account-delete");
      expect(mockDelete).not.toHaveBeenCalled();
      expect(screen.getByText(/permanently deletes your profile/)).toBeTruthy();
      await press("account-delete-confirm");
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it("tagged home: card, then Family chip and badge earned", async () => {
      mockTransport.fetchMemberships.mockResolvedValue([
        member("u-owner", { role: "owner" }),
      ]);
      mockTransport.fetchTags.mockResolvedValue([TAG]);
      await renderWithProviders(<ProfileScreen />);
      await flush();
      await flush();
      expect(screen.getByTestId("home-card-tag-1")).toBeTruthy();
      expect(screen.getByLabelText("Home tagged, earned")).toBeTruthy();
    });

    it("joining someone else's home earns Family linked", async () => {
      mockRpc.mockResolvedValue({ data: [STATS_ROW], error: null });
      mockTransport.fetchMemberships.mockResolvedValue([
        member("u-owner", { role: "member" }),
      ]);
      mockTransport.fetchTags.mockResolvedValue([TAG]);
      await renderWithProviders(<ProfileScreen />);
      await flush();
      await flush();
      expect(screen.getByLabelText("Family linked, earned")).toBeTruthy();
    });

    it("an account with no tag gets the tag card and a join link", async () => {
      await renderWithProviders(<ProfileScreen />);
      await flush();
      await press("home-tag");
      expect(mockPush).toHaveBeenCalledWith("/home/new");
      await press("home-join");
      expect(mockPush).toHaveBeenCalledWith("/home/join");
    });
  });

  describe("official account", () => {
    it("wears the round Bumelerze icon in the header and holds the role badge first in the grid", async () => {
      mockAccount = ACCOUNT;
      mockFetchRoles.mockResolvedValue({
        "u-owner": [{ role: "official", orgName: "Bumelerze" }],
      });
      await renderWithProviders(<ProfileScreen />);
      await flush();
      await flush();
      expect(screen.getByTestId("role-mark-official")).toBeTruthy();
      expect(screen.getByTestId("role-mark-official-icon")).toBeTruthy();
      const first = screen.getAllByTestId(/^badge-(role-official|first_report)$/)[0];
      expect(first?.props.testID).toBe("badge-role-official");
    });
  });

  describe("Sorani (RTL)", () => {
    it("renders in ckb with Eastern Arabic digits, mirrored chevrons and isolated codes", async () => {
      await i18n.changeLanguage("ckb");
      mockAccount = ACCOUNT;
      mockTransport.fetchMemberships.mockResolvedValue([
        member("u-owner", { role: "owner" }),
      ]);
      mockTransport.fetchTags.mockResolvedValue([TAG]);
      await renderWithProviders(<ProfileScreen />);
      await flush();
      await flush();
      expect(screen.getByLabelText("ڕاپۆرت: ١٢")).toBeTruthy();
      expect(screen.getByLabelText("تێبینی: ٩")).toBeTruthy();
      // Home card code is wrapped in a left-to-right isolate.
      expect(screen.getByText("⁦BMH-7K3Q9P⁩")).toBeTruthy();
      expect(
        screen.getAllByTestId("directional-chevron", { includeHiddenElements: true })
          .length,
      ).toBeGreaterThan(0);
    });
  });
});
