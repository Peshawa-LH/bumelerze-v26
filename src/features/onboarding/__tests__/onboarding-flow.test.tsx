import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePrefsStore } from "../store";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

// Only `expo-router`'s navigation surface is mocked — OnboardingScreenShell
// and every onboarding screen run for real, so this exercises the actual
// resume/redirect and forward-navigation logic (same "mock only the
// network/nav edge" spirit as home-screen.test.tsx).
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
  Redirect: ({ href }: { href: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
    const { Text } = require("react-native");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const React = require("react");
    return React.createElement(Text, null, `redirect:${href}`);
  },
}));

const mockRequestPermission = jest.fn();
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
}));

const mockRefreshReferencePlace = jest.fn();
jest.mock("@/features/location", () => ({
  refreshReferencePlace: () => mockRefreshReferencePlace(),
}));

// Imported after the mock above so the mocked module graph is in place.
/* eslint-disable import/first -- see comment above */
import OnboardingMissionScreen from "../../../../app/onboarding/index";
import OnboardingDoneScreen from "../../../../app/onboarding/done";
import OnboardingLocationScreen from "../../../../app/onboarding/location";
import OnboardingNotificationsScreen from "../../../../app/onboarding/notifications";
/* eslint-enable import/first */

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("onboarding navigation flow", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockBack.mockClear();
    // Reset the (real, shared) prefs store to a known first-launch state
    // before each test, bypassing the async AsyncStorage hydration path —
    // that path has its own dedicated coverage in store.test.ts.
    usePrefsStore.setState({
      onboardingCompleted: false,
      onboardingStep: "mission",
      referencePlace: null,
      referenceCheckedAt: null,
      hasHydrated: true,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("mission screen: pressing Continue advances the step and pushes the language screen", async () => {
    await renderWithProviders(<OnboardingMissionScreen />);

    expect(screen.getByText("Welcome to Bumelerze")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    expect(usePrefsStore.getState().onboardingStep).toBe("language");
    expect(mockPush).toHaveBeenCalledWith("/onboarding/language");
  });

  it("mission screen: resumes past itself when a prior session already advanced (RTL-restart survival)", async () => {
    usePrefsStore.setState({ onboardingStep: "location" });

    await renderWithProviders(<OnboardingMissionScreen />);

    expect(screen.getByText("redirect:/onboarding/location")).toBeTruthy();
    expect(screen.queryByText("Welcome to Bumelerze")).toBeNull();
  });

  it("done screen: pressing the CTA completes onboarding in the shared store", async () => {
    usePrefsStore.setState({ onboardingStep: "done" });

    await renderWithProviders(<OnboardingDoneScreen />);

    expect(usePrefsStore.getState().onboardingCompleted).toBe(false);

    fireEvent.press(screen.getByRole("button", { name: "Get started" }));

    expect(usePrefsStore.getState().onboardingCompleted).toBe(true);
    expect(usePrefsStore.getState().onboardingStep).toBe("done");
  });

  it("a step saved by an older version at the retired HomeBase screen resumes at the end", async () => {
    usePrefsStore.setState({ onboardingStep: "homeBase" });

    await renderWithProviders(<OnboardingMissionScreen />);

    expect(screen.getByText("redirect:/onboarding/done")).toBeTruthy();
  });

  it("notifications screen goes straight to the end: no town picker", async () => {
    await renderWithProviders(<OnboardingNotificationsScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    expect(usePrefsStore.getState().onboardingStep).toBe("done");
    expect(mockPush).toHaveBeenCalledWith("/onboarding/done");
  });

  it("location screen: allowing location fills the background reference place", async () => {
    mockRefreshReferencePlace.mockClear();
    mockRequestPermission.mockResolvedValue({ granted: true });
    await renderWithProviders(<OnboardingLocationScreen />);

    fireEvent.press(screen.getByRole("button", { name: i18nAllow() }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/onboarding/notifications"),
    );
    expect(mockRefreshReferencePlace).toHaveBeenCalledTimes(1);
  });

  it("location screen: declining location never tries to read a fix", async () => {
    mockRefreshReferencePlace.mockClear();
    mockRequestPermission.mockResolvedValue({ granted: false });
    await renderWithProviders(<OnboardingLocationScreen />);

    fireEvent.press(screen.getByRole("button", { name: i18nAllow() }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/onboarding/notifications"),
    );
    expect(mockRefreshReferencePlace).not.toHaveBeenCalled();
  });

  it("location screen: 'Not now' silently sets the reference place to Hawler", async () => {
    await renderWithProviders(<OnboardingLocationScreen />);

    fireEvent.press(
      screen.getByRole("button", { name: i18nText("onboarding.location.notNow") }),
    );

    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("erbil");
  });

  it("location screen: never replaces a reference place that is already set", async () => {
    usePrefsStore.setState({
      referencePlace: { placeId: "duhok", lat: 36.87, lon: 42.99 },
    });
    await renderWithProviders(<OnboardingLocationScreen />);
    fireEvent.press(
      screen.getByRole("button", { name: i18nText("onboarding.location.notNow") }),
    );
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("duhok");
  });

  it("done screen: says nothing about a place, whatever the reference is", async () => {
    usePrefsStore.setState({
      onboardingStep: "done",
      referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 },
    });

    await renderWithProviders(<OnboardingDoneScreen />);

    expect(screen.queryByTestId("onboarding-done-home-base")).toBeNull();
    expect(screen.queryByText(/HomeBase/)).toBeNull();
    expect(screen.queryByText(/Hawler/)).toBeNull();
  });

  it("location screen: the explanation no longer mentions a HomeBase", async () => {
    await renderWithProviders(<OnboardingLocationScreen />);

    expect(screen.queryByText(/HomeBase/)).toBeNull();
    expect(screen.getByText(/Sharing your location/)).toBeTruthy();
  });
});

function i18nText(key: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the app's i18n instance, loaded lazily like the mocks above
  return (require("@/i18n").default as { t: (key: string) => string }).t(key);
}

function i18nAllow(): string {
  return i18nText("onboarding.location.allow");
}
