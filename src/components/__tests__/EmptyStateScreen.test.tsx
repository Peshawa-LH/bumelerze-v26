import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";

import { EmptyStateScreen } from "../EmptyStateScreen";

// Fixed test frame so useSafeAreaInsets() has a value to read.
const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("EmptyStateScreen under an RTL locale", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    // Unmount before switching the language back, or the still-mounted tree
    // picks up the change outside of act() and React warns.
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the Sorani (RTL) translation correctly", async () => {
    expect(isRTLLocale("ckb")).toBe(true);

    await i18n.changeLanguage("ckb");
    await renderWithProviders(
      <EmptyStateScreen
        title={i18n.t("home.title")}
        description={i18n.t("home.emptyState")}
      />,
    );

    expect(screen.getByText("ماڵەوە")).toBeTruthy();
    expect(screen.getByRole("header")).toBeTruthy();
  });

  it("renders the English (LTR) translation correctly for comparison", async () => {
    expect(isRTLLocale("en")).toBe(false);

    await i18n.changeLanguage("en");
    await renderWithProviders(
      <EmptyStateScreen
        title={i18n.t("home.title")}
        description={i18n.t("home.emptyState")}
      />,
    );

    expect(screen.getByText("Home")).toBeTruthy();
  });
});
