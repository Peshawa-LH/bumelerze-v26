import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePrefsStore } from "@/features/onboarding";
import i18n from "@/i18n";

import { BeReadyCard } from "../components/BeReadyCard";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderCard() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <BeReadyCard />
    </SafeAreaProvider>,
  );
}

describe("Home 'Be ready' card", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    usePrefsStore.setState({ beReadyHidden: false, hasHydrated: true });
    await i18n.changeLanguage("en");
  });
  afterEach(async () => {
    await cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("shows a calm card that opens the Safety guide", async () => {
    await renderCard();
    expect(screen.getByTestId("be-ready-card")).toBeTruthy();
    expect(screen.getByText("Be ready")).toBeTruthy();
    expect(
      screen.getByText("A short guide for before, during and after an earthquake."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId("be-ready-open"));
    expect(mockPush).toHaveBeenCalledWith("/safety");
  });

  it("goes away for good when dismissed", async () => {
    const view = await renderCard();
    await fireEvent.press(screen.getByTestId("be-ready-dismiss"));
    expect(screen.queryByTestId("be-ready-card")).toBeNull();
    expect(usePrefsStore.getState().beReadyHidden).toBe(true);
    await view.unmount();
    await renderCard();
    expect(screen.queryByTestId("be-ready-card")).toBeNull();
  });

  it("is not shown once the Safety guide has been opened", async () => {
    usePrefsStore.setState({ beReadyHidden: true });
    await renderCard();
    expect(screen.queryByTestId("be-ready-card")).toBeNull();
  });

  it("labels both buttons for screen readers, in Sorani too", async () => {
    await i18n.changeLanguage("ckb");
    await renderCard();
    expect(screen.getByLabelText("ئەم کارتە بشارەوە")).toBeTruthy();
    expect(screen.getByText("ئامادە بە")).toBeTruthy();
  });
});
