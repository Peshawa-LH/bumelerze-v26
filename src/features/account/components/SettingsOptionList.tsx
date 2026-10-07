import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";

export interface SettingsOption<T extends string> {
  value: T;
  label: string;
}

interface SettingsOptionListProps<T extends string> {
  options: readonly SettingsOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  disabled?: boolean;
  testIDPrefix?: string;
}

/** The vertical "pick one" list shown under an expanded settings row
 * (Language, Appearance): full-width option rows, the chosen one on
 * `surface.sunken` and bold. One component so the two always look alike.
 * `radio` role + `selected` state = "exactly one of these". */
export function SettingsOptionList<T extends string>({
  options,
  selected,
  onSelect,
  disabled = false,
  testIDPrefix,
}: SettingsOptionListProps<T>) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[2] }} accessibilityRole="radiogroup">
      {options.map((option) => {
        const isActive = selected === option.value;
        return (
          <Pressable
            key={option.value}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: isActive, checked: isActive, disabled }}
            disabled={disabled}
            onPress={() => onSelect(option.value)}
            style={[
              styles.option,
              {
                borderColor: colors.border.default,
                backgroundColor: isActive ? colors.surface.sunken : "transparent",
                paddingVertical: spacing[2],
                paddingStart: spacing[4],
                paddingEnd: spacing[4],
              },
            ]}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: isActive ? "700" : "400",
              }}
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
  option: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
  },
});
