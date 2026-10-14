import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View, type ViewProps } from "react-native";

import { isRTLLocale } from "@/i18n";

/**
 * Web root view (the iOS/Android one is `AppRoot.tsx`).
 *
 * Reading direction: react-native-web turns `marginStart`, `paddingEnd`,
 * `borderStartWidth`, `textAlign: "start"` and the like into left or right
 * from the `dir` of the nearest view that sets one, not from
 * `<html dir="rtl">`. Without this, every logical style in Sorani and
 * Arabic landed on the English side. Setting `dir` here once makes them
 * resolve correctly in the whole app, the way they do on iOS/Android.
 *
 * No gesture-handler root view on the web: its web version is a plain view,
 * and gesture-handler (with Reanimated behind it) would otherwise be part of
 * the first download for every visitor, though only the map uses it.
 */
export function AppRoot({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const dir = isRTLLocale(i18n.language) ? "rtl" : "ltr";
  // `dir` is a react-native-web prop that React Native's types do not list.
  const webProps = { dir } as ViewProps;
  return (
    <View style={styles.root} testID="app-root" {...webProps}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
