import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: { mode?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => mockParams,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockCreate = jest.fn();
const mockSignIn = jest.fn();
jest.mock("@/features/account/service", () => ({
  createAccountWithPassword: (email: string, password: string) =>
    mockCreate(email, password),
  signInWithPassword: (email: string, password: string) => mockSignIn(email, password),
  startOAuth: jest.fn(),
}));

let mockProfile: unknown = null;
const mockSync = jest.fn();
jest.mock("@/features/account/store", () => ({
  syncAccountNow: () => mockSync(),
  useAccountStore: {
    getState: () => ({ profile: mockProfile, profileLoaded: true }),
  },
}));

// eslint-disable-next-line import/first -- must follow the mocks above
import SignInScreen from "../account/sign-in";

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
async function fillCreate(overrides: { again?: string; password?: string } = {}) {
  await type("account-email-input", "a@b.co");
  await type("account-email-again-input", overrides.again ?? "a@b.co");
  await type("account-password-input", overrides.password ?? "correct horse");
}

describe("Create account (sign-in screen, default mode)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockParams = {};
    mockProfile = null;
    mockCreate.mockResolvedValue(undefined);
    mockSignIn.mockResolvedValue({ userId: "u1", claimed: 0 });
    mockSync.mockResolvedValue(undefined);
    delete process.env.EXPO_PUBLIC_AUTH_GOOGLE;
    delete process.env.EXPO_PUBLIC_AUTH_APPLE;
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("asks for email twice and a password; no code or link wording anywhere", async () => {
    await renderScreen(<SignInScreen />);
    expect(screen.getByTestId("account-email-input")).toBeTruthy();
    expect(screen.getByTestId("account-email-again-input")).toBeTruthy();
    expect(screen.getByTestId("account-password-input")).toBeTruthy();
    expect(screen.queryByText(/code|link/i)).toBeNull();
    expect(screen.queryByTestId("account-send-code")).toBeNull();
  });

  it("sets the autofill hints password managers rely on", async () => {
    await renderScreen(<SignInScreen />);
    const email = screen.getByTestId("account-email-input").props;
    expect(email.autoComplete).toBe("email");
    expect(email.textContentType).toBe("emailAddress");
    const password = screen.getByTestId("account-password-input").props;
    expect(password.autoComplete).toBe("new-password");
    expect(password.textContentType).toBe("newPassword");
    expect(password.secureTextEntry).toBe(true);
  });

  it("keeps the typed text left-to-right even in a right-to-left screen", async () => {
    await renderScreen(<SignInScreen />);
    const style = screen.getByTestId("account-password-input").props.style;
    expect(JSON.stringify(style)).toContain('"writingDirection":"ltr"');
  });

  it("shows and hides the password with a toggle", async () => {
    await renderScreen(<SignInScreen />);
    await press("account-password-input-toggle");
    expect(screen.getByTestId("account-password-input").props.secureTextEntry).toBe(
      false,
    );
    await press("account-password-input-toggle");
    expect(screen.getByTestId("account-password-input").props.secureTextEntry).toBe(true);
  });

  it("stays disabled until all three fields have something", async () => {
    await renderScreen(<SignInScreen />);
    expect(disabled("account-create-submit")).toBe(true);
    await type("account-email-input", "a@b.co");
    await type("account-email-again-input", "a@b.co");
    expect(disabled("account-create-submit")).toBe(true);
    await type("account-password-input", "x");
    expect(disabled("account-create-submit")).toBe(false);
  });

  it("shows a mismatch error and calls nothing when the two emails differ", async () => {
    await renderScreen(<SignInScreen />);
    await fillCreate({ again: "a@c.co" });
    await press("account-create-submit");
    expect(screen.getByText("The two emails don't match.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("explains a too-short password locally", async () => {
    await renderScreen(<SignInScreen />);
    await fillCreate({ password: "short" });
    await press("account-create-submit");
    expect(screen.getByText("The password must be 8 to 72 characters.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the account with email + password, then goes to the profile form", async () => {
    await renderScreen(<SignInScreen />);
    await fillCreate();
    await press("account-create-submit");

    expect(mockCreate).toHaveBeenCalledWith("a@b.co", "correct horse");
    expect(mockSync).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/account/profile");
  });

  it("goes back when the account already has a profile", async () => {
    mockProfile = { displayName: "Shilan" };
    await renderScreen(<SignInScreen />);
    await fillCreate();
    await press("account-create-submit");
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows the server's problem in plain words and stays put", async () => {
    const { AccountError } = jest.requireActual("@/features/account/types");
    mockCreate.mockRejectedValueOnce(new AccountError("email_taken"));
    await renderScreen(<SignInScreen />);
    await fillCreate();
    await press("account-create-submit");
    expect(
      screen.getByText("This email already has an account. Use Sign in."),
    ).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("says so when there is no connection", async () => {
    const { AccountError } = jest.requireActual("@/features/account/types");
    mockCreate.mockRejectedValueOnce(new AccountError("network"));
    await renderScreen(<SignInScreen />);
    await fillCreate();
    await press("account-create-submit");
    expect(screen.getByText("No connection. Try again.")).toBeTruthy();
  });

  it("hides Google and Apple unless their flags are set", async () => {
    await renderScreen(<SignInScreen />);
    expect(screen.queryByTestId("account-google")).toBeNull();
    expect(screen.queryByTestId("account-apple")).toBeNull();
  });

  it("shows Google and Apple when their flags are set", async () => {
    process.env.EXPO_PUBLIC_AUTH_GOOGLE = "1";
    process.env.EXPO_PUBLIC_AUTH_APPLE = "1";
    await renderScreen(<SignInScreen />);
    expect(screen.getByTestId("account-google")).toBeTruthy();
    expect(screen.getByTestId("account-apple")).toBeTruthy();
  });
});

describe("Sign in (sign-in screen, mode=signin)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockParams = { mode: "signin" };
    mockProfile = { displayName: "Shilan" };
    mockSignIn.mockResolvedValue({ userId: "u1", claimed: 0 });
    mockSync.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("opens on the sign-in form and can switch to create and back", async () => {
    await renderScreen(<SignInScreen />);
    expect(screen.getByTestId("account-signin-submit")).toBeTruthy();
    expect(screen.queryByTestId("account-email-again-input")).toBeNull();
    await press("account-switch-mode");
    expect(screen.getByTestId("account-create-submit")).toBeTruthy();
    await press("account-switch-mode");
    expect(screen.getByTestId("account-signin-submit")).toBeTruthy();
  });

  it("uses current-password autofill hints", async () => {
    await renderScreen(<SignInScreen />);
    const password = screen.getByTestId("account-password-input").props;
    expect(password.autoComplete).toBe("current-password");
    expect(password.textContentType).toBe("password");
  });

  it("enables Sign in only for a plausible email and a password", async () => {
    await renderScreen(<SignInScreen />);
    expect(disabled("account-signin-submit")).toBe(true);
    await type("account-email-input", "nope");
    await type("account-password-input", "secret");
    expect(disabled("account-signin-submit")).toBe(true);
    await type("account-email-input", "a@b.co");
    expect(disabled("account-signin-submit")).toBe(false);
  });

  it("signs in and goes back when nothing was moved", async () => {
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await type("account-password-input", "secret pass");
    await press("account-signin-submit");
    expect(mockSignIn).toHaveBeenCalledWith("a@b.co", "secret pass");
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows a welcome with the count when reports moved over", async () => {
    mockSignIn.mockResolvedValue({ userId: "u1", claimed: 4 });
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await type("account-password-input", "secret pass");
    await press("account-signin-submit");

    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByText(/added to your account: 4/)).toBeTruthy();
    await press("account-done");
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows wrong credentials in plain words", async () => {
    const { AccountError } = jest.requireActual("@/features/account/types");
    mockSignIn.mockRejectedValueOnce(new AccountError("invalid_credentials"));
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await type("account-password-input", "wrong");
    await press("account-signin-submit");
    expect(screen.getByText("Wrong email or password.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("forgot password: explains, sends no email, and opens Feedback with a prefill", async () => {
    await renderScreen(<SignInScreen />);
    expect(screen.queryByTestId("account-forgot-info")).toBeNull();
    await press("account-forgot");
    expect(
      screen.getByText(
        "Password resets by email are coming. For now, contact us through Feedback and we'll reset it.",
      ),
    ).toBeTruthy();
    await press("account-forgot-contact");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/feedback",
      params: { passwordReset: "1" },
    });
  });
});
