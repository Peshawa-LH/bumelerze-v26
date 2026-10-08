import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { formatAbsoluteDual } from "@/features/events";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import { useTheme } from "@/theme";
import { formatCount, personName } from "../format";
import type { PersonRow } from "../types";
import { StatusChip } from "./StatusChip";

/** One line of the directory. The whole card opens the person's page. Shows
 * counts only: never a location, a device id or a full email. */
export function PersonRowItem({ row }: { row: PersonRow }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const language = i18n.language;
  const name = personName(t, row);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const date = (value: number) => formatAbsoluteDual(value, language, t).local;
  const c = row.counts;
  const counts = [
    t("admin.people.counts.feltReports", { count: formatCount(c.feltReports, language) }),
    t("admin.people.counts.comments", { count: formatCount(c.comments, language) }),
    t("admin.people.counts.posts", { count: formatCount(c.posts, language) }),
    t("admin.people.counts.homes", {
      owned: formatCount(c.homesOwned, language),
      member: formatCount(c.homesMember, language),
    }),
    t("admin.people.counts.feedback", { count: formatCount(c.feedback, language) }),
  ].join(" · ");
  const when = [
    row.joined !== null ? t("admin.people.joined", { date: date(row.joined) }) : null,
    row.lastSeen !== null ? t("admin.people.lastSeen", { date: date(row.lastSeen) }) : null,
    row.platform ? t(`admin.people.platforms.${row.platform}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${t(`admin.people.status.${row.status}`)}`}
      onPress={() => router.push(`/admin/person/${row.userId}`)}
      testID={`person-row-${row.userId}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[3],
        },
      ]}
    >
      <Avatar
        uri={getAvatarUrl(row.avatarPath)}
        name={row.displayName}
        placeholder="person"
        size={44}
        testID={`person-row-avatar-${row.userId}`}
      />
      <View style={[styles.body, { gap: spacing[1] }]}>
        <View style={[styles.nameRow, { gap: spacing[2] }]}>
          <Text
            numberOfLines={1}
            style={[typography.bodyDefault, styles.name, { color: colors.text.primary, fontWeight: "600" }]}
            testID={`person-row-name-${row.userId}`}
          >
            {name}
          </Text>
          <RoleMark roles={row.ranks.map((role) => ({ role, orgName: null }))} />
          <StatusChip status={row.status} testID={`person-row-status-${row.userId}`} />
        </View>
        {row.username && row.displayName ? (
          <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
            @{row.username}
          </Text>
        ) : null}
        {row.kind === "guest" ? (
          <Text style={meta}>{t("admin.people.guestKind")}</Text>
        ) : null}
        {row.maskedEmail ? (
          <Text
            style={[meta, { writingDirection: "ltr", textAlign: "left" }]}
            testID={`person-row-email-${row.userId}`}
          >
            {row.maskedEmail}
          </Text>
        ) : null}
        {when ? <Text style={meta}>{when}</Text> : null}
        <Text style={meta} testID={`person-row-counts-${row.userId}`}>
          {counts}
        </Text>
        {row.openReports > 0 ? (
          <Text
            style={[meta, { color: colors.status.danger, fontWeight: "600" }]}
            testID={`person-row-reports-${row.userId}`}
          >
            {t("admin.people.openReports", { count: formatCount(row.openReports, language) })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center" },
  body: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  name: { flexShrink: 1 },
});
