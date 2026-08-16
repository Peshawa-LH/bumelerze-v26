import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";

import MapScreen from "../(tabs)/map";

/**
 * Native (iOS/Android) Map tab placeholder — resolved by Metro's platform
 * extension rules for any non-web build (`map.web.tsx` is web-only, never
 * bundled here). A real translated state, not a TODO string — asserted in
 * both an RTL and an LTR locale; full key-parity across all four locales is
 * already enforced repo-wide by `src/i18n/__tests__/locales.test.ts`.
 */
const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("Native Map tab placeholder", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the Sorani (RTL) translated 'arrives with the app build' state", async () => {
    expect(isRTLLocale("ckb")).toBe(true);

    await i18n.changeLanguage("ckb");
    await renderWithProviders(<MapScreen />);

    expect(screen.getByText(i18n.t("map.title"))).toBeTruthy();
    expect(screen.getByText(i18n.t("map.nativeUnavailableDescription"))).toBeTruthy();
  });

  it("renders the English (LTR) translated state for comparison", async () => {
    expect(isRTLLocale("en")).toBe(false);

    await i18n.changeLanguage("en");
    await renderWithProviders(<MapScreen />);

    expect(screen.getByText("Map")).toBeTruthy();
    expect(
      screen.getByText(
        "Bumelerze's live map needs a full app installation to run — it's on the way. Check the event list for the latest earthquakes in the meantime.",
      ),
    ).toBeTruthy();
  });
});
