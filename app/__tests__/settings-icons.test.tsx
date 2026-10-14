import { render, screen, within } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

/**
 * Settings rows wear distinct icons (review B-28: "My location" and "Device
 * permissions" shared the same pin). Same mocks as
 * `settings-permissions.test.tsx`; Ionicons is stubbed to echo its `name`
 * as text (the real host drops the prop once rendered — see
 * `HeaderBackButton.test.tsx`).
 */

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "26.1.0" } },
}));

jest.mock("expo-linking", () => ({
  openSettings: jest.fn(),
  openURL: jest.fn(),
}));

jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  getForegroundPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
}));

jest.mock("expo-sensors", () => ({
  Accelerometer: {
    getPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
    requestPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
  },
}));

jest.mock("@expo/vector-icons/Ionicons", () => {
  const { createElement } = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ name, testID }: { name: string; testID?: string }) =>
      createElement(Text, { testID }, name),
  };
});

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

describe("Settings row icons", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  it("gives My location and Device permissions different icons (review B-28)", async () => {
    await renderWithProviders(<SettingsScreen />);

    const locationRow = screen.getByTestId("account-location-row");
    const permissionsRow = screen.getByTestId("settings-row-permissions");
    expect(within(locationRow).getByText("location-outline")).toBeTruthy();
    expect(within(permissionsRow).getByText("phone-portrait-outline")).toBeTruthy();
    expect(within(permissionsRow).queryByText("location-outline")).toBeNull();
  });
});
