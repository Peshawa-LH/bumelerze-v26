import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/** The plain statement that Bumelerze cannot send rescue or help. No phone
 * numbers in v1 (owner, 2026-10-08: revisit once confirmed per governorate).
 * Neutral colours: it informs, it does not alarm. */
export function NoHelpNote({ testID = "im-safe-no-help" }: { testID?: string }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={t("imSafe.noHelp")}
      style={[
        styles.row,
        {
          gap: spacing[2],
          padding: spacing[3],
          backgroundColor: colors.surface.sunken,
        },
      ]}
    >
      <Ionicons
        name="information-circle-outline"
        size={20}
        color={colors.text.secondary}
      />
      <Text style={[typography.bodyMeta, styles.text, { color: colors.text.primary }]}>
        {t("imSafe.noHelp")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", borderRadius: 10 },
  text: { flex: 1 },
});
