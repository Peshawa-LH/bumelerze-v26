import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/**
 * A short, calm reminder on every Event hub: earthquakes cannot be predicted,
 * so messages that name a day or time are rumours. Static text, no dismiss
 * (EMSC "prebunks" prediction claims the same way).
 */
export function PrebunkCard() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID="hub-prebunk"
      accessibilityRole="text"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.sunken,
          borderColor: colors.border.subtle,
          padding: spacing[3],
          gap: spacing[3],
        },
      ]}
    >
      <Ionicons
        name="information-circle-outline"
        size={20}
        color={colors.text.secondary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text
        style={{
          flex: 1,
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
          textAlign: "auto",
        }}
      >
        {t("eventHub.prebunk")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
  },
});
