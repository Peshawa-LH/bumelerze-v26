import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/**
 * The public stance (owner, 2026-10-09, D83): alerts are coming soon. Shown
 * at the top of Notification Settings to everyone who is not a tester. Same
 * words as the onboarding alerts screen.
 */
export function AlertsComingSoonNote() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID="alerts-coming-soon"
      accessibilityRole="summary"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[1],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("onboarding.notifications.title")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("onboarding.notifications.description")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12 },
});
