import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/** The line between the public part of the Profile page and what only the
 * owner sees: a hairline, a lock and "Only you see this". */
export function OnlyYouDivider() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID="only-you-divider"
      accessibilityRole="header"
      style={[
        styles.row,
        {
          gap: spacing[2],
          paddingTop: spacing[4],
          borderTopColor: colors.border.default,
        },
      ]}
    >
      <Ionicons name="lock-closed" size={16} color={colors.text.secondary} />
      <Text style={[typography.labelButton, { color: colors.text.secondary }]}>
        {t("profile.onlyYou")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", borderTopWidth: 1 },
});
