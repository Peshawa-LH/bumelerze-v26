import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ProfileLink } from "@/features/community/components/ProfileLink";
import { profileHref } from "@/features/community/routes";
import { formatUsername } from "@/features/community/username";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useAdminActions, useReportedProfiles } from "../queries";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { AdminTransport } from "../transport";

/** Profiles readers reported, grouped by person. Hidden when there are none. */
export function ReportedProfilesSection({
  transport,
  hubTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const reports = useReportedProfiles(true, transport);
  const actions = useAdminActions(transport, hubTransport);
  const [errorText, setErrorText] = useState<string | null>(null);

  const rows = reports.data ?? [];
  if (rows.length === 0) {
    return null;
  }
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  return (
    <View style={{ gap: spacing[2] }} testID="admin-reports">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("admin.reports.title")}
      </Text>
      {rows.map((row) => (
        <View
          key={row.userId}
          testID={`reported-${row.userId}`}
          style={[
            styles.item,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              padding: spacing[3],
              gap: spacing[1],
            },
          ]}
        >
          <ProfileLink
            username={row.username}
            name={row.displayName ?? t("eventHub.thread.anonymous")}
            testID={`reported-name-${row.userId}`}
          >
            <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
              {row.displayName ?? t("eventHub.thread.anonymous")}
            </Text>
            {row.username ? (
              <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
                {formatUsername(row.username)}
              </Text>
            ) : null}
          </ProfileLink>
          <Text style={meta}>
            {[
              t("admin.reports.count", {
                number: localizeDigits(String(row.reportCount), i18n.language),
              }),
              row.lastReason ? t(`community.report.reasons.${row.lastReason}`) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <View style={styles.actions}>
            {row.username ? (
              <ActionButton
                label={t("admin.reports.open")}
                onPress={() => router.push(profileHref(row.username as string))}
                testID={`reported-open-${row.userId}`}
              />
            ) : null}
            <ActionButton
              label={t("admin.reports.dismiss")}
              onPress={() =>
                void actions
                  .resolveReports(row.userId)
                  .then(() => setErrorText(null))
                  .catch((error: unknown) => setErrorText(communityErrorText(t, error)))
              }
              testID={`reported-dismiss-${row.userId}`}
            />
          </View>
        </View>
      ))}
      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
