import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
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

// Imported after the mock above so the mocked module graph is in place.
/* eslint-disable import/first -- see comment above */
import OnboardingMissionScreen from "../../../../app/onboarding/index";
import OnboardingDoneScreen from "../../../../app/onboarding/done";
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
      homeBase: null,
      hasHydrated: true,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("mission screen: pressing Continue advances the step and pushes the language screen", async () => {
    await renderWithProviders(<OnboardingMissionScreen />);

    expect(screen.getByText("Always know, in your language")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    expect(usePrefsStore.getState().onboardingStep).toBe("language");
    expect(mockPush).toHaveBeenCalledWith("/onboarding/language");
  });

  it("mission screen: resumes past itself when a prior session already advanced (RTL-restart survival)", async () => {
    usePrefsStore.setState({ onboardingStep: "location" });

    await renderWithProviders(<OnboardingMissionScreen />);

    expect(screen.getByText("redirect:/onboarding/location")).toBeTruthy();
    expect(screen.queryByText("Always know, in your language")).toBeNull();
  });

  it("done screen: pressing the CTA completes onboarding in the shared store", async () => {
    usePrefsStore.setState({ onboardingStep: "done" });

    await renderWithProviders(<OnboardingDoneScreen />);

    expect(usePrefsStore.getState().onboardingCompleted).toBe(false);

    fireEvent.press(screen.getByRole("button", { name: "Get started" }));

    expect(usePrefsStore.getState().onboardingCompleted).toBe(true);
    expect(usePrefsStore.getState().onboardingStep).toBe("done");
  });
});
