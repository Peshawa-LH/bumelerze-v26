import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockSetPassword = jest.fn();
const mockChangePassword = jest.fn();
jest.mock("@/features/account/service", () => ({
  setAccountPassword: (password: string) => mockSetPassword(password),
  changeAccountPassword: (current: string, password: string) =>
    mockChangePassword(current, password),
}));

const mockVerifyCode = jest.fn();
jest.mock("@/features/account/two-step", () => ({
  ...jest.requireActual("@/features/account/two-step"),
  verifyTwoStepCode: (code: string) => mockVerifyCode(code),
}));

let mockStatus = "account";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: mockStatus, userId: "u1" }),
}));

/** What `my_account_has_password()` answered (null: no 0075 on the server). */
let mockHasPassword: {
  isSuccess: boolean;
  isError: boolean;
  data?: boolean | null;
  error?: unknown;
};
const mockRefetch = jest.fn();
jest.mock("@/features/account/use-two-step", () => ({
  useAccountHasPassword: () => ({ ...mockHasPassword, refetch: mockRefetch }),
}));

// eslint-disable-next-line import/first -- must follow the mocks above
import PasswordScreen from "../account/password";
// eslint-disable-next-line import/first -- must follow the mocks above
import { AccountError } from "@/features/account/types";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function renderScreen(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}
async function type(testID: string, value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
  });
}
function disabled(testID: string): boolean {
  return screen.getByTestId(testID).props.accessibilityState?.disabled === true;
}

describe("Set / change password screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStatus = "account";
    mockHasPassword = { isSuccess: true, isError: false, data: false };
    mockSetPassword.mockResolvedValue(undefined);
    mockChangePassword.mockResolvedValue(undefined);
    mockVerifyCode.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("an account without a password yet (today's form)", () => {
    it("keeps the old intro and asks for the new password twice, with new-password autofill hints", async () => {
      await renderScreen(<PasswordScreen />);
      expect(
        screen.getByText(
          "Choose a password for signing in on other devices. If you already have one, this replaces it.",
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId("password-current-input")).toBeNull();
      for (const id of ["password-new-input", "password-confirm-input"]) {
        const props = screen.getByTestId(id).props;
        expect(props.autoComplete).toBe("new-password");
        expect(props.textContentType).toBe("newPassword");
        expect(props.secureTextEntry).toBe(true);
      }
    });

    it("keeps today's form when the server cannot tell yet (before migration 0075)", async () => {
      mockHasPassword = { isSuccess: true, isError: false, data: null };
      await renderScreen(<PasswordScreen />);
      expect(screen.queryByTestId("password-current-input")).toBeNull();
    });

    it("shows a mismatch error and saves nothing when the copies differ", async () => {
      await renderScreen(<PasswordScreen />);
      await type("password-new-input", "a brand new one");
      await type("password-confirm-input", "a brand new on");
      await press("password-save");
      expect(screen.getByText("The two passwords don't match.")).toBeTruthy();
      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it("refuses a short password locally", async () => {
      await renderScreen(<PasswordScreen />);
      await type("password-new-input", "short");
      await type("password-confirm-input", "short");
      await press("password-save");
      expect(screen.getByText("The password must be 8 to 72 characters.")).toBeTruthy();
      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it("saves, confirms once, and Done goes back", async () => {
      await renderScreen(<PasswordScreen />);
      await type("password-new-input", "a brand new one");
      await type("password-confirm-input", "a brand new one");
      await press("password-save");

      expect(mockSetPassword).toHaveBeenCalledWith("a brand new one");
      expect(mockChangePassword).not.toHaveBeenCalled();
      expect(screen.getByText("Password saved.")).toBeTruthy();
      expect(screen.queryByTestId("password-new-input")).toBeNull();
      await press("password-done");
      expect(mockBack).toHaveBeenCalled();
    });

    it("words a server refusal in plain language and keeps the form", async () => {
      mockSetPassword.mockRejectedValueOnce(new AccountError("reauth_needed"));
      await renderScreen(<PasswordScreen />);
      await type("password-new-input", "a brand new one");
      await type("password-confirm-input", "a brand new one");
      await press("password-save");
      expect(
        screen.getByText("For safety, sign out, sign in again, then change your password."),
      ).toBeTruthy();
      expect(screen.getByTestId("password-new-input")).toBeTruthy();
    });

    it("with two-step sign-in on (insufficient_aal), asks for the code, then saves", async () => {
      mockSetPassword
        .mockRejectedValueOnce(new AccountError("code_needed"))
        .mockResolvedValueOnce(undefined);
      await renderScreen(<PasswordScreen />);
      await type("password-new-input", "a brand new one");
      await type("password-confirm-input", "a brand new one");
      await press("password-save");
      await type("password-code-input", "654321");
      await press("password-code-verify");
      expect(mockVerifyCode).toHaveBeenCalledWith("654321");
      expect(mockSetPassword).toHaveBeenLastCalledWith("a brand new one");
      expect(screen.getByText("Password saved.")).toBeTruthy();
    });
  });

  describe("an account with a password (security checklist A0.1)", () => {
    beforeEach(() => {
      mockHasPassword = { isSuccess: true, isError: false, data: true };
    });

    async function fill(current = "the old one") {
      await type("password-current-input", current);
      await type("password-new-input", "a brand new one");
      await type("password-confirm-input", "a brand new one");
    }

    it("says to enter the current password first, in a current-password field", async () => {
      await renderScreen(<PasswordScreen />);
      expect(
        screen.getByText(
          "Change the password you use to sign in. Enter your current password first.",
        ),
      ).toBeTruthy();
      expect(screen.getByText("Current password")).toBeTruthy();
      const props = screen.getByTestId("password-current-input").props;
      expect(props.autoComplete).toBe("current-password");
      expect(props.textContentType).toBe("password");
      expect(props.secureTextEntry).toBe(true);
    });

    it("cannot save without the current password", async () => {
      await renderScreen(<PasswordScreen />);
      await type("password-new-input", "a brand new one");
      await type("password-confirm-input", "a brand new one");
      expect(disabled("password-save")).toBe(true);
      await type("password-current-input", "the old one");
      expect(disabled("password-save")).toBe(false);
    });

    it("changes it through the current-password check, never the plain set", async () => {
      await renderScreen(<PasswordScreen />);
      await fill();
      await press("password-save");
      expect(mockChangePassword).toHaveBeenCalledWith("the old one", "a brand new one");
      expect(mockSetPassword).not.toHaveBeenCalled();
      expect(screen.getByText("Password saved.")).toBeTruthy();
    });

    it("says so when the current password is wrong, and changes nothing", async () => {
      mockChangePassword.mockRejectedValueOnce(new AccountError("current_password_wrong"));
      await renderScreen(<PasswordScreen />);
      await fill("not the old one");
      await press("password-save");
      expect(screen.getByText("Your current password isn't right.")).toBeTruthy();
      expect(screen.queryByText("Password saved.")).toBeNull();
      expect(screen.getByTestId("password-current-input")).toBeTruthy();
    });

    it("with two-step sign-in on, asks for the code, then saves", async () => {
      mockChangePassword.mockRejectedValueOnce(new AccountError("code_needed"));
      await renderScreen(<PasswordScreen />);
      await fill();
      await press("password-save");

      expect(screen.getByTestId("password-code-step")).toBeTruthy();
      expect(
        screen.getByText(
          "Open your authenticator app and enter the 6-digit code for Bumelerze.",
        ),
      ).toBeTruthy();
      expect(disabled("password-code-verify")).toBe(true);
      await type("password-code-input", "123 456");
      expect(screen.getByTestId("password-code-input").props.value).toBe("123456");
      await press("password-code-verify");

      expect(mockVerifyCode).toHaveBeenCalledWith("123456");
      expect(mockSetPassword).toHaveBeenCalledWith("a brand new one");
      expect(mockVerifyCode.mock.invocationCallOrder[0] as number).toBeLessThan(
        mockSetPassword.mock.invocationCallOrder[0] as number,
      );
      expect(screen.getByText("Password saved.")).toBeTruthy();
    });

    it("a wrong code says what to check and empties the field; nothing is saved", async () => {
      mockChangePassword.mockRejectedValueOnce(new AccountError("code_needed"));
      mockVerifyCode.mockRejectedValueOnce(new AccountError("wrong_code"));
      await renderScreen(<PasswordScreen />);
      await fill();
      await press("password-save");
      await type("password-code-input", "000000");
      await press("password-code-verify");
      expect(
        screen.getByText(
          "That code didn't work. Check that your phone's time is right and try the newest code.",
        ),
      ).toBeTruthy();
      expect(screen.getByTestId("password-code-input").props.value).toBe("");
      expect(mockSetPassword).not.toHaveBeenCalled();
    });
  });

  it("offers Retry when it cannot tell whether the account has a password", async () => {
    mockHasPassword = {
      isSuccess: false,
      isError: true,
      error: new AccountError("network"),
    };
    await renderScreen(<PasswordScreen />);
    expect(screen.getByText("No connection. Try again.")).toBeTruthy();
    expect(screen.queryByTestId("password-new-input")).toBeNull();
    await press("password-retry");
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("sends a guest to create an account instead of showing the form", async () => {
    mockStatus = "anonymous";
    mockHasPassword = { isSuccess: false, isError: false };
    await renderScreen(<PasswordScreen />);
    expect(screen.queryByTestId("password-new-input")).toBeNull();
    await press("password-go-sign-in");
    expect(mockReplace).toHaveBeenCalledWith("/account/sign-in");
  });
});
