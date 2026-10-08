import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { formatAbsoluteDual } from "@/features/events";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { PostsTransport } from "@/features/posts/transport";
import { restoreErrorText } from "@/features/undo/error-text";
import { useRecentlyDeleted, useRestoreDeleted } from "@/features/undo/queries";
import type { UndoTransport } from "@/features/undo/transport";
import type { RecentlyDeletedItem } from "@/features/undo/types";
import { useTheme } from "@/theme";

/**
 * "Recently deleted" (migration 0053, owner-only part of the Profile page):
 * the comments and posts I deleted in the last 24 hours, each with Restore.
 * Renders nothing when there is nothing to restore, while loading, or before
 * the migration is applied. Reads only my own rows (`my_recently_deleted()`),
 * so it is mounted by the owner's page alone, like every OwnerSections child.
 */
export function RecentlyDeletedSection({
  transport,
  hubTransport,
  postsTransport,
}: {
  transport?: UndoTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const list = useRecentlyDeleted(transport);
  const items = list.data ?? [];
  if (items.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: spacing[2] }} testID="recently-deleted">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("profile.recentlyDeleted.title")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("profile.recentlyDeleted.hint")}
      </Text>
      {items.map((item) => (
        <DeletedItem
          key={`${item.kind}-${item.id}`}
          item={item}
          {...(hubTransport ? { hubTransport } : {})}
          {...(postsTransport ? { postsTransport } : {})}
        />
      ))}
    </View>
  );
}

function DeletedItem({
  item,
  hubTransport,
  postsTransport,
}: {
  item: RecentlyDeletedItem;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const snackbar = useSnackbar();
  const restore = useRestoreDeleted(hubTransport, postsTransport);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const label =
    item.kind === "post"
      ? t("profile.recentlyDeleted.post")
      : item.place
        ? t("profile.recentlyDeleted.comment", { place: item.place })
        : t("profile.recentlyDeleted.commentNoPlace");
  const until = formatAbsoluteDual(item.expiresAt, i18n.language, t).local;

  async function run() {
    setErrorText(null);
    try {
      await restore.mutateAsync(item);
      snackbar.show({ message: t("snackbar.restored") });
    } catch (error) {
      setErrorText(restoreErrorText(t, error));
    }
  }

  return (
    <View
      testID={`deleted-${item.kind}-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <Text style={meta}>{label}</Text>
      <Text
        numberOfLines={3}
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          // Follows the language of the text, not of the app.
          textAlign: "auto",
        }}
      >
        {item.body}
      </Text>
      <Text style={meta}>{t("profile.recentlyDeleted.until", { time: until })}</Text>
      <View style={styles.actions}>
        <ActionButton
          label={t("profile.recentlyDeleted.restore")}
          disabled={restore.isPending}
          onPress={() => void run()}
          testID={`restore-${item.kind}-${item.id}`}
        />
      </View>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`restore-error-${item.id}`}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
