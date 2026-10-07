import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

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

/** Waits until the permission query has been asked and has answered. */
async function permissionsAnswered() {
  await waitFor(() => expect(mockFetchPermissions).toHaveBeenCalled());
  await waitFor(() =>
    expect(mockFetchPermissions.mock.results.length).toBeGreaterThan(0),
  );
  await mockFetchPermissions.mock.results[0]?.value?.catch?.(() => undefined);
}

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

describe("CommunityRows: admin entry", () => {
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

  it("shows no admin row to an ordinary account", async () => {
    signedIn("shilan");
    await renderWithProviders(<CommunityRows />);
    await permissionsAnswered();
    await act(async () => undefined);
    expect(screen.getByTestId("account-people-row")).toBeTruthy();
    expect(screen.queryByTestId("account-admin-row")).toBeNull();
  });

  it("shows the admin row to a moderator and opens the admin screen", async () => {
    signedIn("shilan");
    setPermissions(["comments.moderate"]);
    await renderWithProviders(<CommunityRows />);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("account-admin-row"));
    });
    expect(mockPush).toHaveBeenCalledWith("/admin");
  });

  it("shows the admin row to someone who can only grant badges", async () => {
    signedIn("shilan");
    setPermissions(["badges.grant"]);
    await renderWithProviders(<CommunityRows />);
    expect(await screen.findByTestId("account-admin-row")).toBeTruthy();
  });

  it("hides the admin row on a server without my_permissions, even for an official", async () => {
    signedIn("shilan");
    setPermissions(null);
    mockFetchRoles.mockResolvedValue({ u1: [{ role: "official", orgName: null }] });
    await renderWithProviders(<CommunityRows />);
    await permissionsAnswered();
    await waitFor(() => expect(mockFetchRoles).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId("account-admin-row")).toBeNull();
    expect(screen.getByTestId("account-people-row")).toBeTruthy();
  });
});
