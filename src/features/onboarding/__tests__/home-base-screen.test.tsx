import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePrefsStore } from "../store";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));

// Imported after the mock above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import OnboardingHomeBaseScreen from "../../../../app/onboarding/home-base";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("onboarding HomeBase town picker", () => {
  beforeEach(() => {
    mockPush.mockClear();
    usePrefsStore.setState({
      onboardingCompleted: false,
      onboardingStep: "homeBase",
      homeBase: null,
      hasHydrated: true,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("selecting a real town stores its coordinates and advances to the done screen", async () => {
    await renderWithProviders(<OnboardingHomeBaseScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Erbil" }));

    expect(usePrefsStore.getState().homeBase).toEqual({
      townId: "erbil",
      lat: 36.19,
      lon: 44.01,
    });
    expect(usePrefsStore.getState().onboardingStep).toBe("done");
    expect(mockPush).toHaveBeenCalledWith("/onboarding/done");
  });

  it("selecting 'elsewhere' clears any HomeBase and still advances (a free skip)", async () => {
    usePrefsStore.setState({ homeBase: { townId: "duhok", lat: 36.87, lon: 42.99 } });

    await renderWithProviders(<OnboardingHomeBaseScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Elsewhere / skip" }));

    expect(usePrefsStore.getState().homeBase).toBeNull();
    expect(mockPush).toHaveBeenCalledWith("/onboarding/done");
  });

  it("the screen-level skip button advances without ever touching HomeBase (whole step is optional)", async () => {
    await renderWithProviders(<OnboardingHomeBaseScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Skip for now" }));

    expect(usePrefsStore.getState().homeBase).toBeNull();
    expect(mockPush).toHaveBeenCalledWith("/onboarding/done");
  });
});
