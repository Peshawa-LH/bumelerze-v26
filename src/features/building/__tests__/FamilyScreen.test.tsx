import { act, cleanup, fireEvent, screen, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";

import i18n from "@/i18n";
import { FamilyScreen } from "../components/FamilyScreen";
import { HomeError } from "../types";
import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

const LINK = "https://bumelerze.com/app/home/join?code=BMH-7K3Q9P&key=ABCD2345";
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
    canGoBack: () => true,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock("react-native-qrcode-svg", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
    const { View } = require("react-native");
    return <View testID="qr-code" {...{ value }} />;
  },
}));
const mockConfirm = jest.fn();
const mockMessage = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: (title: string, message: string) => mockMessage(title, message),
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-owner",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

function loadAs(userId: string, role: "owner" | "member") {
  mockAccount = { status: "account", userId };
  mockTransport.fetchTags.mockResolvedValue([TAG]);
  mockTransport.fetchMemberships.mockResolvedValue([member(userId, { role })]);
  mockTransport.fetchMembers.mockResolvedValue([
    member("u-owner", { role: "owner" }),
    member("u-2", { requestedAt: "2026-10-04T11:00:00Z" }),
    member("u-3", { status: "pending", requestedAt: "2026-10-04T12:00:00Z" }),
  ]);
  mockTransport.fetchDisplayNames.mockResolvedValue({
    "u-owner": "Shilan",
    "u-2": "Karwan",
    "u-3": "Dilan",
  });
  mockTransport.fetchJoinKey.mockResolvedValue("ABCD2345");
}

describe("Family screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  describe("owner", () => {
    beforeEach(() => loadAs("u-owner", "owner"));

    it("shows the code and the secret key", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      expect(await screen.findByText(/ABCD2345/)).toBeTruthy();
      expect(screen.getByText(/BMH-7K3Q9P/)).toBeTruthy();
      expect(screen.getByText("Secret key")).toBeTruthy();
      expect(mockTransport.fetchJoinKey).toHaveBeenCalledWith("tag-1");
    });

    it("lists approved members with display names, marking the owner and you", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      expect(await screen.findByText("Shilan (you)")).toBeTruthy();
      expect(screen.getByText("Karwan")).toBeTruthy();
      expect(screen.getByText("Owner")).toBeTruthy();
      // the pending person is under approval, not in the member list
      expect(
        within(screen.getByTestId("family-members")).queryByText("Dilan"),
      ).toBeNull();
    });

    it("approves a pending request", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      expect(await screen.findByText("Waiting for approval")).toBeTruthy();
      expect(screen.getByText("Dilan")).toBeTruthy();
      await press("family-approve-u-3");
      expect(mockTransport.decideJoin).toHaveBeenCalledWith("tag-1", "u-3", true);
    });

    it("declines a pending request", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText("Dilan");
      await press("family-decline-u-3");
      expect(mockTransport.decideJoin).toHaveBeenCalledWith("tag-1", "u-3", false);
    });

    it("shows a QR code of the join link: code and key, never the location", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      const qr = screen.getByTestId("qr-code");
      expect(qr.props.value).toBe(LINK);
      expect(qr.props.value).not.toMatch(/36\.19|44\.01|lat|lon/i);
      expect(screen.getByLabelText("QR code to join this home")).toBeTruthy();
      expect(screen.getByText("Share invite")).toBeTruthy();
    });

    it("a new key changes the QR code, so old QR codes stop working", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("family-new-key");
      await screen.findByText(/NEWKEY99/);
      expect(screen.getByTestId("qr-code").props.value).toBe(
        "https://bumelerze.com/app/home/join?code=BMH-7K3Q9P&key=NEWKEY99",
      );
    });

    it("shares the invite link with the system share sheet", async () => {
      const share = jest
        .spyOn(Share, "share")
        .mockResolvedValue({ action: "sharedAction" });
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("family-share-button");
      expect(share).toHaveBeenCalledWith({
        message: `Join my home on Bumelerze:\n${LINK}`,
      });
    });

    it("copies instead when there is no share sheet", async () => {
      jest.spyOn(Share, "share").mockRejectedValue(new Error("unsupported"));
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("family-share-button");
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        `Join my home on Bumelerze:\n${LINK}`,
      );
      expect(await screen.findByText("Copied.")).toBeTruthy();
    });

    it("copy puts the same message on the clipboard", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("family-copy");
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        `Join my home on Bumelerze:\n${LINK}`,
      );
    });

    it("creates a new key and shows it", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("family-new-key");
      expect(mockTransport.rotateKey).toHaveBeenCalledWith("tag-1");
      expect(await screen.findByText(/NEWKEY99/)).toBeTruthy();
      expect(screen.queryByText(/ABCD2345/)).toBeNull();
      expect(
        screen.getByText("New key created. The old key no longer works."),
      ).toBeTruthy();
    });

    it("owners get 'Delete this home', not 'Leave' or 'Close'", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      expect(screen.getByText("Delete this home")).toBeTruthy();
      expect(screen.getByTestId("home-delete")).toBeTruthy();
      expect(screen.queryByTestId("family-leave")).toBeNull();
      expect(screen.queryByText("Close this home")).toBeNull();
    });

    it("deleting asks first (destructive), then deletes and returns to My account", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("home-delete");
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      const options = mockConfirm.mock.calls[0]?.[0] as {
        destructive: boolean;
        message: string;
        onConfirm: () => void;
      };
      expect(options.destructive).toBe(true);
      expect(options.message).toMatch(/answers, report, photos and family links/);
      expect(options.message).toMatch(/for everyone/);
      expect(options.message).toMatch(/can't be undone/);
      expect(mockTransport.deleteHome).not.toHaveBeenCalled();
      await act(async () => {
        options.onConfirm();
      });
      expect(mockTransport.deleteHome).toHaveBeenCalledWith("tag-1");
      expect(mockReplace).toHaveBeenCalledWith("/my-data");
      expect(mockTransport.leave).not.toHaveBeenCalled();
    });

    it("pressing Delete only asks; nothing is deleted until the dialog is confirmed", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("home-delete");
      // the dialog was dismissed: onConfirm is never called
      expect(mockTransport.deleteHome).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId("home-delete")).toBeTruthy();
    });

    it("a failed delete shows the short error and stays on the screen", async () => {
      mockTransport.deleteHome.mockRejectedValueOnce(new HomeError("network"));
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText(/ABCD2345/);
      await press("home-delete");
      await act(async () => {
        (mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void }).onConfirm();
      });
      expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("shows a short message when a decision fails", async () => {
      mockTransport.decideJoin.mockRejectedValueOnce(new HomeError("network"));
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText("Dilan");
      await press("family-approve-u-3");
      expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    });
  });

  describe("member", () => {
    beforeEach(() => loadAs("u-2", "member"));

    it("sees the members and can leave, but not the key or the requests", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      expect(await screen.findByText("Karwan (you)")).toBeTruthy();
      expect(screen.getByText("Shilan")).toBeTruthy();
      expect(screen.queryByTestId("family-share")).toBeNull();
      expect(screen.queryByTestId("qr-code")).toBeNull();
      expect(screen.queryByTestId("family-pending")).toBeNull();
      expect(screen.queryByText(/ABCD2345/)).toBeNull();
      expect(mockTransport.fetchJoinKey).not.toHaveBeenCalled();
      expect(screen.getByText("Leave this home")).toBeTruthy();
      expect(screen.queryByTestId("home-delete")).toBeNull();
      expect(screen.queryByText("Delete this home")).toBeNull();
    });

    it("leaving asks first, then leaves", async () => {
      await renderWithProviders(<FamilyScreen tagId="tag-1" />);
      await screen.findByText("Karwan (you)");
      await press("family-leave");
      expect(
        screen.getByText("You will no longer see this home or its report."),
      ).toBeTruthy();
      await press("family-leave-yes");
      expect(mockTransport.leave).toHaveBeenCalledWith("tag-1");
      expect(mockReplace).toHaveBeenCalledWith("/my-data");
    });
  });

  it("an anonymous user sees the account card", async () => {
    mockAccount = { status: "anonymous", userId: "a1" };
    await renderWithProviders(<FamilyScreen tagId="tag-1" />);
    expect(screen.getByText("Create an account to tag your home.")).toBeTruthy();
  });

  it("someone who is not a member gets 'not available'", async () => {
    mockAccount = { status: "account", userId: "u-9" };
    mockTransport.fetchTags.mockResolvedValue([]);
    await renderWithProviders(<FamilyScreen tagId="tag-1" />);
    expect(await screen.findByText("This home is not available.")).toBeTruthy();
  });

  it("renders in Arabic without raw keys", async () => {
    loadAs("u-owner", "owner");
    await i18n.changeLanguage("ar");
    await renderWithProviders(<FamilyScreen tagId="tag-1" />);
    expect(await screen.findByText("المفتاح السري")).toBeTruthy();
    expect(screen.getByText("بانتظار الموافقة")).toBeTruthy();
    expect(screen.queryByText(/building\.[a-z]/i)).toBeNull();
  });
});
