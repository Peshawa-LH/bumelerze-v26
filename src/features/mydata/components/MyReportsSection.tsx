import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useMyReports } from "../use-my-reports";
import { ContributionRow } from "./ContributionRow";

/** How many reports the account page previews before "See all". */
export const REPORTS_PREVIEW = 3;

/** Compact empty state: icon, one line, one button. Also used by the full list. */
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

/** "My reports (n)" with the three newest rows and a "See all" link (shown
 * only when there are more than three). */
export function MyReportsSection() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const { hasHydrated, rows, count } = useMyReports();

  return (
    <View style={{ gap: spacing[2] }} testID="my-reports-section">
      <View style={[styles.header, { gap: spacing[2] }]}>
        <Text
          accessibilityRole="header"
          style={[typography.h3, { color: colors.text.primary }]}
        >
          {t("myData.reports.title")}
        </Text>
        {hasHydrated ? (
          <View
            testID="my-reports-count"
            style={[
              styles.chip,
              {
                backgroundColor: colors.surface.sunken,
                borderColor: colors.border.default,
              },
            ]}
          >
            <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
              {localizeDigits(String(count), i18n.language)}
            </Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        {count > REPORTS_PREVIEW ? (
          <Pressable
            testID="my-reports-see-all"
            accessibilityRole="link"
            accessibilityLabel={t("myData.reports.seeAll")}
            onPress={() => router.push("/my-reports")}
            style={styles.link}
          >
            <Text style={[typography.labelButton, { color: colors.text.link }]}>
              {t("myData.reports.seeAll")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hasHydrated && count === 0 ? <ReportsEmpty /> : null}
      {rows.slice(0, REPORTS_PREVIEW).map((row) => (
        <ContributionRow key={row.reportId} row={row} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  spacer: { flex: 1 },
  chip: {
    height: 28,
    minWidth: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  empty: { borderWidth: 1, borderRadius: 14, alignItems: "center" },
});
