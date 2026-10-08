import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Alert, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

/**
 * Settings screen — the Safety guide / handbook / My location rows (D79) and
 * the consolidated "Device permissions" section (wave brief Part 3: "ONE
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

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "26.1.0" } },
}));

const mockOpenSettings = jest.fn();
const mockOpenURL = jest.fn();
jest.mock("expo-linking", () => ({
  openSettings: () => mockOpenSettings(),
  openURL: (url: string) => mockOpenURL(url),
}));

const mockGetForegroundPermissionsAsync = jest.fn();
const mockRequestForegroundPermissionsAsync = jest.fn();
jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
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
import SettingsScreen from "../(tabs)/(settings)/settings";

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

/** Opens the Device permissions row (its body is collapsed by default). */
async function openPermissions() {
  await fireEvent.press(screen.getByTestId("settings-row-permissions"));
}

describe("Settings screen — grouped rows + Device permissions", () => {
  const originalLanguage = i18n.language;
  const originalPlatformOS = Platform.OS;

  beforeEach(async () => {
    mockPush.mockClear();
    mockOpenSettings.mockClear();
    mockOpenURL.mockClear();
    mockGetForegroundPermissionsAsync
      .mockReset()
      .mockResolvedValue({ status: "undetermined" });
    mockRequestForegroundPermissionsAsync
      .mockReset()
      .mockResolvedValue({ status: "granted" });
    mockAccelGetPermissionsAsync
      .mockReset()
      .mockResolvedValue({ status: "undetermined" });
    mockAccelRequestPermissionsAsync.mockReset().mockResolvedValue({ status: "granted" });

    usePrefsStore.setState({
      onboardingCompleted: true,
      onboardingStep: "done",
      referencePlace: null,
      nearMeTier: "m3",
      anotherPlaceTier: "off",
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

  it("opens the Safety guide from the first row, and no longer has a My account row", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    // The Safety guide left the tab bar (D79); it is the first row here.
    expect(screen.getByText("Safety guide")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("settings-row-safety"));
    expect(mockPush).toHaveBeenCalledWith("/safety");

    // My account became the Profile tab: no row for it, no HomeBase either.
    expect(screen.queryByText("My account")).toBeNull();
    expect(screen.queryByTestId("settings-row-account")).toBeNull();
    expect(screen.queryByText("HomeBase")).toBeNull();
  });

  it("navigates to /feedback when the Feedback row is pressed", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("Feedback")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("settings-row-feedback"));

    expect(mockPush).toHaveBeenCalledWith("/feedback");
  });

  it("shows one combined Allow button and 'Not asked yet' for both permissions when undetermined", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();
    await openPermissions();

    expect(screen.getAllByText("Not asked yet")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Allow device permissions" })).toBeTruthy();
  });

  it("chains both requests from a single tap and reflects the granted result", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();
    await openPermissions();

    await fireEvent.press(
      screen.getByRole("button", { name: "Allow device permissions" }),
    );
    await flush();

    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Allowed")).toHaveLength(2);
    // Once everything is granted the button disappears (nothing left to ask).
    expect(screen.queryByRole("button", { name: "Allow device permissions" })).toBeNull();
  });

  it("invokes both underlying permission calls synchronously, before either resolves", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();
    await openPermissions();

    // Neither mock has been given a chance to resolve yet (no `await` since
    // the tap), but both must already have been *called* — this is the
    // property `use-device-permissions.ts` depends on for the web
    // motion-permission gesture requirement (see its doc comment): calling
    // `request()` for location and then motion back to back, with no
    // `await` between them, keeps both underlying browser/native calls
    // inside the same synchronous tap.
    await fireEvent.press(
      screen.getByRole("button", { name: "Allow device permissions" }),
    );

    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);

    await flush();
  });

  it("shows a native 'Open Settings' action when a permission is denied, and opens system settings on tap", async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    await renderWithProviders(<SettingsScreen />);
    await flush();
    await openPermissions();

    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("shows a minimal footer about Bumelerze and no About screen", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByTestId("settings-footer")).toBeTruthy();
    expect(screen.getByText(/independent earthquake monitoring system/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toBeTruthy();
    expect(screen.getByText("Earthquake data: USGS, EMSC and GEOFON.")).toBeTruthy();
    expect(screen.getByText("Version 26.1.0")).toBeTruthy();
    expect(screen.getByText(/trademarks of the project/)).toBeTruthy();
    // No activity/presence line in the footer (owner, 2026-10-08).
    expect(screen.queryByTestId("settings-footer-presence")).toBeNull();
    expect(screen.queryByText(/Once a day/)).toBeNull();
    // No About row or screen (owner, 2026-10-08).
    expect(screen.queryByTestId("settings-row-about")).toBeNull();
    expect(screen.queryByText("About Bumelerze")).toBeNull();
  });

  it("shows the owner's short subtitles and no long section paragraphs", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("Before, during and after an earthquake")).toBeTruthy();
    expect(screen.getByText("Design values for engineers")).toBeTruthy();
    expect(screen.getByText("Location and motion sensor")).toBeTruthy();
    expect(screen.getByText("Bugs and ideas")).toBeTruthy();
    // Notifications, Language, Appearance and Replay onboarding carry no
    // subtitle; the old paragraphs are gone.
    expect(screen.queryByText(/Choose which earthquakes/)).toBeNull();
    expect(screen.queryByText(/Replays the welcome screens/)).toBeNull();
    expect(screen.queryByText(/restarts the app/)).toBeNull();
  });

  it("keeps the groups in order: guides, then this device (My location first), then help", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    const order = screen
      .getAllByTestId(/^(settings-row-|account-location-row$)/)
      .map((node) => node.props.testID as string);
    expect(order).toEqual([
      "settings-row-safety",
      "settings-row-handbook",
      "account-location-row",
      "settings-row-notifications",
      "settings-row-permissions",
      "settings-row-language",
      "settings-row-appearance",
      "settings-row-feedback",
      "settings-row-tour",
      "settings-row-onboarding",
    ]);
    expect(screen.getByText("My location")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("settings-row-handbook"));
    expect(mockPush).toHaveBeenCalledWith("/handbook");
    await fireEvent.press(screen.getByTestId("settings-row-notifications"));
    expect(mockPush).toHaveBeenCalledWith("/notification-settings");
  });

  it("opens the app tour from the App tour row, next to Replay onboarding", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("App tour")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("settings-row-tour"));
    expect(mockPush).toHaveBeenCalledWith("/tour");
  });

  it("shows the current language as the row value and lists the options when opened", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByLabelText("Language, English")).toBeTruthy();
    expect(screen.queryByText("Sorani Kurdish (کوردیی ناوەندی)")).toBeNull();
    await fireEvent.press(screen.getByTestId("settings-row-language"));
    expect(screen.getByText("Sorani Kurdish (کوردیی ناوەندی)")).toBeTruthy();
    expect(screen.getByText("Arabic (العربية)")).toBeTruthy();
  });

  it("asks before replaying onboarding", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderWithProviders(<SettingsScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId("settings-row-onboarding"));
    expect(alertSpy).toHaveBeenCalledWith(
      "Replay onboarding?",
      expect.any(String),
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  describe("on web", () => {
    beforeEach(() => {
      Platform.OS = "web";
    });

    it("shows the web denied hint instead of a system-settings deep link when a permission is denied", async () => {
      mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

      await renderWithProviders(<SettingsScreen />);
      await flush();
      await openPermissions();

      expect(
        screen.getByText(
          "Some permissions are off. Allow them in your browser settings.",
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
    });

    it("still chains both permission requests from the one combined button", async () => {
      await renderWithProviders(<SettingsScreen />);
      await flush();
      await openPermissions();

      await fireEvent.press(
        screen.getByRole("button", { name: "Allow device permissions" }),
      );
      await flush();

      expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });
});
