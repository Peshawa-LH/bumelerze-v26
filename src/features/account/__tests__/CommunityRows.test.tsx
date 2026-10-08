import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { CommunityRows } from "../components/CommunityRows";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ rpc: mockRpc }),
}));
const mockRpc = jest.fn();

let mockAccount: Record<string, unknown> = {};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));

const mockFetchPermissions = jest.fn();
const mockFetchRoles = jest.fn();
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchMyPermissions: (...args: unknown[]) => mockFetchPermissions(...args),
    fetchRoles: (...args: unknown[]) => mockFetchRoles(...args),
  },
}));

function signedIn(username: string | null) {
  mockAccount = {
    status: "account",
    userId: "u1",
    email: "a@b.co",
    profile: {
      userId: "u1",
      displayName: "Shilan",
      avatarPath: null,
      username,
      isPrivate: false,
      communityReady: true,
    },
    profileLoaded: true,
  };
}

function setPermissions(permissions: Permission[] | null) {
  if (permissions === null) {
    mockFetchPermissions.mockRejectedValue(new Error("missing"));
  } else {
    mockFetchPermissions.mockResolvedValue(permissions);
  }
}

describe("CommunityRows (Profile, owner only)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: [], error: null });
    mockFetchRoles.mockResolvedValue({});
    setPermissions([]);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("renders nothing for a guest", async () => {
    mockAccount = { status: "anonymous", userId: "anon", profile: null };
    await renderWithProviders(<CommunityRows />);
    expect(screen.queryByTestId("account-community-group")).toBeNull();
  });

  it("shows People and requests for an account, and no 'my public profile' row (the page is the profile)", async () => {
    signedIn("shilan");
    await renderWithProviders(<CommunityRows />);
    expect(screen.getByText("People and requests")).toBeTruthy();
    expect(screen.queryByTestId("account-public-profile-row")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("account-people-row"));
    });
    expect(mockPush).toHaveBeenCalledWith("/account/people");
  });

  it("shows the pending request count and answers requests inline", async () => {
    signedIn("shilan");
    mockRpc.mockImplementation(async (name: string) =>
      name === "my_follow_requests"
        ? {
            data: [
              {
                person_id: "u2",
                username: "aso",
                display_name: "Aso",
                requested_at: "2026-10-05T10:00:00Z",
              },
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    await renderWithProviders(<CommunityRows />);
    expect(await screen.findByTestId("follow-requests")).toBeTruthy();
    expect(screen.getByLabelText(/^People and requests, \d/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("request-accept-u2"));
    });
    expect(mockRpc).toHaveBeenCalledWith("accept_follow_request", { p_follower: "u2" });
  });
});
