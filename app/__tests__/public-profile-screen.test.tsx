import { cleanup, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";

/**
 * The public profile route: every state has a friendly message (profiles not
 * available yet, no such account, load failure) and the found state renders
 * the profile. The body is covered by `PublicProfileView.test.tsx`.
 */
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ username: "Dilan.K" }),
  Stack: Object.assign(() => null, {
    Screen: (props: { options?: { title?: string } }) => {
      mockScreenOptions(props.options);
      return null;
    },
  }),
}));

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));

// eslint-disable-next-line import/first -- after the mocks
import PublicProfileScreen from "../(tabs)/(home,map,sensor,profile,settings)/u/[username]/index";

const PROFILE = {
  user_id: "u1",
  username: "dilan.k",
  display_name: "Dilan Ahmed",
  avatar_path: null,
  is_private: false,
  roles: [],
  is_self: false,
  follow_status: "none",
  is_blocked: false,
  can_view_full: true,
  member_since: "2026-01-02T10:00:00Z",
  followers: 0,
  following: 0,
  comments: 0,
  helpful_received: 0,
  badges_hidden: false,
  milestones: { reports: 0, detailed_reports: 0, photo_reports: 0 },
  recent_comments: [],
};

describe("public profile screen", () => {
  beforeEach(async () => {
    mockRpc.mockReset();
    mockScreenOptions.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("asks the server for the lowercase username and shows the profile", async () => {
    mockRpc.mockResolvedValue({ data: PROFILE, error: null });
    await renderWithProviders(<PublicProfileScreen />);
    expect(await screen.findByTestId("public-profile-name")).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith("public_profile", { p_username: "dilan.k" });
    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Profile", headerShown: true }),
    );
  });

  it("says so when there is no such account", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await renderWithProviders(<PublicProfileScreen />);
    expect(await screen.findByText("No account with this name.")).toBeTruthy();
  });

  it("shows a friendly 'not available' message before the migration is applied", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.public_profile",
      },
    });
    await renderWithProviders(<PublicProfileScreen />);
    expect(await screen.findByText("Not available right now.")).toBeTruthy();
    expect(screen.queryByText(/PGRST202|public_profile/)).toBeNull();
  });

  it("offers Retry after another failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await renderWithProviders(<PublicProfileScreen />);
    expect(
      await screen.findByText(
        "Couldn't load. Check your connection.",
        {},
        { timeout: 4000 },
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
