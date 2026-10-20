/**
 * The onboarding alerts screen is the same on the web and in the phone app:
 * "Alerts are coming", Continue, and NO permission question on either. The
 * phone's one-time question belongs to the alert controls (turning alerts
 * on), as the screen's own text promises; asking here would spend it while
 * alerts are still "coming soon" (D83).
 */
import fs from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const mockRequestPermissions = jest.fn();
const mockGetPermissions = jest.fn();
jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: () => mockRequestPermissions(),
  getPermissionsAsync: () => mockGetPermissions(),
}));

// eslint-disable-next-line import/first -- imported after the mocks above
import OnboardingNotificationsScreen from "../../../../app/onboarding/notifications";

/** The screen's code, without its comments (which explain the rule). */
const CODE = fs
  .readFileSync(path.join(__dirname, "../../../../app/onboarding/notifications.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <OnboardingNotificationsScreen />
    </SafeAreaProvider>,
  );
}

const originalOS = Platform.OS;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mockPush.mockClear();
  mockRequestPermissions.mockClear();
  mockGetPermissions.mockClear();
  usePrefsStore.setState({ onboardingCompleted: false, onboardingStep: "notifications", hasHydrated: true });
});

afterEach(async () => {
  await cleanup();
  Platform.OS = originalOS;
});

it.each(["ios", "android", "web"] as const)(
  "%s: says alerts are coming and continues without asking for notification permission",
  async (os) => {
    Platform.OS = os;
    await renderScreen();
    expect(screen.getByText("Alerts are coming")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockPush).toHaveBeenCalledWith("/onboarding/done");
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetPermissions).not.toHaveBeenCalled();
  },
);

it("does not even load the notifications module", () => {
  expect(CODE).toContain("OnboardingScreenShell");
  expect(CODE).not.toMatch(/expo-notifications|features\/notifications|ensureNotificationPermission/);
});

it("Sorani: the same words in Sorani", async () => {
  Platform.OS = "ios";
  await i18n.changeLanguage("ckb");
  await renderScreen();
  expect(screen.getByText("ئاگادارکردنەوەکان لە ڕێگەن")).toBeTruthy();
  expect(mockRequestPermissions).not.toHaveBeenCalled();
});
