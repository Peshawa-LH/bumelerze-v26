import { cleanup, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useTabBarStore } from "@/features/tab-bar/store";

import { FELT_PILL_MIN_WIDTH, FeltReportPill } from "../components/FeltReportPill";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe("FeltReportPill", () => {
  it("keeps the Sorani-sized target in every language, centred", async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeltReportPill />
      </SafeAreaProvider>,
    );
    const style = StyleSheet.flatten(screen.getByRole("button").props.style);
    expect(style.minWidth).toBe(FELT_PILL_MIN_WIDTH);
    expect(style.alignItems).toBe("center");
    expect(style.minHeight).toBe(48);
  });

  describe("height above the bottom edge", () => {
    const withHomeIndicator = { ...metrics, insets: { ...metrics.insets, bottom: 34 } };

    afterEach(() => {
      cleanup();
      useTabBarStore.setState({ hidden: false, inLayout: true });
    });

    it("sits 16 pt above the tab bar, without the home-indicator inset the bar already has", async () => {
      useTabBarStore.setState({ hidden: false, inLayout: true });
      await render(
        <SafeAreaProvider initialMetrics={withHomeIndicator}>
          <FeltReportPill />
        </SafeAreaProvider>,
      );
      const style = StyleSheet.flatten(screen.getByRole("button").props.style);
      expect(style.bottom).toBe(16);
    });

    it("clears the home indicator once the tab bar has slid away", async () => {
      useTabBarStore.setState({ hidden: true, inLayout: false });
      await render(
        <SafeAreaProvider initialMetrics={withHomeIndicator}>
          <FeltReportPill />
        </SafeAreaProvider>,
      );
      const style = StyleSheet.flatten(screen.getByRole("button").props.style);
      expect(style.bottom).toBe(34 + 16);
    });
  });
});
