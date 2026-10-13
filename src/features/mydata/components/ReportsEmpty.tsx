import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useTheme } from "@/theme";

/** Compact empty state: icon, one line, one button. Shown by the My reports
 * page when there are none. */
export function ReportsEmpty() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  return (
    <View
      testID="reports-empty"
      style={[
        styles.empty,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      <Ionicons name="pulse-outline" size={28} color={colors.text.secondary} />
      <Text
        style={[
          typography.bodyDefault,
          { color: colors.text.secondary, textAlign: "center" },
        ]}
      >
        {t("myData.reports.empty")}
      </Text>
      <AccountButton
        tone="primary"
        label={t("myData.emptyStateCta")}
        onPress={() => router.push("/felt-report")}
        testID="reports-empty-cta"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderWidth: 1, borderRadius: 14, alignItems: "center" },
});
