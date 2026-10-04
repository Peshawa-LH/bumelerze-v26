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

const mockRequest = jest.fn();
const mockVerify = jest.fn();
jest.mock("@/features/account/service", () => ({
  isPlausibleEmail: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
  requestEmailCode: (email: string) => mockRequest(email),
  verifyEmailCode: (email: string, code: string, mode: string) => mockVerify(email, code, mode),
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

describe("Sign-in screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockProfile = null;
    mockRequest.mockResolvedValue({ mode: "upgrade" });
    mockVerify.mockResolvedValue({ userId: "u1", claimed: 0 });
    mockSync.mockResolvedValue(undefined);
    delete process.env.EXPO_PUBLIC_AUTH_GOOGLE;
    delete process.env.EXPO_PUBLIC_AUTH_APPLE;
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it("enables Send only for a plausible email", async () => {
    await renderScreen(<SignInScreen />);
    expect(disabled("account-send-code")).toBe(true);
    await type("account-email-input", "nope");
    expect(disabled("account-send-code")).toBe(true);
    await type("account-email-input", "a@b.co");
    expect(disabled("account-send-code")).toBe(false);
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

  it("after sending, asks to open the link and keeps the code behind a second option", async () => {
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await press("account-send-code");

    expect(mockRequest).toHaveBeenCalledWith("a@b.co");
    expect(screen.getByTestId("account-check-email")).toBeTruthy();
    expect(screen.queryByTestId("account-code-input")).toBeNull();

    await press("account-have-code");
    expect(screen.getByTestId("account-code-input")).toBeTruthy();
  });

  it("verifies the code, then goes to the profile form for a new account", async () => {
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await press("account-send-code");
    await press("account-have-code");

    await type("account-code-input", "12a3456");
    expect(screen.getByTestId("account-code-input").props.value).toBe("123456");
    await press("account-confirm-code");

    expect(mockVerify).toHaveBeenCalledWith("a@b.co", "123456", "upgrade");
    expect(mockReplace).toHaveBeenCalledWith("/account/profile");
  });

  it("existing account with moved reports shows a welcome with the count", async () => {
    mockRequest.mockResolvedValue({ mode: "signin" });
    mockVerify.mockResolvedValue({ userId: "u1", claimed: 4 });
    mockProfile = { displayName: "Shilan" };
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await press("account-send-code");
    await press("account-have-code");
    await type("account-code-input", "123456");
    await press("account-confirm-code");

    expect(mockVerify).toHaveBeenCalledWith("a@b.co", "123456", "signin");
    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByText(/added to your account: 4/)).toBeTruthy();
    await press("account-done");
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows a message for a wrong code and stays on the screen", async () => {
    const { AccountError } = jest.requireActual("@/features/account/types");
    mockVerify.mockRejectedValueOnce(new AccountError("invalid_code"));
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await press("account-send-code");
    await press("account-have-code");
    await type("account-code-input", "000000");
    await press("account-confirm-code");

    expect(screen.getByText("That code is wrong or expired.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("locks Resend for 60 seconds, then allows it", async () => {
    await renderScreen(<SignInScreen />);
    await type("account-email-input", "a@b.co");
    await press("account-send-code");

    expect(disabled("account-resend")).toBe(true);
    expect(screen.getByText("Send again in 60 s")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Send again in 30 s")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(disabled("account-resend")).toBe(false);
    await press("account-resend");
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
