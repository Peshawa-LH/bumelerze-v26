import { NavigationContext } from "expo-router/react-navigation";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

import { useTabBarStore } from "../store";
import { useTabBarScroll } from "../use-tab-bar-scroll";

function scrollEvent(y: number, contentHeight = 4000, viewportHeight = 700) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: contentHeight },
      layoutMeasurement: { width: 390, height: viewportHeight },
    },
  } as never;
}

function mockAccessibility({
  reduceMotion = false,
  screenReader = false,
}: { reduceMotion?: boolean; screenReader?: boolean } = {}) {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduceMotion);
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(screenReader);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: jest.fn() } as never);
}

async function scrollDown(onScroll: (e: never) => void) {
  for (const y of [100, 130, 170, 230, 300]) {
    await act(async () => onScroll(scrollEvent(y)));
  }
}

describe("useTabBarScroll", () => {
  beforeEach(() => {
    useTabBarStore.setState({ hidden: false, inLayout: true });
    mockAccessibility();
  });
  afterEach(() => jest.restoreAllMocks());

  it("hides the bar scrolling down and shows it scrolling up", async () => {
    const { result } = await renderHook(() => useTabBarScroll());
    await scrollDown(result.current.onScroll);
    expect(useTabBarStore.getState().hidden).toBe(true);
    await act(async () => result.current.onScroll(scrollEvent(270)));
    expect(useTabBarStore.getState().hidden).toBe(false);
  });

  it("never hides the bar on a short page", async () => {
    const { result } = await renderHook(() => useTabBarScroll());
    for (const y of [20, 60, 100, 140, 180]) {
      await act(async () => result.current.onScroll(scrollEvent(y, 880)));
    }
    expect(useTabBarStore.getState().hidden).toBe(false);
  });

  it("never hides the bar when reduce motion is on", async () => {
    mockAccessibility({ reduceMotion: true });
    const { result } = await renderHook(() => useTabBarScroll());
    await scrollDown(result.current.onScroll);
    expect(useTabBarStore.getState().hidden).toBe(false);
  });

  it("never hides the bar when a screen reader is on", async () => {
    mockAccessibility({ screenReader: true });
    const { result } = await renderHook(() => useTabBarScroll());
    await scrollDown(result.current.onScroll);
    expect(useTabBarStore.getState().hidden).toBe(false);
  });

  it("shows a hidden bar when reduce motion gets switched on", async () => {
    useTabBarStore.setState({ hidden: true });
    mockAccessibility({ reduceMotion: true });
    await renderHook(() => useTabBarScroll());
    expect(useTabBarStore.getState().hidden).toBe(false);
  });

  it("ignores scrolling on a screen that is not in front", async () => {
    const navigation = {
      isFocused: () => false,
      getState: () => ({ type: "stack", index: 1 }),
      getParent: () => undefined,
      addListener: () => () => undefined,
    } as never;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NavigationContext.Provider value={navigation}>
        {children}
      </NavigationContext.Provider>
    );
    const { result } = await renderHook(() => useTabBarScroll(), { wrapper });
    await scrollDown(result.current.onScroll);
    expect(useTabBarStore.getState().hidden).toBe(false);
  });
});
