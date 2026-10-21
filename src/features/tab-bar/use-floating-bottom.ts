import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTabBarStore } from "./store";

/**
 * The `bottom` of a button floating `gap` above the bottom of a tab screen:
 * "I felt it!" and "Who felt it?" on the event page, "I felt it!" on Home.
 * Every such button takes its offset from here, so they share one line.
 *
 * While the tab bar takes its strip of the page, the screen already ends
 * above the bar, and the bar's own height includes the home-indicator
 * inset: adding the inset again lifted a button 34 pt on iPhones (seen on
 * iOS, 2026-10-20, and again on 2026-10-21 when "Who felt it?" still did
 * it and sat 34 pt above "I felt it!"). Once the bar has slid away, the
 * page reaches the screen's bottom edge and the inset is needed. A browser
 * tab has no inset, so on the web the offset is `gap` either way.
 */
export function useFloatingBottomOffset(gap: number): number {
  const insets = useSafeAreaInsets();
  const tabBarInLayout = useTabBarStore((state) => state.inLayout);
  return (tabBarInLayout ? 0 : insets.bottom) + gap;
}
