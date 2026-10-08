import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatUsername } from "@/features/community/username";
import { formatAbsoluteDual } from "@/features/events";
import { FLAG_REASONS } from "@/features/eventhub/types";
import { useTheme } from "@/theme";
import type { ActivityEntry } from "../types";

/** One line of the activity log: what was done, by whom, to whom, when, why.
 * `renderAction` is where the next batch puts its Undo / Restore button. */
export function ActivityRow({
  entry,
  onFilterPerson,
  renderAction,
}: {
  entry: ActivityEntry;
  /** Tapping the person the action was done to filters the list by them. */
  onFilterPerson?: (entry: ActivityEntry) => void;
  renderAction?: (entry: ActivityEntry) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const actor =
    entry.actorId === null
      ? t("admin.activity.system")
      : (entry.actorName ??
        (entry.actorUsername ? formatUsername(entry.actorUsername) : null) ??
        t("eventHub.thread.anonymous"));
  const target =
    entry.targetUserId === null
      ? null
      : (entry.targetName ??
        (entry.targetUsername ? formatUsername(entry.targetUsername) : null) ??
        t("eventHub.thread.anonymous"));
  const when = formatAbsoluteDual(entry.createdAt, i18n.language, t).local;
  const action = renderAction?.(entry) ?? null;

  return (
    <View
      testID={`activity-${entry.id}`}
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
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontWeight: "600",
        }}
        testID={`activity-action-${entry.id}`}
      >
        {t(`admin.activity.actions.${entry.action}`, { defaultValue: entry.action })}
        {entry.revertedBy ? ` · ${t("admin.activity.undone")}` : ""}
      </Text>
      <Text style={meta} testID={`activity-actor-${entry.id}`}>
        {[
          t("admin.activity.by", { name: actor }),
          entry.actorRank
            ? t(`eventHub.roles.${entry.actorRank}`, { defaultValue: entry.actorRank })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {target ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("admin.activity.filterPerson", { name: target })}
          disabled={!onFilterPerson}
          onPress={() => onFilterPerson?.(entry)}
          hitSlop={6}
          testID={`activity-target-${entry.id}`}
        >
          <Text style={meta}>{t("admin.activity.to", { name: target })}</Text>
        </Pressable>
      ) : null}
      {entry.targetSummary && entry.targetType === "comment" ? (
        <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
          {entry.targetSummary}
        </Text>
      ) : null}
      {reasonText(entry, t) ? <Text style={meta}>{reasonText(entry, t)}</Text> : null}
      {entry.note ? <Text style={meta}>{entry.note}</Text> : null}
      <Text style={meta}>{when}</Text>
      {action}
    </View>
  );
}

function reasonText(entry: ActivityEntry, t: TFunction): string | null {
  const reason = entry.reason;
  if (!reason) {
    return null;
  }
  if (entry.action === "role_grant" || entry.action === "role_revoke") {
    return t(`eventHub.roles.${reason}`, { defaultValue: reason });
  }
  if ((FLAG_REASONS as readonly string[]).includes(reason)) {
    return t(`eventHub.reasons.${reason}`);
  }
  return t(`admin.activity.reasons.${reason}`, { defaultValue: reason });
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, borderRadius: 12 },
});
