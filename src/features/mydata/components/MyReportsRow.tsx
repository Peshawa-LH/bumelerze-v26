import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { localizeDigits } from "@/lib/format-numbers";
import { useMyReports } from "../use-my-reports";

/**
 * "My reports (n)" as one row in the owner-only part of the Profile page,
 * opening the full list on its own page (review note 15.5, 2026-10-13): the
 * reports no longer sit on the profile itself, so they stop pushing the
 * rows below them (admin tools, Download my data, ...) down the page.
 */
export function MyReportsRow() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { hasHydrated, count } = useMyReports();
  const label = t("myData.reports.title");
  const value = hasHydrated ? localizeDigits(String(count), i18n.language) : null;
  return (
    <SettingsGroup testID="my-reports-group">
      <SettingsRow
        icon="pulse-outline"
        label={label}
        value={value}
        onPress={() => router.push("/my-reports")}
        testID="my-reports-row"
      />
    </SettingsGroup>
  );
}
