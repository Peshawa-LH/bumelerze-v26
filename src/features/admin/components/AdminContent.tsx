import { useRouter, type Href } from "expo-router";
import type { Ionicons } from "@expo/vector-icons";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { formatCount } from "../people/format";
import { useAdminAccess } from "../queries";
import { useToolCounts } from "../tools/queries";
import type { ToolCountsTransport } from "../tools/transport";
import { ToolPage, ToolTile, ToolTileGrid } from "../ui";

interface Tile {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  status: string | null;
  dot?: "attention" | "info" | null;
  href: Href;
}

/**
 * Admin home (review 15.1, mockup 5a): a launcher of tool tiles ONLY, two per
 * row, each with a status line. Nothing can be done on this page itself;
 * every tool opens its own page. Each tile shows only for the permission its
 * tool needs (`people.view`, `comments.moderate`, `filter.manage`,
 * `alerts.test`, `stats.read`, `hubs.open`, `feedback.manage`, `audit.read`),
 * and everything is hidden for people without any, so a stray link shows
 * nothing. Felt photos and limited accounts live inside the Moderation queue;
 * badges are given from People > person.
 */
export function AdminContent({
  hubTransport,
  countsTransport,
}: {
  hubTransport?: EventHubTransport;
  /** Test seam for `admin_tool_counts()` (migration 0066). */
  countsTransport?: ToolCountsTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const router = useRouter();
  const access = useAdminAccess(hubTransport);
  const counts = useToolCounts(access.any, countsTransport).data;
  const n = (value: number) => formatCount(value, i18n.language);

  const tiles: Tile[] = [];
  if (access.canViewPeople) {
    tiles.push({
      key: "people",
      icon: "people-outline",
      title: t("admin.tools.people"),
      status:
        counts?.accounts != null
          ? t("admin.tools.accounts", { number: n(counts.accounts) })
          : null,
      href: "/admin/people",
    });
  }
  if (access.canModerate || access.canModeratePhotos || access.canRestrict) {
    const waiting = counts?.waiting ?? null;
    tiles.push({
      key: "moderation",
      icon: "shield-checkmark-outline",
      title: t("admin.tools.moderation"),
      status:
        waiting === null
          ? t("admin.tools.moderationHint")
          : waiting > 0
            ? t("admin.tools.waiting", { number: n(waiting) })
            : t("admin.tools.nothingWaiting"),
      dot: waiting !== null && waiting > 0 ? "attention" : null,
      href: "/admin/moderation",
    });
  }
  if (access.canModerate) {
    tiles.push({
      key: "hidden",
      icon: "eye-off-outline",
      title: t("admin.tools.hidden"),
      status: t("admin.tools.last30"),
      href: "/admin/hidden",
    });
  }
  if (access.has("filter.manage")) {
    tiles.push({
      key: "filter",
      icon: "funnel-outline",
      title: t("admin.tools.filter"),
      status:
        counts?.busy == null
          ? null
          : counts.busy
            ? t("admin.tools.busyOn")
            : t("admin.tools.busyOff"),
      dot: counts?.busy ? "attention" : null,
      href: "/admin/filter",
    });
  }
  if (access.has("alerts.test")) {
    const mode = counts?.alertsMode ?? null;
    tiles.push({
      key: "alerts",
      icon: "notifications-outline",
      title: t("admin.tools.alerts"),
      status:
        mode === null
          ? null
          : t("admin.tools.alertsStatus", {
              mode: t(`admin.alerts.modes.${mode}`, { defaultValue: mode }),
              number: n(counts?.alertDevices ?? 0),
            }),
      href: "/admin/alerts",
    });
  }
  if (access.has("stats.read")) {
    tiles.push({
      key: "stats",
      icon: "bar-chart-outline",
      title: t("admin.tools.stats"),
      status: t("admin.tools.statsHint"),
      href: "/admin/stats",
    });
  }
  if (access.has("hubs.open")) {
    tiles.push({
      key: "hubs",
      icon: "chatbubbles-outline",
      title: t("admin.tools.hubs"),
      status:
        counts?.hubsOpen != null
          ? t("admin.tools.hubsOpen", { number: n(counts.hubsOpen) })
          : null,
      href: "/admin/hubs",
    });
  }
  if (access.canManageFeedback) {
    const fresh = counts?.feedbackNew ?? null;
    tiles.push({
      key: "feedback",
      icon: "mail-unread-outline",
      title: t("admin.tools.feedback"),
      status:
        fresh === null
          ? null
          : fresh > 0
            ? t("admin.tools.new", { number: n(fresh) })
            : t("admin.tools.nothingNew"),
      dot: fresh !== null && fresh > 0 ? "info" : null,
      href: "/admin/feedback",
    });
  }
  if (access.canAudit) {
    tiles.push({
      key: "activity",
      icon: "time-outline",
      title: t("admin.tools.activity"),
      status: t("admin.tools.activityHint"),
      href: "/admin/activity",
    });
  }

  return (
    <ToolPage testID="admin-launcher">
      {access.any || access.isLoading ? null : (
        <Text
          testID="admin-no-access"
          style={[typography.bodyDefault, { color: colors.text.secondary }]}
        >
          {t("community.errors.forbidden")}
        </Text>
      )}
      {tiles.length > 0 ? (
        <ToolTileGrid testID="admin-tiles">
          {tiles.map((tile) => (
            <ToolTile
              key={tile.key}
              icon={tile.icon}
              title={tile.title}
              status={tile.status}
              dot={tile.dot ?? null}
              onPress={() => router.push(tile.href)}
              testID={`admin-tile-${tile.key}`}
            />
          ))}
        </ToolTileGrid>
      ) : null}
    </ToolPage>
  );
}
