import { cleanup, fireEvent, screen } from "@testing-library/react-native";

import {
  clearQueryClients,
  renderWithProviders,
  resetMockTransport,
} from "@/features/building/__fixtures__/testing";
import { useFeltQueueStore } from "@/features/felt";
import i18n from "@/i18n";
import type { UseAccountResult } from "@/features/account/use-account";

import BadgesScreen from "../(tabs)/(home,map,sensor,profile,settings)/badges";

/**
 * "All badges" (opened from the owner's "See all (N)"): the full collection,
 * everything showing, with the locked badges and the ranks that can be
 * requested through Feedback. The public profile never shows these.
 */
const mockPush = jest.fn();
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: Object.assign(() => null, {
    Screen: (props: { options?: unknown }) => {
      mockScreenOptions(props.options);
      return null;
    },
  }),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "test-device-uuid-abcdefgh" }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => null,
}));
const mockAccount: UseAccountResult = {
  status: "anonymous",
  userId: "u1",
  email: null,
  profile: null,
  privateProfile: null,
  profileLoaded: false,
  refreshProfile: async () => undefined,
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("@/features/building/transport", () => ({
  ...jest.requireActual("@/features/building/transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("@/features/building/__fixtures__/testing")
    .mockTransport,
}));

describe("All badges screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    await cleanup();
    await clearQueryClients();
  });

  it("has a back header titled Badges and shows the n/N counter", async () => {
    await renderWithProviders(<BadgesScreen />);
    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Badges", headerShown: true }),
    );
    expect(screen.getByTestId("badges-counter")).toBeTruthy();
  });

  it("shows locked badges and the requestable ranks, already expanded", async () => {
    await renderWithProviders(<BadgesScreen />);
    expect(screen.getByText("Show less")).toBeTruthy();
    expect(screen.getByLabelText("Engineer, locked")).toBeTruthy();
    expect(screen.getByLabelText("Home tagged, locked, 0 of 1")).toBeTruthy();
    expect(screen.queryByTestId("badge-role-official")).toBeNull();
    expect(screen.queryByTestId("badge-role-moderator")).toBeNull();
    expect(screen.queryByTestId("badge-role-partner")).toBeNull();
  });

  it("'Request this badge' goes to Feedback with the rank", async () => {
    await renderWithProviders(<BadgesScreen />);
    await fireEvent.press(screen.getByTestId("badge-role-engineer"));
    await fireEvent.press(screen.getByTestId("badge-sheet-request"));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/feedback",
      params: { badgeRequest: "1", rank: "engineer" },
    });
  });
});
