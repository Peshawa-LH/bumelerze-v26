import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSnackbar } from "@/components/Snackbar";
import { communityErrorText } from "@/features/community/error-text";
import { formatUsername } from "@/features/community/username";
import { formatAbsoluteDual } from "@/features/events";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { FLAG_REASONS } from "@/features/eventhub/types";
import type { PostsTransport } from "@/features/posts/transport";
import { restoreErrorText } from "@/features/undo/error-text";
import { useTheme } from "@/theme";
import { useAdminAccess, useAdminActions, useHiddenRemoved } from "../queries";
import type { AdminTransport } from "../transport";
import type { HiddenRemovedItem } from "../types";

/**
 * Admin > Hidden and removed (migration 0053): comments a moderator hid and
 * comments and posts an admin removed, last 30 days, newest first, each with
 * Restore. A moderator restores what was hidden; only the official account
 * (`content.restore`) restores what was removed and reads the removed text, so
 * for everyone else a removed item shows no text and no Restore. The server
 * decides both (`can_restore`, `body`); this screen only follows.
 */
export function HiddenRemovedContent({
  transport,
  hubTransport,
  postsTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const list = useHiddenRemoved(access.canModerate, transport);
  const rows: HiddenRemovedItem[] = (list.data?.pages ?? []).flat();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canModerate) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="hidden-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      testID="admin-hidden"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[3],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <Text style={meta}>{t("admin.hidden.hint")}</Text>

      {list.isLoading ? (
        <Text style={meta} testID="hidden-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : list.isError ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="hidden-error"
          >
            {communityErrorText(t, list.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void list.refetch()}
            testID="hidden-retry"
          />
        </View>
      ) : rows.length === 0 ? (
        <Text style={meta} testID="hidden-empty">
          {t("admin.hidden.empty")}
        </Text>
      ) : (
        rows.map((item) => (
          <HiddenRemovedRow
            key={`${item.kind}-${item.id}`}
            item={item}
            {...(transport ? { transport } : {})}
            {...(hubTransport ? { hubTransport } : {})}
            {...(postsTransport ? { postsTransport } : {})}
          />
        ))
      )}

      {list.hasNextPage ? (
        <ActionButton
          label={
            list.isFetchingNextPage
              ? t("eventDetail.loading")
              : t("admin.activity.loadMore")
          }
          disabled={list.isFetchingNextPage}
          onPress={() => void list.fetchNextPage()}
          testID="hidden-load-more"
        />
      ) : null}
    </ScrollView>
  );
}

function HiddenRemovedRow({
  item,
  transport,
  hubTransport,
  postsTransport,
}: {
  item: HiddenRemovedItem;
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const snackbar = useSnackbar();
  const { colors, typography, spacing } = useTheme();
  const actions = useAdminActions(transport, hubTransport, postsTransport);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const heading =
    item.kind === "post"
      ? t("admin.hidden.removedPost")
      : item.kind === "post_comment"
        ? item.status === "hidden"
          ? t("admin.hidden.hiddenPostComment")
          : t("admin.hidden.removedPostComment")
        : item.status === "hidden"
          ? t("admin.hidden.hiddenComment")
          : t("admin.hidden.removedComment");
  const author =
    item.authorName ??
    (item.authorUsername ? formatUsername(item.authorUsername) : null) ??
    t("eventHub.thread.anonymous");
  const when = formatAbsoluteDual(item.actedAt, i18n.language, t).local;
  const reason = item.reason
    ? (FLAG_REASONS as readonly string[]).includes(item.reason)
      ? t(`eventHub.reasons.${item.reason}`)
      : t(`admin.activity.reasons.${item.reason}`, { defaultValue: item.reason })
    : null;

  async function restore() {
    setBusy(true);
    setErrorText(null);
    try {
      await (item.kind === "post"
        ? actions.restorePost(item.id)
        : item.kind === "post_comment"
          ? actions.restorePostComment(item.id)
          : actions.restoreComment(item.id));
      snackbar.show({ message: t("snackbar.restored") });
    } catch (error) {
      setErrorText(restoreErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      testID={`hidden-${item.kind}-${item.id}`}
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
        testID={`hidden-heading-${item.id}`}
      >
        {heading}
      </Text>
      <Text style={meta}>
        {[
          author,
          item.actorName ? t("admin.activity.by", { name: item.actorName }) : null,
          reason,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {item.kind === "comment" && (item.place || item.hubId) ? (
        <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
          {item.place ?? item.hubId}
        </Text>
      ) : null}
      {item.body !== null && item.body !== "" ? (
        <Text
          testID={`hidden-body-${item.id}`}
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            textAlign: "auto",
          }}
        >
          {item.body}
        </Text>
      ) : (
        <Text
          style={[meta, { fontStyle: "italic" }]}
          testID={`hidden-text-hidden-${item.id}`}
        >
          {t("admin.hidden.textHidden")}
        </Text>
      )}
      <Text style={meta}>{when}</Text>
      <View style={styles.actions}>
        {item.kind === "comment" && item.hubId ? (
          <ActionButton
            label={t("admin.queue.open")}
            onPress={() => router.push(`/event-hub/${item.hubId as string}`)}
            testID={`hidden-open-${item.id}`}
          />
        ) : null}
        {item.canRestore ? (
          <ActionButton
            label={t("admin.hidden.restore")}
            disabled={busy}
            onPress={() => void restore()}
            testID={`hidden-restore-${item.id}`}
          />
        ) : (
          <Text style={meta} testID={`hidden-cannot-restore-${item.id}`}>
            {t("admin.hidden.cannotRestore")}
          </Text>
        )}
      </View>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`hidden-error-${item.id}`}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  item: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
