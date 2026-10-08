import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import { SnackbarProvider } from "@/components/Snackbar";
import i18n from "@/i18n";
import { FamilyScreen } from "../components/FamilyScreen";
import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockAccount = { status: "account", userId: "u-owner" };
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));
const mockFetchFamily = jest.fn();
const mockSetSharing = jest.fn();
jest.mock("@/features/safe/transport", () => ({
  ...jest.requireActual("@/features/safe/transport"),
  SupabaseFamilyCheckInTransport: {
    fetchFamily: (tagId: string) => mockFetchFamily(tagId),
    setSharing: (tagId: string, on: boolean) => mockSetSharing(tagId, on),
  },
}));

const NOW = Date.now();
const QUAKE = {
  event_id: "e1",
  bumelerze_id: "bml1",
  magnitude: 5.1,
  place: "Halabja",
  origin_time: new Date(NOW - 2 * 3_600_000).toISOString(),
};

function load(userId: string, role: "owner" | "member") {
  mockAccount = { status: "account", userId };
  mockTransport.fetchTags.mockResolvedValue([TAG]);
  mockTransport.fetchMemberships.mockResolvedValue([member(userId, { role })]);
  mockTransport.fetchMembers.mockResolvedValue([
    member("u-owner", { role: "owner" }),
    member("u-2"),
    member("u-3"),
    member("u-4"),
  ]);
  mockTransport.fetchMemberProfiles.mockResolvedValue({
    "u-owner": { displayName: "Shilan", username: null, avatarPath: null },
    "u-2": { displayName: "Karwan", username: null, avatarPath: null },
    "u-3": { displayName: "Dilan", username: null, avatarPath: null },
    "u-4": { displayName: "Rawand", username: null, avatarPath: null },
  });
  mockTransport.fetchJoinKey.mockResolvedValue("ABCD2345");
  // u-4 switched sharing off (or blocked): not in "sharing".
  mockFetchFamily.mockResolvedValue(
    jest.requireActual("@/features/safe/transport").parseFamilyCheckIns({
      my_share: true,
      sharing: ["u-owner", "u-2", "u-3"],
      checkins: [
        {
          user_id: "u-owner",
          checked_in_at: new Date(NOW - 3_600_000).toISOString(),
          ...QUAKE,
        },
        {
          user_id: "u-2",
          checked_in_at: new Date(NOW - 1_800_000).toISOString(),
          ...QUAKE,
        },
      ],
    }),
  );
}

async function renderFamily() {
  await renderWithProviders(
    <SnackbarProvider>
      <FamilyScreen tagId="tag-1" />
    </SnackbarProvider>,
  );
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe("Family screen: I'm safe status and removing a member", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockSetSharing.mockResolvedValue(undefined);
    await i18n.changeLanguage("en");
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("shows '2 of 3 checked in', each person's state, and never a location", async () => {
    load("u-2", "member");
    await renderFamily();
    expect(await screen.findByTestId("family-status")).toBeTruthy();
    expect(screen.getByTestId("family-status-summary")).toHaveTextContent(
      "2 of 3 checked in",
    );
    expect(screen.getByTestId("family-status-state-u-owner")).toHaveTextContent(
      /^Safe · /,
    );
    expect(screen.getByTestId("family-status-state-u-3")).toHaveTextContent(
      "Not heard from yet",
    );
    expect(screen.queryByTestId("family-status-row-u-4")).toBeNull();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toMatch(/36\.19|44\.01|missing|last seen/i);
    expect(screen.getByLabelText(/Dilan, not heard from yet/)).toBeTruthy();
  });

  it("my switch 'Show my check-ins to this home'", async () => {
    load("u-2", "member");
    await renderFamily();
    await screen.findByTestId("family-status-share-switch");
    await act(async () => {
      fireEvent(screen.getByTestId("family-status-share-switch"), "valueChange", false);
    });
    expect(mockSetSharing).toHaveBeenCalledWith("tag-1", false);
  });

  it("the manual 'I'm safe' opens the check-in screen", async () => {
    load("u-2", "member");
    await renderFamily();
    await screen.findByTestId("family-status-check-in");
    await press("family-status-check-in");
    expect(mockPush).toHaveBeenCalledWith("/im-safe");
  });

  it("the status hides itself when it cannot load (e.g. before the migration)", async () => {
    load("u-2", "member");
    mockFetchFamily.mockRejectedValue(new Error("Could not find the function"));
    await renderFamily();
    await screen.findByText("Shilan");
    expect(screen.queryByTestId("family-status")).toBeNull();
  });

  it("owner removes a member after a confirm, with Undo", async () => {
    load("u-owner", "owner");
    await renderFamily();
    await screen.findByTestId("family-remove-u-2");
    // Never offered for the owner (self).
    expect(screen.queryByTestId("family-remove-u-owner")).toBeNull();
    await press("family-remove-u-2");
    const options = mockConfirm.mock.calls[0]?.[0] as {
      title: string;
      destructive: boolean;
      onConfirm: () => void;
    };
    expect(options.title).toBe("Remove Karwan?");
    expect(options.destructive).toBe(true);
    expect(mockTransport.removeMember).not.toHaveBeenCalled();
    await act(async () => {
      options.onConfirm();
    });
    expect(mockTransport.removeMember).toHaveBeenCalledWith("tag-1", "u-2");
    expect(screen.getByTestId("snackbar-message")).toHaveTextContent(
      "Karwan was removed",
    );
    await press("snackbar-action");
    expect(mockTransport.restoreMember).toHaveBeenCalledWith("tag-1", "u-2");
  });

  it("a member cannot remove anybody", async () => {
    load("u-2", "member");
    await renderFamily();
    await screen.findByTestId("family-members");
    await screen.findAllByText("Dilan");
    expect(screen.queryByTestId("family-remove-u-3")).toBeNull();
  });
});
