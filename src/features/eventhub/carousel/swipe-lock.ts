import { NavigationContext } from "expo-router/react-navigation";
import { useContext, useEffect, type RefObject } from "react";
import { Platform, type View } from "react-native";

/**
 * Keeps other gestures from taking the carousel's sideways swipe. The web
 * version (`swipe-lock.web.ts`) holds the page still.
 *
 * iOS/Android: the page's vertical scroll is no problem, the responder system
 * gives a mostly-sideways move to the carousel (checked on the iOS
 * Simulator, also with a diagonal swipe). The navigation stack's back swipe
 * is: from iOS 26 it starts anywhere on the page, not only at the screen
 * edge, and a UIKit gesture the responder system cannot stop. The swipe to
 * the previous slide (towards the reading end: right in English, left in
 * Sorani and Arabic) is exactly the back gesture, so it left the Event hub
 * instead of changing the slide (seen on iOS 27, 2026-10-20). While a
 * carousel is shown, the screen's back swipe starts at the edge only, as it
 * did before iOS 26.
 */
export function useHorizontalSwipeLock(
  _ref: RefObject<View | null>,
  active: boolean,
): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (Platform.OS !== "ios" || !active || !navigation) {
      return;
    }
    navigation.setOptions({ fullScreenGestureEnabled: false });
  }, [navigation, active]);
}
