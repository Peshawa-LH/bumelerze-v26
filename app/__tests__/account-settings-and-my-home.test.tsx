import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "@/features/building/__fixtures__/testing";
import { useFeltQueueStore } from "@/features/felt";
import i18n from "@/i18n";
import type { UseAccountResult } from "@/features/account/use-account";

/**
 * What left the Profile page in review note 5.1 (mockup 3a), with the same
 * behaviour where it went: Password, Privacy & data, Sign out and Delete
 * account in Settings > Account, and the home card on its own My home page.
 *
 * (Header of the Profile tab test it came from:) The Profile tab (D79, 2026-10-08), which replaced the My account page:
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
import { AccountSettingsGroup } from "@/features/account/components/AccountSettingsGroup";
// eslint-disable-next-line import/first -- see comment above
import MyHomeScreen from "../(tabs)/(home,map,sensor,profile,settings)/my-home";

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

describe("Settings > Account and My home", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockConfigured = true;
    mockAccount = ACCOUNT;
    mockRpc.mockResolvedValue({ data: [STATS_ROW], error: null });
    mockFetchRoles.mockResolvedValue({});
    mockSignOut.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await clearQueryClients();
    await i18n.changeLanguage(originalLanguage);
  });

  describe("Settings > Account", () => {
    it("is not there for a guest", async () => {
      mockAccount = account({ status: "anonymous" });
      await renderWithProviders(<AccountSettingsGroup />);
      expect(screen.queryByTestId("settings-group-account")).toBeNull();
    });

    it("the email lives under Privacy & data", async () => {
      await renderWithProviders(<AccountSettingsGroup />);
      expect(screen.queryByText("shilan@example.com")).toBeNull();
      await press("account-privacy-row");
      expect(screen.getByTestId("account-email").props.children).toBe(
        "shilan@example.com",
      );
    });

    it("has a Password row that opens the set / change password screen", async () => {
      await renderWithProviders(<AccountSettingsGroup />);
      await press("account-password-row");
      expect(mockPush).toHaveBeenLastCalledWith("/account/password");
    });

    it("signs out in one tap and has Delete as its own card, last", async () => {
      await renderWithProviders(<AccountSettingsGroup />);
      await press("account-sign-out");
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      await press("account-delete");
      expect(mockDelete).not.toHaveBeenCalled();
      expect(screen.getByText(/permanently deletes your account/)).toBeTruthy();
      await press("account-delete-confirm");
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe("My home page", () => {
    it("tagged home: the card", async () => {
      mockTransport.fetchMemberships.mockResolvedValue([
        member("u-owner", { role: "owner" }),
      ]);
      mockTransport.fetchTags.mockResolvedValue([TAG]);
      await renderWithProviders(<MyHomeScreen />);
      await flush();
      await flush();
      expect(screen.getByTestId("home-card-tag-1")).toBeTruthy();
    });

    it("an account with no tag gets the tag card and a join link", async () => {
      await renderWithProviders(<MyHomeScreen />);
      await flush();
      await press("home-tag");
      expect(mockPush).toHaveBeenCalledWith("/home/new");
      await press("home-join");
      expect(mockPush).toHaveBeenCalledWith("/home/join");
    });

    it("keeps the home code isolated left to right in Sorani", async () => {
      await i18n.changeLanguage("ckb");
      mockTransport.fetchMemberships.mockResolvedValue([
        member("u-owner", { role: "owner" }),
      ]);
      mockTransport.fetchTags.mockResolvedValue([TAG]);
      await renderWithProviders(<MyHomeScreen />);
      await flush();
      await flush();
      expect(screen.getByText("\u2066BMH-7K3Q9P\u2069")).toBeTruthy();
    });
  });
});
