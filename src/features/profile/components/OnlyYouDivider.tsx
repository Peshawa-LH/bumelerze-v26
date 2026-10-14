import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/** The line between the public part of the Profile page and what only the
 * owner sees: a hairline each side of an eye and "Only you see this"
 * (mockup 3a). */
export function OnlyYouDivider() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID="only-you-divider"
      accessibilityRole="header"
      style={[styles.row, { gap: spacing[2], paddingTop: spacing[2] }]}
    >
      <View style={[styles.line, { backgroundColor: colors.border.default }]} />
      <Ionicons name="eye-outline" size={14} color={colors.text.secondary} />
      <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
        {t("profile.onlyYou")}
      </Text>
      <View style={[styles.line, { backgroundColor: colors.border.default }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
