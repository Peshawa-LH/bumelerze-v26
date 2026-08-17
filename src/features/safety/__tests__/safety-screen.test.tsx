import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";

import SafetyScreen from "../../../../app/(tabs)/safety";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Presses `element` and lets any resulting state update settle — same
 * `act`-wrapped press pattern as `tier1-screen.test.tsx`, needed because
 * this `@testing-library/react-native` version's `render` is async. */
async function press(element: ReturnType<typeof screen.getByRole>) {
  await act(async () => {
    fireEvent.press(element);
  });
}

describe("Safety screen", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders each PREPARE / SURVIVE / RECOVER tab's cards, in Sorani (RTL)", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<SafetyScreen />);

    // PREPARE is the default tab — its first card renders immediately, with
    // no loading state (fully static/bundled content, per the wave brief).
    expect(screen.getByText("پلانێک بۆ خێزانەکەت دابنێ")).toBeTruthy();
    expect(screen.queryByText("دابکەوە، خۆت بپارێزە، توندی بگرە")).toBeNull();

    await press(screen.getByRole("tab", { name: "ڕزگاربوون" }));

    // The core Drop-Cover-Hold-On card is now visible, and PREPARE's card is
    // gone (only the active section's cards render).
    expect(screen.getByText("دابکەوە، خۆت بپارێزە، توندی بگرە")).toBeTruthy();
    expect(screen.queryByText("پلانێک بۆ خێزانەکەت دابنێ")).toBeNull();

    await press(screen.getByRole("tab", { name: "چاکبوونەوە" }));

    expect(screen.getByText("چاوەڕێی پاشلەرزین بکە")).toBeTruthy();
    expect(screen.queryByText("دابکەوە، خۆت بپارێزە، توندی بگرە")).toBeNull();
  });

  it("keeps the SURVIVE accessibility-variant block collapsed by default, expanding it on press", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<SafetyScreen />);

    await press(screen.getByRole("tab", { name: "Survive" }));

    // Collapsed: the toggle is present, but the wheelchair variant's body
    // text is not yet on screen.
    const toggle = screen.getByRole("button", {
      name: "If this is hard for you to do",
    });
    expect(screen.queryByText(/Lock your wheelchair's wheels/)).toBeNull();

    await press(toggle);

    expect(screen.getByText(/Lock your wheelchair's wheels/)).toBeTruthy();
    expect(screen.getByText("If you use a cane or walker")).toBeTruthy();
    expect(screen.getByText("If you are in bed")).toBeTruthy();
  });

  it("renders a do/don't pair as two distinctly-labeled accessible elements, not one blob of text", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<SafetyScreen />);

    await press(screen.getByRole("tab", { name: "Survive" }));

    const doElement = screen.getByLabelText(
      "Do: Get low, take cover under something sturdy, and hold on.",
    );
    const dontElement = screen.getByLabelText(
      "Don't: Do not run to a doorway. A modern doorway is no stronger than the rest of the room and offers no real protection.",
    );

    expect(doElement).toBeTruthy();
    expect(dontElement).toBeTruthy();
    // Two separate accessible nodes, not the same element read twice.
    expect(doElement).not.toBe(dontElement);
  });
});
