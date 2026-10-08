import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formatUsername } from "@/features/community/username";
import { formatAbsoluteDual } from "@/features/events";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { formatCount } from "../../people/format";
import { useDebounced } from "../../people/queries";
import { useAdminAccess } from "../../queries";
import { inboxErrorText } from "../error-text";
import { useFeedbackList, useInboxCounts } from "../queries";
import type { InboxTransport } from "../transport";
import {
  FEEDBACK_CATEGORY_FILTERS,
  FEEDBACK_STATUS_FILTERS,
  type FeedbackCategoryFilter,
  type FeedbackFilters,
  type FeedbackRow,
  type FeedbackStatusFilter,
} from "../types";

const DEBOUNCE_MS = 350;

/**
 * Admin > Feedback (migration 0060): every message sent from the app, badge
 * requests and appeals included, newest first. Filters by status and kind,
 * a search over the text, names and @usernames, 50 a page. Each card opens the
 * message. Gated by `feedback.manage` inside; a stray link shows nothing.
 */
export function FeedbackInboxContent({
  transport,
  hubTransport,
}: {
  transport?: InboxTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<FeedbackStatusFilter>("open");
  const [category, setCategory] = useState<FeedbackCategoryFilter>(null);
  const search = useDebounced(text.trim(), DEBOUNCE_MS);
  const filters: FeedbackFilters = useMemo(
    () => ({ status, category, search }),
    [status, category, search],
  );
  const list = useFeedbackList(filters, access.canManageFeedback, transport);
  const counts = useInboxCounts(access.canManageFeedback, transport);
  const rows: FeedbackRow[] = (list.data?.pages ?? []).flat();
  const language = i18n.language;
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canManageFeedback) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="inbox-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }

  const c = counts.data?.feedback ?? null;
  const summary = c
    ? [
        t("admin.feedback.counts.unseen", { count: formatCount(c.unseen, language) }),
        t("admin.feedback.counts.inReview", { count: formatCount(c.inReview, language) }),
        t("admin.feedback.counts.badgeRequests", {
          count: formatCount(c.badgeRequestsOpen, language),
        }),
        t("admin.feedback.counts.appeals", {
          count: formatCount(c.appealsOpen, language),
        }),
      ].join(" · ")
    : null;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      testID="admin-inbox"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[3],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <Text style={meta}>{t("admin.feedback.hint")}</Text>
      {summary ? (
        <Text style={meta} testID="inbox-counts">
          {summary}
        </Text>
      ) : null}

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("admin.feedback.searchPlaceholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.feedback.searchLabel")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            fontSize: typography.bodyDefault.fontSize,
            paddingHorizontal: spacing[3],
            textAlign: "auto",
          },
        ]}
        testID="inbox-search-input"
      />

      <View
        style={styles.chips}
        accessibilityRole="radiogroup"
        testID="inbox-status-filters"
      >
        {FEEDBACK_STATUS_FILTERS.map((candidate) => (
          <ActionButton
            key={candidate}
            label={t(`admin.feedback.statusFilter.${candidate}`)}
            selected={status === candidate}
            onPress={() => setStatus(candidate)}
            testID={`inbox-status-${candidate}`}
          />
        ))}
        <ActionButton
          label={t("admin.feedback.statusFilter.all")}
          selected={status === null}
          onPress={() => setStatus(null)}
          testID="inbox-status-all"
        />
      </View>
      <View
        style={styles.chips}
        accessibilityRole="radiogroup"
        testID="inbox-category-filters"
      >
        <ActionButton
          label={t("admin.feedback.categoryFilter.all")}
          selected={category === null}
          onPress={() => setCategory(null)}
          testID="inbox-category-all"
        />
        {FEEDBACK_CATEGORY_FILTERS.map((candidate) => (
          <ActionButton
            key={candidate}
            label={t(`admin.feedback.categoryFilter.${candidate}`)}
            selected={category === candidate}
            onPress={() => setCategory(candidate)}
            testID={`inbox-category-${candidate}`}
          />
        ))}
      </View>

      {list.isLoading ? (
        <Text style={meta} testID="inbox-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : list.isError ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="inbox-error"
          >
            {inboxErrorText(t, list.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void list.refetch()}
            testID="inbox-retry"
          />
        </View>
      ) : rows.length === 0 ? (
        <Text style={meta} testID="inbox-empty">
          {t("admin.feedback.empty")}
        </Text>
      ) : (
        rows.map((row) => <FeedbackRowItem key={row.id} row={row} />)
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
          testID="inbox-load-more"
        />
      ) : null}
    </ScrollView>
  );
}

function FeedbackRowItem({ row }: { row: FeedbackRow }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const sender =
    row.userId === null
      ? t("admin.feedback.noSender")
      : (row.displayName ??
        (row.username ? formatUsername(row.username) : null) ??
        t("admin.feedback.guest"));
  const heading = [
    t(`admin.feedback.status.${row.status}`),
    row.category ? t(`admin.feedback.category.${row.category}`) : null,
    formatAbsoluteDual(row.createdAt, i18n.language, t).local,
  ]
    .filter(Boolean)
    .join(" · ");
  const details = [
    sender,
    row.platform
      ? t(`admin.people.platforms.${row.platform}`, { defaultValue: row.platform })
      : null,
    row.appVersion,
    row.photoCount > 0
      ? t("admin.feedback.photoCount", {
          count: formatCount(row.photoCount, i18n.language),
        })
      : null,
    row.hasNote ? t("admin.feedback.hasNote") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${row.preview}`}
      onPress={() => router.push(`/admin/feedback/${row.id}`)}
      testID={`inbox-row-${row.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor:
            row.status === "unseen" ? colors.brand.primary : colors.border.default,
          padding: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
          fontWeight: "600",
        }}
        testID={`inbox-row-heading-${row.id}`}
      >
        {heading}
      </Text>
      <Text
        numberOfLines={3}
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          textAlign: "auto",
        }}
      >
        {row.preview}
      </Text>
      <Text style={meta}>{details}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 44 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  card: { borderWidth: 1, borderRadius: 12 },
});
