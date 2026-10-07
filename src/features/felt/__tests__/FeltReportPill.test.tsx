import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

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
});
