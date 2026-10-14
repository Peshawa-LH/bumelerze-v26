import { PlatformPressable } from "expo-router/react-navigation";
import type { BottomTabBarButtonProps } from "expo-router/tabs";
import { Platform } from "react-native";

/**
 * The tab bar button on the web (iOS/Android keep React Navigation's own).
 *
 * React Navigation's button is a link with a long-press handler. On the web
 * both cost taps:
 * - react-native-web fires `onPress` from the browser's click, and cancels
 *   that click once a long press has fired (after ~0.5 s). A firm, unhurried
 *   press on Home did nothing at all (measured: every press held 0.55 s or
 *   longer was lost). Without a long-press handler the press always counts.
 * - as a link, a held press on an iPhone opens Safari's link preview
 *   instead, and the links pointed at the wrong page anyway (/badges for
 *   Map, Sensor, Profile and Settings).
 * The label is also not selectable, so a held press never starts a text
 * selection, which react-native-web also treats as "not a tap".
 */
export function WebTabButton({
  href: _href,
  onLongPress: _onLongPress,
  style,
  ...props
}: BottomTabBarButtonProps) {
  return <PlatformPressable {...props} style={[style, NO_SELECT]} />;
}

// `userSelect` is a react-native-web style.
const NO_SELECT = { userSelect: "none" } as const;

/** Spread into the tab layout's screen options: the web button on the web,
 * nothing (React Navigation's default) on iOS/Android. */
export const tabBarButtonOptions =
  Platform.OS === "web"
    ? { tabBarButton: (props: BottomTabBarButtonProps) => <WebTabButton {...props} /> }
    : {};
