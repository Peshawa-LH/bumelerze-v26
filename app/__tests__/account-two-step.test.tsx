import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

/**
 * My account > Two-step sign-in (security checklist A0.1): the setup with
 * the approved English wording, turning on with the first code, the wrong
 * code, the On state and turning off, and who may open it at all.
 */

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: mockPush,
    canGoBack: () => true,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockQr = jest.fn();
jest.mock("react-native-qrcode-svg", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockQr(props);
    return null;
  },
}));

const mockSetString = jest.fn();
jest.mock("expo-clipboard", () => ({
  setStringAsync: (text: string) => mockSetString(text),
}));

const mockStart = jest.fn();
const mockConfirm = jest.fn();
const mockAbandon = jest.fn();
const mockTurnOff = jest.fn();
jest.mock("@/features/account/two-step", () => ({
  ...jest.requireActual("@/features/account/two-step"),
  startTwoStepSetup: () => mockStart(),
  confirmTwoStepSetup: (factorId: string, code: string) => mockConfirm(factorId, code),
  abandonTwoStepSetup: (factorId: string) => mockAbandon(factorId),
  turnOffTwoStep: (code: string) => mockTurnOff(code),
}));

let mockStatus = "account";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: mockStatus, userId: "u-admin" }),
}));

let mockOffer = { offered: true, enabled: false, isLoading: false };
const mockRefresh = jest.fn();
jest.mock("@/features/account/use-two-step", () => ({
  useTwoStepOffer: () => mockOffer,
  useRefreshTwoStep: () => mockRefresh,
}));

// eslint-disable-next-line import/first -- must follow the mocks above
import TwoStepScreen from "../account/two-step";
// eslint-disable-next-line import/first -- must follow the mocks above
import { AccountError } from "@/features/account/types";

const SETUP = {
  kind: "setup",
  factorId: "factor-new",
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  uri: "otpauth://totp/Bumelerze:a@b.co?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Bumelerze",
};

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
async function unmount() {
  await act(async () => {
    await screen.unmount();
  });
}
function disabled(testID: string): boolean {
  return screen.getByTestId(testID).props.accessibilityState?.disabled === true;
}

describe("Two-step sign-in screen", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStatus = "account";
    mockOffer = { offered: true, enabled: false, isLoading: false };
    mockStart.mockResolvedValue(SETUP);
    mockConfirm.mockResolvedValue(undefined);
    mockTurnOff.mockResolvedValue(undefined);
    mockAbandon.mockResolvedValue(undefined);
    mockSetString.mockResolvedValue(true);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("off: setting it up", () => {
    it("shows the approved steps, the QR code of the authenticator link and the key", async () => {
      await renderScreen(<TwoStepScreen />);
      expect(mockStart).toHaveBeenCalledTimes(1);
      for (const text of [
        "Adds a second check when you sign in: a 6-digit code from an authenticator app on your phone. It protects the admin tools if someone learns your password.",
        "Open an authenticator app (for example Google Authenticator, Microsoft Authenticator or Apple Passwords) and scan this code.",
        "Can't scan it? Enter this key instead:",
        "Enter the 6-digit code the app shows.",
        "6-digit code",
        "Turn on",
        "Copy key",
      ]) {
        expect(screen.getByText(text)).toBeTruthy();
      }
      expect(mockQr).toHaveBeenCalledWith(expect.objectContaining({ value: SETUP.uri }));
      expect(screen.getByTestId("two-step-qr").props.accessibilityLabel).toBe(
        "QR code for your authenticator app",
      );
      // In groups of four, selectable.
      const key = screen.getByTestId("two-step-key");
      expect(key.props.children).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
      expect(key.props.selectable).toBe(true);
    });

    it("Copy key copies the key without the spaces", async () => {
      await renderScreen(<TwoStepScreen />);
      await press("two-step-copy-key");
      expect(mockSetString).toHaveBeenCalledWith(SETUP.secret);
      expect(screen.getByTestId("two-step-key-copied")).toBeTruthy();
    });

    it("turns on with the first code from the new key", async () => {
      await renderScreen(<TwoStepScreen />);
      expect(disabled("two-step-turn-on")).toBe(true);
      await type("two-step-setup-code-input", "12345");
      expect(disabled("two-step-turn-on")).toBe(true);
      await type("two-step-setup-code-input", "123456");
      await press("two-step-turn-on");

      expect(mockConfirm).toHaveBeenCalledWith("factor-new", "123456");
      expect(
        screen.getByText(
          "Two-step sign-in is on. You'll be asked for a code when you sign in.",
        ),
      ).toBeTruthy();
      expect(mockRefresh).toHaveBeenCalled();
      await press("two-step-done");
      expect(mockBack).toHaveBeenCalled();
      // A key that was turned on is never removed on leaving.
      await unmount();
      expect(mockAbandon).not.toHaveBeenCalled();
    });

    it("a wrong code says what to check, empties the field and keeps the key", async () => {
      mockConfirm.mockRejectedValueOnce(new AccountError("wrong_code"));
      await renderScreen(<TwoStepScreen />);
      await type("two-step-setup-code-input", "000000");
      await press("two-step-turn-on");
      expect(
        screen.getByText(
          "That code didn't work. Check that your phone's time is right and try the newest code.",
        ),
      ).toBeTruthy();
      expect(screen.getByTestId("two-step-setup-code-input").props.value).toBe("");
      expect(screen.getByTestId("two-step-key")).toBeTruthy();
    });

    it("leaving before a code removes the unverified key again", async () => {
      await renderScreen(<TwoStepScreen />);
      await unmount();
      expect(mockAbandon).toHaveBeenCalledWith("factor-new");
    });

    it("no connection: a plain message and Retry, which starts again", async () => {
      mockStart.mockRejectedValueOnce(new AccountError("network"));
      await renderScreen(<TwoStepScreen />);
      expect(screen.getByText("No connection. Try again.")).toBeTruthy();
      await press("two-step-retry");
      expect(mockStart).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("two-step-setup")).toBeTruthy();
    });
  });

  describe("on: turning it off", () => {
    beforeEach(() => {
      mockOffer = { offered: true, enabled: true, isLoading: false };
      mockStart.mockResolvedValue({ kind: "alreadyOn" });
    });

    it("says it is on, with Turn off and the lost-phone way out", async () => {
      await renderScreen(<TwoStepScreen />);
      expect(screen.getByText("Two-step sign-in is on.")).toBeTruthy();
      expect(screen.queryByTestId("two-step-qr")).toBeNull();
      expect(
        screen.getByText(
          "Lost your phone? Contact us through Feedback. We'll check it's you and remove the old code.",
        ),
      ).toBeTruthy();
      await press("two-step-contact-us");
      expect(mockPush).toHaveBeenCalledWith("/feedback");
    });

    it("asks for a code, then turns it off", async () => {
      await renderScreen(<TwoStepScreen />);
      await press("two-step-turn-off");
      expect(
        screen.getByText("Enter a code from your authenticator app to turn it off."),
      ).toBeTruthy();
      expect(disabled("two-step-off-confirm")).toBe(true);
      await type("two-step-off-code-input", "٦٥٤٣٢١");
      await press("two-step-off-confirm");
      expect(mockTurnOff).toHaveBeenCalledWith("654321");
      expect(screen.getByText("Two-step sign-in is off.")).toBeTruthy();
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("a wrong code turns nothing off", async () => {
      mockTurnOff.mockRejectedValueOnce(new AccountError("wrong_code"));
      await renderScreen(<TwoStepScreen />);
      await press("two-step-turn-off");
      await type("two-step-off-code-input", "000000");
      await press("two-step-off-confirm");
      expect(screen.getByTestId("two-step-error")).toBeTruthy();
      expect(screen.queryByText("Two-step sign-in is off.")).toBeNull();
    });
  });

  it("is not offered without admin tools: sent to Settings, no key is made", async () => {
    mockOffer = { offered: false, enabled: false, isLoading: false };
    await renderScreen(<TwoStepScreen />);
    expect(mockReplace).toHaveBeenCalledWith("/settings");
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("waits for the permissions before deciding", async () => {
    mockOffer = { offered: false, enabled: false, isLoading: true };
    await renderScreen(<TwoStepScreen />);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("a guest is asked to sign in", async () => {
    mockStatus = "anonymous";
    mockOffer = { offered: false, enabled: false, isLoading: false };
    await renderScreen(<TwoStepScreen />);
    expect(screen.getByText("Please sign in first.")).toBeTruthy();
    await press("two-step-go-sign-in");
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/account/sign-in",
      params: { mode: "signin" },
    });
  });

  it("reads right to left in Sorani with the code and key still left to right", async () => {
    await i18n.changeLanguage("ckb");
    await renderScreen(<TwoStepScreen />);
    expect(screen.getByText("کۆدی ٦ ژمارەیی")).toBeTruthy();
    const key = screen.getByTestId("two-step-key");
    const style = [key.props.style].flat(3);
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ writingDirection: "ltr" })]));
    const input = screen.getByTestId("two-step-setup-code-input");
    expect([input.props.style].flat(3)).toEqual(
      expect.arrayContaining([expect.objectContaining({ writingDirection: "ltr" })]),
    );
  });
});
