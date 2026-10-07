import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";
import { useThemePreferencesStore } from "@/theme";

/**
 * Settings screen — the Appearance section (owner directive, 2026-09-27:
 * "in Settings ... 3 buttons: Automatic (the default, follows the system)
 * or manually Light / Dark"). Same `expo-router`/`expo-linking`/
 * `expo-location`/`expo-sensors` mock shape as
 * `settings-permissions.test.tsx` — this screen renders every section on
 * one tree, so all of its native-module imports need a stand-in even for a
 * test that only exercises Appearance.
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

jest.mock("expo-linking", () => ({
  openSettings: () => Promise.resolve(),
  openURL: () => Promise.resolve(),
}));

jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  getForegroundPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: "granted" }),
}));

jest.mock("expo-sensors", () => ({
  Accelerometer: {
    getPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
    requestPermissionsAsync: () => Promise.resolve({ status: "granted" }),
  },
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import SettingsScreen from "../(tabs)/settings";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Lets every focus-effect permission check's promise chain settle. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Presses an element and flushes the microtasks its `onPress` kicks off, in
 * one `act()` scope — matches
 * `src/features/sensor/__tests__/sensor-screen-web.test.tsx`'s
 * `pressAndFlush` (see its doc comment for why press + flush must share one
 * `act()` rather than a bare `fireEvent.press` followed by a separate
 * `await flush()`).
 */
async function pressAndFlush(element: ReturnType<typeof screen.getByRole>) {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Settings screen — Appearance", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    usePrefsStore.setState({
      onboardingCompleted: true,
      onboardingStep: "done",
      referencePlace: null,
      nearMeTier: "m3",
      anotherPlaceTier: "off",
      hasHydrated: true,
    });
    useThemePreferencesStore.setState({ preference: "auto", hasHydrated: true });

    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    useThemePreferencesStore.setState({ preference: "auto" });
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the three appearance options with Automatic selected by default", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    expect(screen.getByText("Appearance")).toBeTruthy();
    // The row shows the current choice inline and opens in place.
    expect(screen.queryByRole("radio", { name: "Dark" })).toBeNull();
    await fireEvent.press(screen.getByTestId("settings-row-appearance"));
    const autoButton = screen.getByRole("radio", { name: "Automatic" });
    const lightButton = screen.getByRole("radio", { name: "Light" });
    const darkButton = screen.getByRole("radio", { name: "Dark" });

    expect(autoButton).toBeTruthy();
    expect(lightButton).toBeTruthy();
    expect(darkButton).toBeTruthy();
    expect(autoButton.props.accessibilityState?.selected).toBe(true);
    expect(lightButton.props.accessibilityState?.selected).toBe(false);
    expect(darkButton.props.accessibilityState?.selected).toBe(false);
  });

  it("uses the same option list as Language (vertical rows, selected one highlighted and bold)", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    // Only one row is open at a time, so read Appearance first, then Language.
    await fireEvent.press(screen.getByTestId("settings-row-appearance"));
    const selected = StyleSheet.flatten(
      screen.getByTestId("settings-appearance-option-auto").props.style,
    );
    const unselected = StyleSheet.flatten(
      screen.getByTestId("settings-appearance-option-dark").props.style,
    );
    const selectedLabel = StyleSheet.flatten(
      within(screen.getByTestId("settings-appearance-option-auto")).getByText("Automatic")
        .props.style,
    );
    await fireEvent.press(screen.getByTestId("settings-row-language"));
    const languageSelected = StyleSheet.flatten(
      screen.getByTestId("settings-language-option-en").props.style,
    );

    expect(selected.backgroundColor).toBe(languageSelected.backgroundColor);
    expect(selected.backgroundColor).not.toBe("transparent");
    expect(selected.minHeight).toBe(languageSelected.minHeight);
    expect(selected.borderRadius).toBe(languageSelected.borderRadius);
    expect(selectedLabel.fontWeight).toBe("700");
    expect(unselected.backgroundColor).toBe("transparent");
  });

  it("selects Dark and updates the store when pressed", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId("settings-row-appearance"));
    await pressAndFlush(screen.getByRole("radio", { name: "Dark" }));

    expect(useThemePreferencesStore.getState().preference).toBe("dark");
    expect(
      screen.getByRole("radio", { name: "Dark" }).props.accessibilityState?.selected,
    ).toBe(true);
    expect(
      screen.getByRole("radio", { name: "Automatic" }).props.accessibilityState?.selected,
    ).toBe(false);
  });

  it("selects Light and updates the store when pressed", async () => {
    await renderWithProviders(<SettingsScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId("settings-row-appearance"));
    await pressAndFlush(screen.getByRole("radio", { name: "Light" }));

    expect(useThemePreferencesStore.getState().preference).toBe("light");
  });
});
