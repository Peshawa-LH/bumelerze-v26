import { cleanup, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { BumelerzeSymbolIcon } from "../BumelerzeSymbolIcon";

// react-native-svg's <Svg> folds `width`/`height`/`opacity` props into its
// own `style` array rather than exposing them as separate top-level props —
// flatten it once here so the assertions below read as plain values.
function flattenStyle(style: unknown) {
  return StyleSheet.flatten(style as never) as {
    opacity?: number;
    width?: number;
    height?: number;
  };
}

describe("BumelerzeSymbolIcon", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders at full opacity when focused", async () => {
    await render(<BumelerzeSymbolIcon size={24} focused testID="sensor-tab-icon" />);

    const svg = screen.getByTestId("sensor-tab-icon");
    expect(flattenStyle(svg.props.style).opacity).toBe(1);
  });

  it("dims (but does not hide) when not focused, distinct from the focused state", async () => {
    await render(<BumelerzeSymbolIcon size={24} focused={false} testID="sensor-tab-icon" />);

    const svg = screen.getByTestId("sensor-tab-icon");
    const { opacity } = flattenStyle(svg.props.style);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it("keeps the mark's ~2.3:1 aspect ratio at the requested height, never a square crop", async () => {
    await render(<BumelerzeSymbolIcon size={30} focused testID="sensor-tab-icon" />);

    const svg = screen.getByTestId("sensor-tab-icon");
    const { width, height } = flattenStyle(svg.props.style);
    expect(height).toBe(30);
    // react-native-svg rounds the computed width to a whole pixel, so this
    // allows for that rounding rather than asserting an exact float match.
    const expectedWidth = 30 * (580 / 250);
    expect(Math.abs((width ?? 0) - expectedWidth)).toBeLessThan(1);
  });

  it("never renders its own accessibility label — the tab's `options.title` is the single source of truth", async () => {
    await render(<BumelerzeSymbolIcon size={24} focused testID="sensor-tab-icon" />);

    const svg = screen.getByTestId("sensor-tab-icon");
    expect(svg.props.accessible).toBe(false);
    expect(svg.props.accessibilityLabel).toBeUndefined();
  });
});
