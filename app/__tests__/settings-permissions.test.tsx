import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

/**
 * Settings screen — the new "My Data" link row (D26 item 7) and the new
 * "Permissions & data" section (D26 item 6). Mirrors
 * `notification-settings-screen.test.tsx`'s `expo-router` mock shape
 * (`useFocusEffect` stood in as a plain `useEffect`, matching
 * `use-permission-row.ts`'s own re-check-on-focus wiring) plus mocks for
 * `expo-location`/`expo-sensors` (the two native permission APIs this wave
 * wires up) and `expo-linking` (the "open system settings" action, already
 * used by the pre-existing `LocationPermissionSection` this wave leaves
 * untouched).
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
jest.mock("expo-linking", () => ({
  openSettings: () => mockOpenSettings(),
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

describe("Settings screen — My Data + Permissions", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockOpenSettings.mockClear();
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
    await i18n.changeLanguage(originalLanguage);
  });

  it("navigates to /my-data when the My Data row is pressed", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("My data")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open My Data" }));

    expect(mockPush).toHaveBeenCalledWith("/my-data");
  });

  it("shows 'Not asked yet' and an Allow action for an undetermined location permission, and requests it on tap", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    // Two "Not asked yet" rows exist: the pre-existing LocationPermissionSection
    // uses its own wording, and the new Permissions & data section's two rows
    // (location + motion) both start undetermined in this test.
    const notAskedYetTexts = screen.getAllByText("Not asked yet");
    expect(notAskedYetTexts.length).toBeGreaterThanOrEqual(2);

    const allowButtons = screen.getAllByRole("button", { name: "Allow" });
    expect(allowButtons).toHaveLength(2);

    await fireEvent.press(allowButtons[0]!);
    await flush();

    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Allowed").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Open Settings' for a denied location permission, and opens system settings on tap", async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    await renderWithProviders(<SettingsScreen />);
    await flush();

    // "Open Settings" appears once for the pre-existing LocationPermissionSection
    // (always visible once resolved) and again for the new denied location row.
    const openSettingsButtons = screen.getAllByRole("button", { name: "Open Settings" });
    expect(openSettingsButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.press(openSettingsButtons[0]!);
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("requests motion permission on tap when undetermined, and reflects the granted result", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    const allowButtons = screen.getAllByRole("button", { name: "Allow" });
    // Second Allow button belongs to the motion row (location row is first).
    await fireEvent.press(allowButtons[1]!);
    await flush();

    expect(mockAccelRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("shows the WHY explanations for both permission rows", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(
      screen.getByText("Your felt reports carry where you felt the shaking."),
    ).toBeTruthy();
    expect(
      screen.getByText("Powers the live seismogram on the Sensor screen."),
    ).toBeTruthy();
  });

  describe("on web", () => {
    const originalPlatformOS = Platform.OS;

    beforeAll(() => {
      Platform.OS = "web";
    });

    afterAll(() => {
      Platform.OS = originalPlatformOS;
    });

    it("shows a link to the Sensor screen instead of a status/request row for motion", async () => {
      await renderWithProviders(<SettingsScreen />);
      await flush();

      expect(
        screen.getByText("Motion access is granted from the Sensor screen itself on this browser."),
      ).toBeTruthy();
      // Only the location row's own "Allow" affordance shows on web — the
      // motion row shows the web hint/link instead, never the native
      // status/Allow affordance, regardless of whatever
      // `useMotionPermissionRow` resolved internally (that hook's own status
      // is simply never read on web).
      expect(screen.getAllByRole("button", { name: "Allow" })).toHaveLength(1);

      fireEvent.press(screen.getByRole("button", { name: "Open Sensor screen" }));
      expect(mockPush).toHaveBeenCalledWith("/(tabs)/sensor");
    });
  });
});
