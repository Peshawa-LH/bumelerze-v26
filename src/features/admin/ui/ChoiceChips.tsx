import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";

/** A row of pill chips, one selected (range 7 / 30 / 90 days / All; the
 * earthquakes on the Officials page). Radio semantics for screen readers. */
export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  label,
  testID,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
      style={[styles.row, { gap: spacing[2] }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            testID={testID ? `${testID}-${String(option.value)}` : undefined}
            style={[
              styles.chip,
              {
                paddingHorizontal: spacing[3],
                backgroundColor: selected ? colors.text.primary : "transparent",
                borderColor: selected ? colors.text.primary : colors.border.default,
              },
            ]}
          >
            <Text
              style={[
                typography.labelButton,
                { color: selected ? colors.surface.base : colors.text.primary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
