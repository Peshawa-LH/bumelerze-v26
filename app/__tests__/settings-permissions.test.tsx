import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

/**
 * Settings screen — the "My Data" link row (D26 item 7) and the
 * consolidated "Device permissions" section (wave brief Part 3: "ONE
 * button ... location, sensor, and other permissions", no separate
 * per-permission ask). Mirrors `notification-settings-screen.test.tsx`'s
 * `expo-router` mock shape (`useFocusEffect` stood in as a plain
 * `useEffect`, matching `use-permission-row.ts`'s own re-check-on-focus
 * wiring) plus mocks for `expo-location`/`expo-sensors` (the two native
 * permission APIs the combined button chains) and `expo-linking` (the
 * "open system settings" action and the footer's privacy-policy link).
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: mockPush }),
  };
});

const mockOpenSettings = jest.fn();
const mockOpenURL = jest.fn();
jest.mock("expo-linking", () => ({
  openSettings: () => mockOpenSettings(),
  openURL: (url: string) => mockOpenURL(url),
}));

const mockGetForegroundPermissionsAsync = jest.fn();
const mockRequestForegroundPermissionsAsync = jest.fn();
jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  getForegroundPermissionsAsync: () => mockGetForegroundPermissionsAsync(),
  requestForegroundPermissionsAsync: () => mockRequestForegroundPermissionsAsync(),
}));

const mockAccelGetPermissionsAsync = jest.fn();
const mockAccelRequestPermissionsAsync = jest.fn();
jest.mock("expo-sensors", () => ({
  Accelerometer: {
    getPermissionsAsync: () => mockAccelGetPermissionsAsync(),
    requestPermissionsAsync: () => mockAccelRequestPermissionsAsync(),
  },
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import SettingsScreen from "../(tabs)/settings";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Lets every focus-effect permission check's promise chain settle. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Settings screen — My Data + Device permissions", () => {
  const originalLanguage = i18n.language;
  const originalPlatformOS = Platform.OS;

  beforeEach(async () => {
    mockPush.mockClear();
    mockOpenSettings.mockClear();
    mockOpenURL.mockClear();
    mockGetForegroundPermissionsAsync.mockReset().mockResolvedValue({ status: "undetermined" });
    mockRequestForegroundPermissionsAsync.mockReset().mockResolvedValue({ status: "granted" });
    mockAccelGetPermissionsAsync.mockReset().mockResolvedValue({ status: "undetermined" });
    mockAccelRequestPermissionsAsync.mockReset().mockResolvedValue({ status: "granted" });

    usePrefsStore.setState({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: null,
      nearMeTier: "m3",
      homeBaseTier: "off",
      hasHydrated: true,
    });

    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    Platform.OS = originalPlatformOS;
    await i18n.changeLanguage(originalLanguage);
  });

  it("navigates to /my-data when the My Data row is pressed", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("My data")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open My Data" }));

    expect(mockPush).toHaveBeenCalledWith("/my-data");
  });

  it("navigates to /feedback, tagged with screen: 'settings', when the Feedback row is pressed", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("Feedback")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Give feedback" }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/feedback",
      params: { screen: "settings" },
    });
  });

  it("shows one combined Allow button and 'Not asked yet' for both permissions when undetermined", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getAllByText("Not asked yet")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Allow device permissions" }),
    ).toBeTruthy();
  });

  it("chains both requests from a single tap and reflects the granted result", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    await fireEvent.press(screen.getByRole("button", { name: "Allow device permissions" }));
    await flush();

    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Allowed")).toHaveLength(2);
    // Once everything is granted the button disappears (nothing left to ask).
    expect(
      screen.queryByRole("button", { name: "Allow device permissions" }),
    ).toBeNull();
  });

  it("invokes both underlying permission calls synchronously, before either resolves", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    // Neither mock has been given a chance to resolve yet (no `await` since
    // the tap), but both must already have been *called* — this is the
    // property `use-device-permissions.ts` depends on for the web
    // motion-permission gesture requirement (see its doc comment): calling
    // `request()` for location and then motion back to back, with no
    // `await` between them, keeps both underlying browser/native calls
    // inside the same synchronous tap.
    fireEvent.press(screen.getByRole("button", { name: "Allow device permissions" }));

    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);

    await flush();
  });

  it("shows a native 'Open Settings' action when a permission is denied, and opens system settings on tap", async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the footer's about text, attribution, trademark line, and a privacy-policy link", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(
      screen.getByText(/independent earthquake monitoring project/),
    ).toBeTruthy();
    expect(screen.getByText(/licensed under CC BY 4.0/)).toBeTruthy();
    expect(
      screen.getByText('"Bumelerze" and its logo are trademarks of the project.'),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole("link", { name: "Privacy policy" }));
    expect(mockOpenURL).toHaveBeenCalledWith("https://bumelerze.com/privacy.html");
  });

  it("shows a clarifying subtitle under the onboarding replay row", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(
      screen.getByText(
        "Replays the welcome screens you saw the first time you opened Bumelerze. Your language and HomeBase choices are kept.",
      ),
    ).toBeTruthy();
  });

  describe("on web", () => {
    beforeEach(() => {
      Platform.OS = "web";
    });

    it("shows the web denied hint instead of a system-settings deep link when a permission is denied", async () => {
      mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

      await renderWithProviders(<SettingsScreen />);
      await flush();

      expect(
        screen.getByText(
          "Some permissions are off. Check this site's permissions in your browser settings to turn them on.",
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
    });

    it("still chains both permission requests from the one combined button", async () => {
      await renderWithProviders(<SettingsScreen />);
      await flush();

      await fireEvent.press(screen.getByRole("button", { name: "Allow device permissions" }));
      await flush();

      expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });
});
