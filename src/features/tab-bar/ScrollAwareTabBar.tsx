import { BottomTabBar, type BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useState } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_CONTENT_HEIGHT } from "@/components/Snackbar";

import { useTabBarStore } from "./store";

const HIDE_MS = 200;
const SHOW_MS = 250;
const USE_NATIVE_DRIVER = Platform.OS !== "web";

/** One string that changes whenever the focused screen changes anywhere in
 * the tree under the tabs (a tab switch, a push, a pop). */
function focusedPathKey(state: BottomTabBarProps["state"]): string {
  const keys: string[] = [];
  let current:
    { routes: { key: string; state?: unknown }[]; index?: number } | undefined = state;
  while (current) {
    const route: { key: string; state?: unknown } | undefined =
      current.routes[current.index ?? 0];
    if (!route) break;
    keys.push(route.key);
    current = route.state as typeof current;
  }
  return keys.join(">");
}

/**
 * The bottom tab bar, slid out of view while the page is scrolled down
 * (`useTabBarScroll`) and back in on scroll up - and shown again whenever the
 * focused screen changes, so navigating never leaves the user without it.
 *
 * Same technique as React Navigation's own hide-on-keyboard: the slide is a
 * native-driven translate; the bar leaves the page layout when it starts to
 * hide (the content takes its strip) and rejoins it once it has slid back in.
 */
export function ScrollAwareTabBar(props: BottomTabBarProps) {
  const hidden = useTabBarStore((state) => state.hidden);
  const insets = useSafeAreaInsets();
  const barHeight = TAB_BAR_CONTENT_HEIGHT + insets.bottom;
  const [progress] = useState(() => new Animated.Value(hidden ? 0 : 1));
  const inLayout = useTabBarStore((state) => state.inLayout);

  const pathKey = focusedPathKey(props.state);
  useEffect(() => {
    useTabBarStore.getState().setHidden(false);
  }, [pathKey]);

  useEffect(() => {
    if (hidden) {
      Animated.timing(progress, {
        toValue: 0,
        duration: HIDE_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 1,
        duration: SHOW_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start(({ finished }) => {
        if (finished) useTabBarStore.getState().settle();
      });
    }
    return () => progress.stopAnimation();
  }, [hidden, progress]);

  return (
    <Animated.View
      testID="scroll-aware-tab-bar"
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      style={[
        inLayout ? null : styles.floating,
        {
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [barHeight, 0],
              }),
            },
          ],
        },
      ]}
    >
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", start: 0, end: 0, bottom: 0 },
});
