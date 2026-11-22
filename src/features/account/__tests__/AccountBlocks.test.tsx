import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

import i18n from "@/i18n";
import type { UseAccountResult } from "../use-account";
import { DeleteAccountRow } from "../components/DeleteAccountRow";
import { ProfileHeader } from "../components/ProfileHeader";
import { SignOutRow } from "../components/SignOutRow";
import { SignUpInvite } from "../components/SignUpInvite";

/** Ported from the old AccountCard test: the same flows (edit, finish
 * profile, sign out, delete with confirmation, failure message), now spread
 * over the redesigned blocks. */

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockAccount: UseAccountResult;
jest.mock("../use-account", () => ({
  useAccount: () => mockAccount,
}));

/** Re-reads the permissions and two-step answers (migration 0076). */
const mockRefreshTwoStep = jest.fn();
jest.mock("../use-two-step", () => ({
  useRefreshTwoStep: () => mockRefreshTwoStep,
}));

const mockSignOut = jest.fn();
const mockDelete = jest.fn();
/** How many items are still unsent after the try to send them first. */
const mockSendWaiting = jest.fn();
jest.mock("../service", () => ({
  signOutAccount: (...args: unknown[]) => mockSignOut(...args),
  sendWaitingItemsBeforeSignOut: () => mockSendWaiting(),
  deleteAccount: () => mockDelete(),
  getAvatarUrl: () => null,
}));

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
  email: "shilan@example.com",
  profile: {
    userId: "u1",
    displayName: "Shilan",
    avatarPath: null,
    username: null,
    isPrivate: false,
    communityReady: true,
  },
  profileLoaded: true,
});

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

const OCT_2026 = new Date(2026, 9, 15).getTime();

describe("account blocks", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    mockSendWaiting.mockResolvedValue(0);
    mockDelete.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("ProfileHeader", () => {
    it("anonymous: grey person named Guest, no edit, no member-since", async () => {
      mockAccount = account({ status: "anonymous" });
      await render(<ProfileHeader memberSince={null} roles={[]} />);
      expect(screen.getByText("Guest")).toBeTruthy();
      expect(
        screen.getByTestId("avatar-person", { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(screen.queryByTestId("account-edit-profile")).toBeNull();
      expect(screen.queryByTestId("profile-member-since")).toBeNull();
    });

    it("account: name, member since (month and year), edit button; the email is not in the header", async () => {
      mockAccount = ACCOUNT;
      await render(<ProfileHeader memberSince={OCT_2026} roles={[]} />);
      expect(screen.getByText("Shilan")).toBeTruthy();
      expect(screen.getByText("Member since Oct 2026")).toBeTruthy();
      expect(screen.queryByText("shilan@example.com")).toBeNull();
      await press("account-edit-profile");
      expect(mockPush).toHaveBeenCalledWith("/account/profile");
    });

    it("shows the member-since date with Sorani digits and month names", async () => {
      await i18n.changeLanguage("ckb");
      mockAccount = ACCOUNT;
      await render(<ProfileHeader memberSince={OCT_2026} roles={[]} />);
      expect(screen.getByTestId("profile-member-since").props.children).toMatch(/٢٠٢٦/);
    });

    it("an official account wears the Bumelerze mark beside the name", async () => {
      mockAccount = ACCOUNT;
      await render(
        <ProfileHeader
          memberSince={null}
          roles={[{ role: "official", orgName: null }]}
        />,
      );
      expect(screen.getByTestId("role-mark-official")).toBeTruthy();
      expect(screen.getByTestId("role-mark-official-icon")).toBeTruthy();
    });

    it("an account without a profile yet is asked to finish it", async () => {
      mockAccount = account({ status: "account", email: "a@b.co", profileLoaded: true });
      await render(<ProfileHeader memberSince={null} roles={[]} />);
      expect(screen.getByText("Your account")).toBeTruthy();
      expect(screen.queryByTestId("account-edit-profile")).toBeNull();
      await press("account-finish-profile");
      expect(mockPush).toHaveBeenCalledWith("/account/profile");
    });
  });

  describe("SignUpInvite", () => {
    it("has one create-account button and a quiet sign-in link that opens the sign-in form", async () => {
      await render(<SignUpInvite />);
      expect(screen.getAllByTestId("account-create")).toHaveLength(1);
      expect(screen.getByText("Get a name, badges and your building tag.")).toBeTruthy();
      await press("account-create");
      expect(mockPush).toHaveBeenLastCalledWith("/account/sign-in");
      await press("account-have");
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: "/account/sign-in",
        params: { mode: "signin" },
      });
    });
  });

  describe("SignOutRow", () => {
    let alertSpy: jest.SpyInstance;
    beforeEach(() => {
      alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    });
    afterEach(() => {
      alertSpy.mockRestore();
    });

    /** The buttons of the one system dialog shown (iOS/Android). */
    function dialogButtons(): AlertButton[] {
      expect(alertSpy).toHaveBeenCalledTimes(1);
      return (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    }

    it("signs out in one tap, with no confirmation or note, when everything was sent", async () => {
      await render(<SignOutRow />);
      await press("account-sign-out");
      expect(mockSendWaiting).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      // Already sent (or tried): the service does not try again.
      expect(mockSignOut).toHaveBeenCalledWith({ sendFirst: false });
      expect(mockSendWaiting.mock.invocationCallOrder[0] as number).toBeLessThan(
        mockSignOut.mock.invocationCallOrder[0] as number,
      );
      expect(alertSpy).not.toHaveBeenCalled();
      expect(screen.queryByText("This device gets a new anonymous ID.")).toBeNull();
    });

    it("[APP-04] asks first when something is still unsent, and signs out only on 'Sign out anyway'", async () => {
      mockSendWaiting.mockResolvedValueOnce(2);
      await render(<SignOutRow />);
      await press("account-sign-out");
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(alertSpy.mock.calls[0]?.[0]).toBe("Not sent yet");
      expect(alertSpy.mock.calls[0]?.[1]).toBe(
        "Some of your reports or messages haven't been sent yet. If you sign out now, they will be deleted from this device.",
      );
      const buttons = dialogButtons();
      expect(buttons.map((b) => [b.text, b.style])).toEqual([
        ["Cancel", "cancel"],
        ["Sign out anyway", "destructive"],
      ]);
      await act(async () => {
        buttons[1]?.onPress?.();
      });
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledWith({ sendFirst: false });
      expect(mockRefreshTwoStep).toHaveBeenCalledTimes(1);
    });

    it("[APP-04] Cancel in that question changes nothing", async () => {
      mockSendWaiting.mockResolvedValueOnce(1);
      await render(<SignOutRow />);
      await press("account-sign-out");
      const cancel = dialogButtons()[0];
      expect(cancel?.style).toBe("cancel");
      await act(async () => {
        cancel?.onPress?.();
      });
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockRefreshTwoStep).not.toHaveBeenCalled();
      expect(screen.getByTestId("account-sign-out").props.accessibilityState.disabled).toBe(
        false,
      );
    });

    it("asks rather than deletes when it cannot tell what is unsent", async () => {
      mockSendWaiting.mockRejectedValueOnce(new Error("boom"));
      await render(<SignOutRow />);
      await press("account-sign-out");
      expect(dialogButtons()).toHaveLength(2);
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it("on the web asks with the browser's confirm: Cancel keeps the session, OK signs out", async () => {
      const { Platform } = jest.requireActual<typeof import("react-native")>("react-native");
      const originalOS = Platform.OS;
      const confirmSpy = jest.fn();
      const hadConfirm = "confirm" in globalThis;
      const original = (globalThis as { confirm?: unknown }).confirm;
      (globalThis as { confirm?: unknown }).confirm = confirmSpy;
      Platform.OS = "web";
      try {
        mockSendWaiting.mockResolvedValue(1);
        await render(<SignOutRow />);
        confirmSpy.mockReturnValueOnce(false);
        await press("account-sign-out");
        expect(confirmSpy).toHaveBeenCalledWith(
          "Not sent yet\n\nSome of your reports or messages haven't been sent yet. If you sign out now, they will be deleted from this device.",
        );
        expect(mockSignOut).not.toHaveBeenCalled();

        confirmSpy.mockReturnValueOnce(true);
        await press("account-sign-out");
        expect(mockSignOut).toHaveBeenCalledTimes(1);
        expect(alertSpy).not.toHaveBeenCalled();
      } finally {
        Platform.OS = originalOS;
        if (hadConfirm) {
          (globalThis as { confirm?: unknown }).confirm = original;
        } else {
          delete (globalThis as { confirm?: unknown }).confirm;
        }
      }
    });

    it("shows the question in Sorani too", async () => {
      await i18n.changeLanguage("ckb");
      mockSendWaiting.mockResolvedValueOnce(1);
      await render(<SignOutRow />);
      await press("account-sign-out");
      expect(alertSpy.mock.calls[0]?.[0]).toBe("هێشتا نەنێردراوە");
      expect(dialogButtons().map((b) => b.text)).toEqual([
        "پاشگەزبوونەوە",
        "لەگەڵ ئەوەشدا بچۆ دەرەوە",
      ]);
    });

    it("[A1.1] re-reads the permissions after signing out, so admin tools go at once", async () => {
      await render(<SignOutRow />);
      await press("account-sign-out");
      expect(mockRefreshTwoStep).toHaveBeenCalledTimes(1);
      expect(mockSignOut.mock.invocationCallOrder[0] as number).toBeLessThan(
        mockRefreshTwoStep.mock.invocationCallOrder[0] as number,
      );
    });

    it("says so when signing out fails", async () => {
      mockSignOut.mockRejectedValueOnce(new Error("boom"));
      await render(<SignOutRow />);
      await press("account-sign-out");
      expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
      expect(mockRefreshTwoStep).not.toHaveBeenCalled();
    });
  });

  describe("DeleteAccountRow", () => {
    it("needs a second, confirming tap and can be cancelled", async () => {
      await render(<DeleteAccountRow />);
      await press("account-delete");
      expect(mockDelete).not.toHaveBeenCalled();
      expect(screen.getByText(/permanently deletes your account/)).toBeTruthy();

      await press("account-delete-cancel");
      expect(screen.queryByTestId("account-delete-confirm")).toBeNull();
      expect(screen.getByTestId("account-delete")).toBeTruthy();

      await press("account-delete");
      await press("account-delete-confirm");
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it("lists what is deleted and what stays before the confirming tap", async () => {
      await render(<DeleteAccountRow />);
      await press("account-delete");
      expect(screen.getByText("What is deleted")).toBeTruthy();
      expect(screen.getByText("What stays")).toBeTruthy();
      const goes = screen.getByTestId("account-delete-goes");
      expect(within(goes).getByText(/Your profile, photo and @username/)).toBeTruthy();
      expect(within(goes).getByText(/The text of your comments/)).toBeTruthy();
      expect(within(goes).getByText(/“Deleted account” line stays/)).toBeTruthy();
      expect(within(goes).getByText(/Homes you own/)).toBeTruthy();
      const stays = screen.getByTestId("account-delete-stays");
      expect(
        within(stays).getByText(
          /felt reports .* stay as research data, without your name/,
        ),
      ).toBeTruthy();
      expect(
        within(stays).getByText(/Feedback you sent stays, without your name or contact/),
      ).toBeTruthy();
      expect(within(stays).getByText(/up to 90 days/)).toBeTruthy();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("shows a message when deleting fails", async () => {
      mockDelete.mockRejectedValueOnce(new Error("boom"));
      await render(<DeleteAccountRow />);
      await press("account-delete");
      await press("account-delete-confirm");
      expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
    });

    it("is labelled with text, not only an icon", async () => {
      await render(<DeleteAccountRow />);
      expect(screen.getByText("Delete account")).toBeTruthy();
    });
  });
});
