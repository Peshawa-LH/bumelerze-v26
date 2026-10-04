import { Children, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

/** One card holding settings rows, a 1 px subtle line between neighbours.
 * Children that render nothing (null/false) get no divider. */
export function SettingsGroup({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      {rows.map((row, index) => (
        <View
          key={index}
          style={
            index > 0
              ? { borderTopWidth: 1, borderTopColor: colors.border.subtle }
              : undefined
          }
        >
          {row}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
});
