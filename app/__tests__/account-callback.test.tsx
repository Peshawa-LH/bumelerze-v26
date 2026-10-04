import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => false }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockComplete = jest.fn();
jest.mock("@/features/account/service", () => ({
  completeEmailLink: () => mockComplete(),
}));
const mockSync = jest.fn();
jest.mock("@/features/account/store", () => ({
  syncAccountNow: () => mockSync(),
}));

// eslint-disable-next-line import/first -- must follow the mocks above
import AuthCallbackScreen from "../account/callback";

describe("Auth callback screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows progress while it waits for the session", async () => {
    mockComplete.mockReturnValue(new Promise(() => undefined));
    await render(<AuthCallbackScreen />);
    expect(screen.getByText("Signing you in…")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("sends a new account to the profile form", async () => {
    mockComplete.mockResolvedValue({ status: "ok", userId: "u", hasProfile: false, claimed: 0 });
    await render(<AuthCallbackScreen />);
    await act(async () => undefined);
    expect(mockSync).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/account/profile");
  });

  it("sends an account that already has a profile to My account", async () => {
    mockComplete.mockResolvedValue({ status: "ok", userId: "u", hasProfile: true, claimed: 3 });
    await render(<AuthCallbackScreen />);
    await act(async () => undefined);
    expect(mockReplace).toHaveBeenCalledWith("/my-data");
  });

  it("shows the expired message with a way back to sign-in", async () => {
    mockComplete.mockResolvedValue({ status: "expired" });
    await render(<AuthCallbackScreen />);
    await act(async () => undefined);

    expect(screen.getByText("This link has expired or was already used.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("callback-back"));
    });
    expect(mockReplace).toHaveBeenCalledWith("/account/sign-in");
  });

  it("treats an unexpected failure like an expired link", async () => {
    mockComplete.mockRejectedValue(new Error("boom"));
    await render(<AuthCallbackScreen />);
    await act(async () => undefined);
    expect(screen.getByText("This link has expired or was already used.")).toBeTruthy();
  });
});
