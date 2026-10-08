import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual } from "@/features/events";
import { useTheme } from "@/theme";
import { formatCount } from "../format";
import { usePeopleStats } from "../queries";
import type { PeopleTransport } from "../transport";

/** The numbers at the top of Admin > People: users, new, active, limited and
 * by platform. Counts only. Guest numbers appear only when the server sends
 * them (`people.view_guests`). "Active" counts start when presence tracking
 * started; before that nothing is known, and the header says so. */
export function PeopleStatsHeader({
  enabled,
  transport,
}: {
  enabled: boolean;
  transport?: PeopleTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const stats = usePeopleStats(enabled, transport);
  const language = i18n.language;
  const n = (value: number) => formatCount(value, language);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (stats.isLoading) {
    return (
      <Text style={meta} testID="people-stats-loading">
        {t("eventDetail.loading")}
      </Text>
    );
  }
  const d = stats.data;
  if (!d) {
    return null;
  }
  const tiles: { id: string; label: string; value: string; sub?: string }[] = [
    { id: "accounts", label: t("admin.people.stats.accounts"), value: n(d.accountsTotal) },
    ...(d.guestsTotal !== null
      ? [{ id: "guests", label: t("admin.people.stats.guests"), value: n(d.guestsTotal) }]
      : []),
    { id: "new7", label: t("admin.people.stats.new7"), value: n(d.newAccounts7d) },
    { id: "new30", label: t("admin.people.stats.new30"), value: n(d.newAccounts30d) },
    {
      id: "active7",
      label: t("admin.people.stats.active7"),
      value: n(d.activeAccounts7d),
      ...(d.activeGuests7d !== null
        ? { sub: t("admin.people.stats.guestsSub", { count: n(d.activeGuests7d) }) }
        : {}),
    },
    {
      id: "active30",
      label: t("admin.people.stats.active30"),
      value: n(d.activeAccounts30d),
      ...(d.activeGuests30d !== null
        ? { sub: t("admin.people.stats.guestsSub", { count: n(d.activeGuests30d) }) }
        : {}),
    },
    { id: "restricted", label: t("admin.people.stats.restricted"), value: n(d.restricted) },
    { id: "suspended", label: t("admin.people.stats.suspended"), value: n(d.suspended) },
  ];

  return (
    <View
      testID="people-stats"
      style={[
        styles.box,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <Text accessibilityRole="header" style={[typography.bodyDefault, { color: colors.text.primary, fontWeight: "600" }]}>
        {t("admin.people.stats.title")}
      </Text>
      <View style={[styles.grid, { gap: spacing[2] }]}>
        {tiles.map((tile) => (
          <View
            key={tile.id}
            style={styles.tile}
            accessible
            accessibilityLabel={`${tile.label}: ${tile.value}${tile.sub ? `, ${tile.sub}` : ""}`}
            testID={`people-stat-${tile.id}`}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.h3.fontSize,
                fontWeight: "700",
              }}
              testID={`people-stat-value-${tile.id}`}
            >
              {tile.value}
            </Text>
            <Text style={meta}>{tile.label}</Text>
            {tile.sub ? <Text style={meta}>{tile.sub}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={meta} testID="people-stats-platforms">
        {t("admin.people.stats.platforms", {
          ios: n(d.platforms.ios),
          android: n(d.platforms.android),
          web: n(d.platforms.web),
        })}
      </Text>
      <Text style={meta} testID="people-stats-since">
        {d.presenceSince !== null
          ? t("admin.people.stats.since", {
              date: formatAbsoluteDual(d.presenceSince, language, t).local,
            })
          : t("admin.people.stats.noPresence")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: { minWidth: 120, flexGrow: 1, flexBasis: "30%" },
});
