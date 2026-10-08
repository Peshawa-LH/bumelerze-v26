import { act, cleanup, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { BottomTabBarProps } from "expo-router/tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ScrollAwareTabBar } from "../ScrollAwareTabBar";
import { useTabBarStore } from "../store";

jest.mock("expo-router/tabs", () => ({
  BottomTabBar: () => null,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 800 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function stateAt(...keys: string[]) {
  // Nested like React Navigation's: tabs -> tab -> stack.
  const [tab, ...rest] = keys;
  return {
    index: 0,
    routes: [
      {
        key: tab,
        state: rest.length
          ? { index: rest.length - 1, routes: rest.map((key) => ({ key })) }
          : undefined,
      },
    ],
  } as never;
}

async function renderBar(state: never) {
  const ui = (s: never) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <ScrollAwareTabBar {...({ state: s } as unknown as BottomTabBarProps)} />
    </SafeAreaProvider>
  );
  const view = await render(ui(state));
  return { rerender: (s: never) => view.rerender(ui(s)) };
}

describe("ScrollAwareTabBar", () => {
  beforeEach(() => useTabBarStore.setState({ hidden: false, inLayout: true }));
  afterEach(async () => {
    await cleanup();
  });

  it("is reachable while visible", async () => {
    await renderBar(stateAt("home"));
    const bar = screen.getByTestId("scroll-aware-tab-bar");
    expect(bar.props.pointerEvents).toBe("auto");
    expect(bar.props.accessibilityElementsHidden).toBe(false);
  });

  it("cannot be tapped or focused while hidden", async () => {
    await renderBar(stateAt("home"));
    await act(async () => useTabBarStore.getState().setHidden(true));
    const bar = screen.getByTestId("scroll-aware-tab-bar", {
      includeHiddenElements: true,
    });
    expect(bar.props.pointerEvents).toBe("none");
    expect(bar.props.accessibilityElementsHidden).toBe(true);
    expect(bar.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("comes back whenever the focused screen changes", async () => {
    const view = await renderBar(stateAt("home", "index"));
    await act(async () => useTabBarStore.getState().setHidden(true));
    await view.rerender(stateAt("home", "index", "event"));
    expect(useTabBarStore.getState().hidden).toBe(false);

    await act(async () => useTabBarStore.getState().setHidden(true));
    await view.rerender(stateAt("map", "map"));
    expect(useTabBarStore.getState().hidden).toBe(false);
  });

  it("stays hidden when nothing about the focused screen changed", async () => {
    const view = await renderBar(stateAt("home", "index"));
    await act(async () => useTabBarStore.getState().setHidden(true));
    await view.rerender(stateAt("home", "index"));
    expect(useTabBarStore.getState().hidden).toBe(true);
  });
});

describe("ScrollAwareTabBar layout", () => {
  beforeEach(() => useTabBarStore.setState({ hidden: false, inLayout: true }));

  it("leaves the page layout when it hides, so the content takes its strip", async () => {
    await renderBar(stateAt("home"));
    const flat = () =>
      StyleSheet.flatten(
        screen.getByTestId("scroll-aware-tab-bar", { includeHiddenElements: true }).props
          .style,
      );
    expect(flat().position).toBeUndefined();
    await act(async () => useTabBarStore.getState().setHidden(true));
    expect(flat().position).toBe("absolute");
    // Shown again: it stays out of the layout until the slide-in is done.
    await act(async () => useTabBarStore.getState().setHidden(false));
    expect(flat().position).toBe("absolute");
    await act(async () => useTabBarStore.getState().settle());
    expect(flat().position).toBeUndefined();
  });
});
