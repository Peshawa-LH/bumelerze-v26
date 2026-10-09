/**
 * Notification Settings under the alert rollout (migration 0062, D83): the
 * public keeps "Alerts are coming soon" above the settings it had; testers
 * (and everyone once public) see the real controls with a Tester chip only
 * for testers; nothing is shown while the answer is loading.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import type { UseAlertAccess } from "../queries";

let mockAccess: UseAlertAccess = {
  mode: "testers",
  tester: false,
  enabled: false,
  canManage: false,
  isLoading: false,
};

jest.mock("@/features/alerts/queries", () => {
  const actual = jest.requireActual("@/features/alerts/queries");
  return { ...actual, useAlertAccess: () => mockAccess };
});

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    Stack: Object.assign(() => null, { Screen: () => null }),
  };
});

jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied" },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => Promise.resolve({ status: "denied" }),
  getLastKnownPositionAsync: () => Promise.resolve(null),
  getCurrentPositionAsync: () => Promise.resolve(null),
}));

jest.mock("expo-notifications", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
  requestPermissionsAsync: () => Promise.resolve({ status: "granted" }),
  scheduleNotificationAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}));

// eslint-disable-next-line import/first -- imported after the mocks above
import NotificationSettingsScreen from "../../../../app/(tabs)/(home,map,sensor,profile,settings)/notification-settings";

function renderScreen(ui: ReactElement = <NotificationSettingsScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

function access(over: Partial<UseAlertAccess>) {
  mockAccess = { mode: "testers", tester: false, enabled: false, canManage: false, isLoading: false, ...over };
}

describe("Notification Settings under the alert rollout", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("the public (testers-only rollout): coming soon, the old settings, no tester controls", async () => {
    access({});
    await renderScreen();
    expect(screen.getByTestId("alerts-coming-soon")).toBeTruthy();
    expect(screen.getByText("Alerts are coming")).toBeTruthy();
    expect(screen.getByText("Near Me")).toBeTruthy();
    expect(screen.queryByTestId("alerts-tester-panel")).toBeNull();
    expect(screen.queryByTestId("alerts-tester-chip")).toBeNull();
    expect(screen.queryByText("Send me a test alert")).toBeNull();
  });

  it("a tester: the real controls and the Tester chip, no coming soon", async () => {
    access({ tester: true, enabled: true });
    await renderScreen();
    expect(screen.getByTestId("alerts-tester-panel")).toBeTruthy();
    expect(screen.getByTestId("alerts-tester-chip")).toBeTruthy();
    expect(screen.getByText("Tester")).toBeTruthy();
    expect(screen.getByText("Send me a test alert")).toBeTruthy();
    expect(screen.queryByTestId("alerts-coming-soon")).toBeNull();
    // the tiers and places are still there
    expect(screen.getByText("Near Me")).toBeTruthy();
  });

  it("once public: everyone gets the controls, without the Tester chip", async () => {
    access({ mode: "public", enabled: true });
    await renderScreen();
    expect(screen.getByTestId("alerts-tester-panel")).toBeTruthy();
    expect(screen.queryByTestId("alerts-tester-chip")).toBeNull();
    expect(screen.queryByTestId("alerts-coming-soon")).toBeNull();
  });

  it("paused (off): a tester is told sending is paused", async () => {
    access({ mode: "off", tester: true, enabled: true });
    await renderScreen();
    expect(screen.getByTestId("alerts-paused")).toBeTruthy();
  });

  it("while loading: neither the note nor the controls", async () => {
    access({ isLoading: true });
    await renderScreen();
    expect(screen.queryByTestId("alerts-coming-soon")).toBeNull();
    expect(screen.queryByTestId("alerts-tester-panel")).toBeNull();
  });

  it("on the phone app (native), the tester is told alerts come with the next version", async () => {
    access({ tester: true, enabled: true });
    await renderScreen();
    expect(screen.getByTestId("alerts-device-native")).toBeTruthy();
  });

  it("coming soon in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    access({});
    await renderScreen();
    expect(screen.getByText("ئاگادارکردنەوەکان لە ڕێگەن")).toBeTruthy();
  });
});
