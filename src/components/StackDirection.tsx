import { LocaleDirContext } from "expo-router/react-navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { isRTLLocale } from "@/i18n";

type Direction = "ltr" | "rtl";

/**
 * iOS: the native stack headers of the `<Stack>` inside follow the language
 * chosen in the app, from the first screen on, whatever language the app
 * process started in. The web and Android render the stack as before.
 *
 * Why it is needed. A language switch that flips the reading direction
 * restarts the app's JavaScript inside the same process, and iOS keeps the
 * layout direction the process started with until it is closed. The header
 * direction React Navigation passes on was already right after the restart,
 * but react-native-screens applies it to a navigation bar only when it
 * differs from what that stack's container view already has, and after
 * such a restart the container view already had it while the bar did not.
 * The bar then fell back to the process direction: after switching from
 * Sorani to English in the app, the back button of every pushed screen
 * stayed on the right until the next cold start (and the reverse).
 *
 * The fix. Each stack starts with the opposite direction and settles on the
 * app language's one right after it has mounted. The change is what makes
 * react-native-screens set the bar, its back swipe and its buttons, so the
 * headers end up right whichever side the bar started on. The stacks' first
 * screens have no header (the tab roots, onboarding, the felt report), so
 * the start is not seen; a header shown at once (a link opened cold) is
 * mirrored for at most a frame or two. Only the native headers read this
 * direction (`useLocale`): the app's own views follow the language through
 * `isRTLLocale`, so nothing else moves.
 */
export function StackDirection({ children }: { children: ReactNode }) {
  if (Platform.OS !== "ios") {
    return <>{children}</>;
  }
  return <IosStackDirection>{children}</IosStackDirection>;
}

/** The direction a stack starts with on iOS before it settles: the other
 * one. Exported for tests. */
export function startingDirection(settled: Direction): Direction {
  return settled === "rtl" ? "ltr" : "rtl";
}

function IosStackDirection({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const direction: Direction = isRTLLocale(i18n.language) ? "rtl" : "ltr";
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // After the first screens are in their navigation controller:
    // react-native-screens sets a bar's direction only for a screen that is
    // already in one, so a change made while mounting (a layout effect)
    // reached the bar as a single value and changed nothing.
    const id = setTimeout(() => setSettled(true), 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <LocaleDirContext.Provider value={settled ? direction : startingDirection(direction)}>
      {children}
    </LocaleDirContext.Provider>
  );
}
