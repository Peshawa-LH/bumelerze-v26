import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { OwnerList } from "../components/OwnerList";

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

describe("OwnerList: admin entry", () => {
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
    await renderWithProviders(<OwnerList />);
    await permissionsAnswered();
    await act(async () => undefined);
    expect(screen.getByTestId("account-people-row")).toBeTruthy();
    expect(screen.queryByTestId("account-admin-row")).toBeNull();
  });

  it("shows the admin row to a moderator and opens the admin screen", async () => {
    signedIn("shilan");
    setPermissions(["comments.moderate"]);
    await renderWithProviders(<OwnerList />);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("account-admin-row"));
    });
    expect(mockPush).toHaveBeenCalledWith("/admin");
  });

  it("shows the admin row to someone who can only grant badges", async () => {
    signedIn("shilan");
    setPermissions(["badges.grant"]);
    await renderWithProviders(<OwnerList />);
    expect(await screen.findByTestId("account-admin-row")).toBeTruthy();
  });

  it("shows a Government official the Officials row and no admin row", async () => {
    signedIn("shilan");
    setPermissions(["authority.view"]);
    await renderWithProviders(<OwnerList />);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("account-officials-row"));
    });
    expect(mockPush).toHaveBeenCalledWith("/officials");
    expect(screen.queryByTestId("account-admin-row")).toBeNull();
  });

  it("shows no Officials row to admins without the Government official rank", async () => {
    signedIn("shilan");
    setPermissions(["comments.moderate", "stats.read", "hubs.open"]);
    await renderWithProviders(<OwnerList />);
    expect(await screen.findByTestId("account-admin-row")).toBeTruthy();
    expect(screen.queryByTestId("account-officials-row")).toBeNull();
  });

  it("hides the admin row on a server without my_permissions, even for an official", async () => {
    signedIn("shilan");
    setPermissions(null);
    mockFetchRoles.mockResolvedValue({ u1: [{ role: "official", orgName: null }] });
    await renderWithProviders(<OwnerList />);
    await permissionsAnswered();
    await waitFor(() => expect(mockFetchRoles).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId("account-admin-row")).toBeNull();
    expect(screen.getByTestId("account-people-row")).toBeTruthy();
  });

  it("is one list: My reports, My home, People and requests, Download my data", async () => {
    signedIn("shilan");
    await renderWithProviders(<OwnerList />);
    await permissionsAnswered();
    await act(async () => undefined);
    for (const id of [
      "my-reports-row",
      "my-home-row",
      "account-people-row",
      "data-export-row",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId("my-home-row"));
    expect(mockPush).toHaveBeenCalledWith("/my-home");
    fireEvent.press(screen.getByTestId("my-reports-row"));
    expect(mockPush).toHaveBeenCalledWith("/my-reports");
    fireEvent.press(screen.getByTestId("account-people-row"));
    expect(mockPush).toHaveBeenCalledWith("/account/people");
  });
});
