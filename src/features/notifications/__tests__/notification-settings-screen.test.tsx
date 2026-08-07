import { Alert } from "react-native";
import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

// Mirrors historical-screen.test.tsx's mock: this pushed screen renders a
// native `Stack.Screen` (title only, not part of the JS render tree) plus
// `useFocusEffect` (used by `useNotificationPermissionStatus`, same pattern
// as `use-location-permission-status.ts`). Both come from expo-router and
// need a stand-in outside a real navigator.
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    Stack: Object.assign(() => null, {
      Screen: (props: { options?: { title?: string } }) => {
        mockScreenOptions(props.options);
        return null;
      },
    }),
  };
});

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();

jest.mock("expo-notifications", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: () => mockGetPermissionsAsync(),
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) =>
    mockSetNotificationChannelAsync(...args),
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import NotificationSettingsScreen from "../../../../app/notification-settings";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Lets the permission-status focus effect's promise chain settle. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Notification Settings screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    mockGetPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockRequestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockScheduleNotificationAsync.mockResolvedValue("rehearsal-id");
    mockSetNotificationChannelAsync.mockResolvedValue(undefined);

    usePrefsStore.setState({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: null,
      nearMeTier: "m3",
      homeBaseTier: "off",
      hasHydrated: true,
    });
  });

  afterEach(async () => {
    cleanup();
    mockScreenOptions.mockClear();
    mockGetPermissionsAsync.mockClear();
    mockRequestPermissionsAsync.mockClear();
    mockScheduleNotificationAsync.mockClear();
    mockSetNotificationChannelAsync.mockClear();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders both the Near Me and HomeBase sections under the Sorani (RTL) locale", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();

    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "ڕێکخستنی ئاگادارکردنەوە" }),
    );
    expect(screen.getByText("نزیک من")).toBeTruthy();
    expect(screen.getByText("بنکەی ماڵەوە")).toBeTruthy();
    expect(screen.getByText("تاقیبکەرەوە")).toBeTruthy();
  });

  it("selecting a tier for Near Me updates the store", async () => {
    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();

    expect(usePrefsStore.getState().nearMeTier).toBe("m3");

    fireEvent.press(
      screen.getAllByRole("radio", { name: "M5.0 and above" })[0]!,
    );

    expect(usePrefsStore.getState().nearMeTier).toBe("m5");
  });

  it("disables the HomeBase tier selector when no HomeBase is set", async () => {
    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();

    const [nearMeAllRow, homeBaseAllRow] = screen.getAllByRole("radio", {
      name: "All earthquakes",
    });
    expect(nearMeAllRow?.props.accessibilityState.disabled).toBeFalsy();
    expect(homeBaseAllRow?.props.accessibilityState.disabled).toBe(true);

    // Pressing a disabled row is a no-op — homeBaseTier stays 'off'.
    fireEvent.press(homeBaseAllRow!);
    expect(usePrefsStore.getState().homeBaseTier).toBe("off");

    expect(screen.getByText("Set a HomeBase above to turn on these alerts.")).toBeTruthy();
  });

  it("enables the HomeBase tier selector once a HomeBase town is set", async () => {
    usePrefsStore.setState({
      homeBase: { townId: "erbil", lat: 36.19, lon: 44.01 },
      homeBaseTier: "all",
    });

    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();

    const homeBaseAllRow = screen.getAllByRole("radio", { name: "All earthquakes" })[1];
    expect(homeBaseAllRow?.props.accessibilityState.disabled).toBeFalsy();
    expect(
      screen.queryByText("Set a HomeBase above to turn on these alerts."),
    ).toBeNull();
  });

  it("'See the alert' opens a pure-UI rehearsal modal with no permission call", async () => {
    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();
    mockGetPermissionsAsync.mockClear();
    mockRequestPermissionsAsync.mockClear();

    // Awaited (unlike the store-only presses elsewhere in this file) because
    // this assertion depends on the resulting LOCAL re-render (the modal's
    // visible-content tree), not just a synchronous store write.
    await fireEvent.press(screen.getByRole("button", { name: "See the alert" }));

    expect(screen.getByText("M 4.8 earthquake")).toBeTruthy();
    expect(screen.getByText("14 km southeast of Erbil, Kurdistan Region")).toBeTruthy();
    // Pure UI preview — never touches the notification permission APIs.
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("'Play the alert sound' requests permission if needed, then schedules a real local notification after the hint alert", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
      buttons?.[0]?.onPress?.();
    });

    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();

    fireEvent.press(screen.getByRole("button", { name: "Play the alert sound" }));
    await flush();

    expect(alertSpy).toHaveBeenCalledWith(
      "Play the alert sound",
      expect.stringContaining("background"),
      expect.any(Array),
    );
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: "M 4.8 earthquake",
          body: "14 km southeast of Erbil, Kurdistan Region",
        }),
      }),
    );

    alertSpy.mockRestore();
  });

  it("shows the settings-link row once notification permission is denied", async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: "denied" });

    await renderWithProviders(<NotificationSettingsScreen />);
    await flush();

    expect(
      screen.getByText("Notifications are blocked for Bumelerze on this device."),
    ).toBeTruthy();
  });
});
