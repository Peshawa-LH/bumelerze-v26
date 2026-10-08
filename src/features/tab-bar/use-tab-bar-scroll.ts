import { NavigationContext } from "expo-router/react-navigation";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  INITIAL_SCROLL_HIDE_STATE,
  nextScrollHide,
  type ScrollHideState,
} from "./scroll-hide";
import { useTabBarStore } from "./store";

/**
 * True when the bar must stay put: the system "reduce motion" setting is on,
 * or (native) a screen reader is running (a bar that slides out of the accessibility
 * tree under a swipe-to-scroll gesture is a trap, not a courtesy).
 */
export function useKeepTabBarVisible(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduceMotion(value))
      .catch(() => undefined);
    const subscriptions = [
      AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
        if (alive) setReduceMotion(value);
      }),
    ];
    // react-native-web answers "a screen reader is on" for everyone, so on the
    // web only the reduce-motion preference counts.
    if (Platform.OS !== "web") {
      AccessibilityInfo.isScreenReaderEnabled()
        .then((value) => alive && setScreenReader(value))
        .catch(() => undefined);
      subscriptions.push(
        AccessibilityInfo.addEventListener("screenReaderChanged", (value) => {
          if (alive) setScreenReader(value);
        }),
      );
    }
    return () => {
      alive = false;
      subscriptions.forEach((subscription) => subscription?.remove());
    };
  }, []);
  return reduceMotion || screenReader;
}

/** The scroll methods of ScrollView / FlatList / FlashList that we may call. */
interface ScrollTarget {
  scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void;
  scrollToOffset?: (options: { offset: number; animated?: boolean }) => void;
}

function scrollToTop(target: ScrollTarget | null) {
  if (!target) return;
  if (target.scrollToOffset) {
    target.scrollToOffset({ offset: 0, animated: true });
  } else {
    target.scrollTo?.({ y: 0, animated: true });
  }
}

/**
 * Tapping the active tab while its root page is showing scrolls that page back
 * to the top (React Navigation's own `useScrollToTop` throws outside a
 * navigator, which would break every screen's unit test; this one is a no-op
 * there). Popping the tab's stack to its root is the Stack's own job.
 */
function useScrollToTopOnTabPress(ref: RefObject<ScrollTarget | null>) {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation) return;
    const tabs: (typeof navigation)[] = [];
    let current: typeof navigation | undefined = navigation;
    while (current) {
      if (current.getState()?.type === "tab") tabs.push(current);
      current = current.getParent();
    }
    const unsubscribes = tabs.map((tab) =>
      tab.addListener(
        "tabPress" as never,
        ((event: { defaultPrevented?: boolean }) => {
          const isRoot = navigation.getState()?.index === 0;
          if (!navigation.isFocused() || !isRoot) return;
          requestAnimationFrame(() => {
            if (!event.defaultPrevented) scrollToTop(ref.current);
          });
        }) as never,
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [navigation, ref]);
}

/**
 * Wire a long scrolling page to the tab bar: spread the result onto a
 * `ScrollView` / `FlatList` / `FlashList`.
 *
 * ```tsx
 * const scroll = useTabBarScroll();
 * <ScrollView {...scroll} />
 * ```
 *
 * Scrolling down past a small distance hides the bar, scrolling up (or being
 * near the top or the end of the page, or on a short page) shows it - see
 * `scroll-hide.ts`. It never hides when reduce motion or a screen reader is
 * on. If the page has its own `onScroll`, call `scroll.onScroll(event)` from
 * it. It also scrolls the page to the top when its tab is tapped again. Only
 * the focused screen counts: a screen further down the stack is
 * resized when the bar toggles, and that must not move the bar.
 */
export function useTabBarScroll() {
  const keepVisible = useKeepTabBarVisible();
  const navigation = useContext(NavigationContext);
  const state = useRef<ScrollHideState>(INITIAL_SCROLL_HIDE_STATE);
  const ref = useRef<ScrollTarget | null>(null);
  useScrollToTopOnTabPress(ref);

  useEffect(() => {
    if (keepVisible) {
      useTabBarStore.getState().setHidden(false);
    }
  }, [keepVisible]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (keepVisible) {
        return;
      }
      if (navigation && !navigation.isFocused()) {
        return;
      }
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      const { hidden, setHidden } = useTabBarStore.getState();
      const next = nextScrollHide(hidden, state.current, {
        offset: contentOffset.y,
        viewportHeight: layoutMeasurement.height,
        contentHeight: contentSize.height,
      });
      state.current = next.state;
      setHidden(next.hidden);
    },
    [keepVisible, navigation],
  );

  // `ref` is typed loosely so it can be spread onto a ScrollView, FlatList or
  // FlashList alike.
  return {
    ref: ref as unknown as RefObject<never>,
    onScroll,
    scrollEventThrottle: 16,
  } as const;
}
