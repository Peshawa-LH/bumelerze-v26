import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Alert, type AlertButton } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

/**
 * "Enter your code" for a device found signed in without its code (opened
 * by the start/foreground check): verifies, moves any reports a sign-in
 * left at the code did not move, and goes back; or signs out.
 */

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockCanGoBack = true;
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: mockPush,
    canGoBack: () => mockCanGoBack,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockClaim = jest.fn();
const mockSignOut = jest.fn();
/** Items still unsent after the try to send them first (0: all went). */
const mockSendWaiting = jest.fn(async () => 0);
jest.mock("@/features/account/service", () => ({
  claimThisDevicesReports: () => mockClaim(),
  signOutAccount: (...args: unknown[]) => mockSignOut(...args),
  sendWaitingItemsBeforeSignOut: () => mockSendWaiting(),
}));

const mockVerifyCode = jest.fn();
jest.mock("@/features/account/two-step", () => ({
  ...jest.requireActual("@/features/account/two-step"),
  verifyTwoStepCode: (code: string) => mockVerifyCode(code),
}));

let mockStatus = "account";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: mockStatus, userId: "u-admin" }),
}));

const mockRefresh = jest.fn();
jest.mock("@/features/account/use-two-step", () => ({
  useRefreshTwoStep: () => mockRefresh,
}));

// eslint-disable-next-line import/first -- must follow the mocks above
import TwoStepCodeScreen from "../account/two-step-code";

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
async function renderScreen(ui: ReactElement) {
  await act(async () => {
    render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
  });
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

describe("Enter your code (device signed in without its code)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStatus = "account";
    mockCanGoBack = true;
    mockVerifyCode.mockResolvedValue(undefined);
    mockClaim.mockResolvedValue(0);
    mockSignOut.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("verifies, moves this device's reports, refreshes and goes back", async () => {
    await renderScreen(<TwoStepCodeScreen />);
    await type("two-step-code-input", "123456");
    await press("two-step-verify");
    expect(mockVerifyCode).toHaveBeenCalledWith("123456");
    expect(mockClaim).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it("goes Home when there is nothing to go back to", async () => {
    mockCanGoBack = false;
    await renderScreen(<TwoStepCodeScreen />);
    await type("two-step-code-input", "123456");
    await press("two-step-verify");
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("'Use a different account' signs out and opens the sign-in form", async () => {
    await renderScreen(<TwoStepCodeScreen />);
    await press("two-step-other-account");
    expect(mockSendWaiting).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ sendFirst: false });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/account/sign-in",
      params: { mode: "signin" },
    });
    expect(mockVerifyCode).not.toHaveBeenCalled();
  });

  describe("[APP-04] with something still unsent", () => {
    let alertSpy: jest.SpyInstance;
    beforeEach(() => {
      mockSendWaiting.mockResolvedValueOnce(2);
      alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    });
    afterEach(() => alertSpy.mockRestore());

    function buttons(): AlertButton[] {
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0]?.[0]).toBe("Not sent yet");
      return (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    }

    it("asks first; 'Sign out anyway' signs out and opens the sign-in form", async () => {
      await renderScreen(<TwoStepCodeScreen />);
      await press("two-step-other-account");
      expect(mockSignOut).not.toHaveBeenCalled();
      await act(async () => {
        buttons()[1]?.onPress?.();
      });
      expect(mockSignOut).toHaveBeenCalledWith({ sendFirst: false });
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/account/sign-in",
        params: { mode: "signin" },
      });
    });

    it("Cancel keeps the session and the screen", async () => {
      await renderScreen(<TwoStepCodeScreen />);
      await press("two-step-other-account");
      await act(async () => {
        buttons()[0]?.onPress?.();
      });
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId("two-step-other-account")).toBeTruthy();
    });
  });

  it("'Lost your phone?' opens Feedback", async () => {
    await renderScreen(<TwoStepCodeScreen />);
    await press("two-step-contact-us");
    expect(mockPush).toHaveBeenCalledWith("/feedback");
  });

  it("no connection is said plainly and nothing else happens", async () => {
    const { AccountError } = jest.requireActual("@/features/account/types");
    mockVerifyCode.mockRejectedValueOnce(new AccountError("network"));
    await renderScreen(<TwoStepCodeScreen />);
    await type("two-step-code-input", "123456");
    await press("two-step-verify");
    expect(screen.getByText("No connection. Try again.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    // The typed code stays for another try (only a wrong code is cleared).
    expect(screen.getByTestId("two-step-code-input").props.value).toBe("123456");
  });

  it("a guest who lands here is asked to sign in", async () => {
    mockStatus = "anonymous";
    await renderScreen(<TwoStepCodeScreen />);
    expect(screen.queryByTestId("two-step-code-form")).toBeNull();
    await press("two-step-code-go-sign-in");
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/account/sign-in",
      params: { mode: "signin" },
    });
  });

  it("Sorani: the code field is a big left-to-right run of digits, Sorani keyboard digits accepted", async () => {
    await i18n.changeLanguage("ckb");
    await renderScreen(<TwoStepCodeScreen />);
    expect(screen.getByText("کۆدی ٦ ژمارەیی")).toBeTruthy();
    await type("two-step-code-input", "١٢٣٤٥٦");
    expect(screen.getByTestId("two-step-code-input").props.value).toBe("123456");
    await press("two-step-verify");
    expect(mockVerifyCode).toHaveBeenCalledWith("123456");
  });
});
