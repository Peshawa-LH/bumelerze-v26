import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { useAdminAccess } from "@/features/admin/queries";
import { hasVcSpread, useMyHomes, vcScenarios } from "@/features/building";
import { useFollowRequests } from "@/features/community/queries";
import { DownloadMyDataRow } from "@/features/data-export";
import { useMyReports } from "@/features/mydata";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/**
 * The owner's own tools under "Only you see this" (review note 5.1, mockup
 * 3a), as ONE tidy list: My reports, My home, People and requests, Download
 * my data, for Government officials the Officials page (0066) and, for
 * admins, Admin tools. Each opens its own page (or, for
 * the download, does it in place).
 */
export function OwnerList() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const locale = i18n.language;
  const reports = useMyReports();
  const homes = useMyHomes();
  const requests = useFollowRequests();
  const admin = useAdminAccess();

  const pending = requests.data?.length ?? 0;
  const myHomes = homes.data?.homes ?? [];
  const first = myHomes[0];
  let homeValue: string | null = null;
  if (myHomes.length > 1) {
    homeValue = t("profile.myHome.count", {
      number: localizeDigits(String(myHomes.length), locale),
    });
  } else if (first) {
    const name = first.tag.label ?? t(`building.kinds.${first.tag.kind}`);
    const scenarios = first.assessment
      ? vcScenarios(first.assessment.vcMostLikely, first.assessment.vcRange)
      : null;
    homeValue = !scenarios
      ? name
      : hasVcSpread(scenarios)
        ? t("profile.myHome.valueRange", {
            vc: scenarios.mostLikely,
            pessimistic: scenarios.pessimistic,
            optimistic: scenarios.optimistic,
            name,
          })
        : t("profile.myHome.value", { vc: scenarios.mostLikely, name });
  }

  return (
    <SettingsGroup testID="owner-list">
      <SettingsRow
        icon="pulse-outline"
        label={t("myData.reports.title")}
        value={reports.hasHydrated ? localizeDigits(String(reports.count), locale) : null}
        onPress={() => router.push("/my-reports")}
        testID="my-reports-row"
      />
      <SettingsRow
        icon="home-outline"
        label={t("building.section.title")}
        value={homeValue}
        onPress={() => router.push("/my-home")}
        testID="my-home-row"
      />
      <SettingsRow
        icon="people-outline"
        label={t("community.myAccount.people")}
        value={
          pending > 0
            ? t("profile.peopleNew", { number: localizeDigits(String(pending), locale) })
            : null
        }
        valueAccessory={
          pending > 0 ? (
            <View
              style={[styles.dot, { backgroundColor: colors.status.danger }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          ) : null
        }
        onPress={() => router.push("/account/people")}
        testID="account-people-row"
      />
      <DownloadMyDataRow variant="row" />
      {admin.has("authority.view") ? (
        <SettingsRow
          icon="business-outline"
          label={t("officials.title")}
          onPress={() => router.push("/officials")}
          testID="account-officials-row"
        />
      ) : null}
      {admin.any ? (
        <SettingsRow
          icon="shield-checkmark-outline"
          label={t("community.myAccount.admin")}
          onPress={() => router.push("/admin")}
          testID="account-admin-row"
        />
      ) : null}
    </SettingsGroup>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
});
