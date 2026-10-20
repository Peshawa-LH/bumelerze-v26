/**
 * iOS 26+: the stack's back swipe starts anywhere on the page, so the swipe
 * to the previous slide left the Event hub instead (iOS 27 Simulator,
 * 2026-10-20). While a carousel is shown, the back swipe is edge-only.
 */
import { renderHook } from "@testing-library/react-native";
import { NavigationContext } from "expo-router/react-navigation";
import { createRef, type ReactNode } from "react";
import { Platform, type View } from "react-native";

import { useHorizontalSwipeLock } from "../carousel/swipe-lock";

function withNavigation(setOptions: jest.Mock) {
  const navigation = { setOptions } as unknown as React.ContextType<
    typeof NavigationContext
  >;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationContext.Provider value={navigation}>
        {children}
      </NavigationContext.Provider>
    );
  };
}

describe("useHorizontalSwipeLock (iOS)", () => {
  const ref = createRef<View>();

  it("[regression] makes the screen's back swipe edge-only while the carousel is drawn", async () => {
    const setOptions = jest.fn();
    await renderHook(() => useHorizontalSwipeLock(ref, true), {
      wrapper: withNavigation(setOptions),
    });
    expect(setOptions).toHaveBeenCalledWith({ fullScreenGestureEnabled: false });
  });

  it("does nothing without slides", async () => {
    const setOptions = jest.fn();
    await renderHook(() => useHorizontalSwipeLock(ref, false), {
      wrapper: withNavigation(setOptions),
    });
    expect(setOptions).not.toHaveBeenCalled();
  });

  it("does nothing outside a navigator, or on Android", async () => {
    await renderHook(() => useHorizontalSwipeLock(ref, true));
    const original = Platform.OS;
    Platform.OS = "android";
    try {
      const setOptions = jest.fn();
      await renderHook(() => useHorizontalSwipeLock(ref, true), {
        wrapper: withNavigation(setOptions),
      });
      expect(setOptions).not.toHaveBeenCalled();
    } finally {
      Platform.OS = original;
    }
  });
});
