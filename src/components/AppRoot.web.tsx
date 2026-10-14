import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/**
 * Web root view (the iOS/Android one is `AppRoot.tsx`).
 *
 * No gesture-handler root view on the web: its web version is a plain view,
 * and gesture-handler (with Reanimated behind it) would otherwise be part of
 * the first download for every visitor, though only the map uses it.
 */
export function AppRoot({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root} testID="app-root">
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
