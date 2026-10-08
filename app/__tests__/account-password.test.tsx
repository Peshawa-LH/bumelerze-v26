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
jest.mock("@/features/account/service", () => ({
  setAccountPassword: (password: string) => mockSetPassword(password),
}));

let mockStatus = "account";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: mockStatus }),
}));

// eslint-disable-next-line import/first -- must follow the mocks above
import PasswordScreen from "../account/password";

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

describe("Set / change password screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStatus = "account";
    mockSetPassword.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("asks for the new password twice, with new-password autofill hints", async () => {
    await renderScreen(<PasswordScreen />);
    for (const id of ["password-new-input", "password-confirm-input"]) {
      const props = screen.getByTestId(id).props;
      expect(props.autoComplete).toBe("new-password");
      expect(props.textContentType).toBe("newPassword");
      expect(props.secureTextEntry).toBe(true);
    }
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
    expect(screen.getByText("Password saved.")).toBeTruthy();
    expect(screen.queryByTestId("password-new-input")).toBeNull();
    await press("password-done");
    expect(mockBack).toHaveBeenCalled();
  });

  it("words a server refusal in plain language and keeps the form", async () => {
    const { AccountError } = jest.requireActual("@/features/account/types");
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

  it("sends a guest to create an account instead of showing the form", async () => {
    mockStatus = "anonymous";
    await renderScreen(<PasswordScreen />);
    expect(screen.queryByTestId("password-new-input")).toBeNull();
    await press("password-go-sign-in");
    expect(mockReplace).toHaveBeenCalledWith("/account/sign-in");
  });
});
