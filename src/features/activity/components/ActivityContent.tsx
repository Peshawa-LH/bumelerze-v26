import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { formatRelativeTimeValue, getRelativeTime } from "@/features/events";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { ReviewSheet } from "@/features/restrictions/components/ReviewSheet";
import { useTheme } from "@/theme";
import { useActivity, useActivityActions } from "../queries";
import { activityDetail, activityHref, activityMessage } from "../text";
import type { ActivityTransport } from "../transport";
import type { ActivityItem, ActivityKind } from "../types";

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<ActivityKind, IconName> = {
  new_follower: "person-add-outline",
  follow_request: "person-add-outline",
  follow_accepted: "people-outline",
  comment_reply: "chatbubble-outline",
  comment_helpful: "thumbs-up-outline",
  post_helpful: "thumbs-up-outline",
  content_removed: "eye-off-outline",
  badge_granted: "ribbon-outline",
  report_reviewed: "checkmark-circle-outline",
  home_join_request: "home-outline",
  home_join_approved: "home-outline",
  family_safe: "heart-outline",
  post_comment: "chatbubbles-outline",
  post_comment_reply: "chatbubble-outline",
  mention: "at-outline",
};

/**
 * The Activity screen's body (migration 0061): what happened around me, newest
 * first. In the app only; it never sends a push. Opening it marks everything
 * read for the bell, while this visit still shows which rows were new. A
 * removed comment or post carries the reason and "Ask for review".
 */
export function ActivityContent({ transport }: { transport?: ActivityTransport }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const list = useActivity(transport);
  const actions = useActivityActions(transport);
  const marked = useRef(false);
  const [reviewing, setReviewing] = useState<ActivityItem | null>(null);

  const hasUnread = list.items.some((item) => !item.read);
  useEffect(() => {
    if (!marked.current && hasUnread) {
      marked.current = true;
      actions.markAllRead().catch(() => {
        marked.current = false;
      });
    }
  }, [hasUnread, actions]);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  if (list.isUnavailable) {
    return (
      <Text style={meta} testID="activity-unavailable">
        {t("community.errors.unavailable")}
      </Text>
    );
  }
  if (list.isLoading) {
    return (
      <Text style={meta} testID="activity-loading">
        {t("eventDetail.loading")}
      </Text>
    );
  }
  if (list.isError && list.items.length === 0) {
    return (
      <View style={{ gap: spacing[2] }}>
        <Text accessibilityRole="alert" style={meta} testID="activity-error">
          {t("activity.loadError")}
        </Text>
        <AccountButton
          label={t("activity.retry")}
          onPress={() => void list.refetch()}
          testID="activity-retry"
        />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[3] }} testID="activity-list">
      <Text style={[meta, { fontSize: typography.bodyMeta.fontSize }]}>
        {t("activity.hint")}
      </Text>
      {list.items.length === 0 ? (
        <Text style={meta} testID="activity-empty">
          {t("activity.empty")}
        </Text>
      ) : (
        list.items.map((item) => (
          <ActivityRow
            key={item.id}
            item={item}
            nowMs={list.updatedAt}
            onReview={() => setReviewing(item)}
          />
        ))
      )}
      {list.hasMore ? (
        <AccountButton
          label={t("activity.older")}
          disabled={list.isFetchingMore}
          onPress={list.loadMore}
          testID="activity-older"
        />
      ) : null}
      {reviewing ? (
        <ReviewSheet
          onClose={() => setReviewing(null)}
          onSend={async (message) => {
            await actions.requestReview(reviewing.id, message);
            setReviewing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function ActivityRow({
  item,
  nowMs,
  onReview,
}: {
  item: ActivityItem;
  nowMs: number;
  onReview: () => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const message = activityMessage(t, item, locale);
  const detail = activityDetail(t, item);
  const href = activityHref(item);
  const relative = getRelativeTime(item.createdAt, nowMs);
  const when =
    relative.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relative.unit}`, {
          value: formatRelativeTimeValue(relative.value, locale),
        });

  const body = (
    <View style={[styles.row, { gap: spacing[3] }]}>
      <Ionicons
        name={ICONS[item.kind]}
        size={22}
        color={item.read ? colors.text.secondary : colors.brand.primary}
        style={styles.icon}
      />
      <View style={[styles.text, { gap: spacing[1] }]}>
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            fontWeight: item.read ? "400" : "600",
          }}
        >
          {message}
        </Text>
        {detail ? (
          <Text
            numberOfLines={3}
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
              textAlign: "auto",
            }}
          >
            {detail}
          </Text>
        ) : null}
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {item.read ? when : `${t("activity.new")} · ${when}`}
        </Text>
        {item.kind === "content_removed" ? (
          item.appealed ? (
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
              }}
              testID={`activity-review-sent-${item.id}`}
            >
              {t("activity.removed.reviewSent")}
            </Text>
          ) : (
            <View style={styles.actions}>
              <ActionButton
                label={t("activity.removed.review")}
                onPress={onReview}
                testID={`activity-review-${item.id}`}
              />
            </View>
          )
        ) : null}
      </View>
    </View>
  );

  const box = [
    styles.card,
    {
      backgroundColor: item.read ? colors.surface.base : colors.surface.raised,
      borderColor: colors.border.default,
      padding: spacing[3],
    },
  ];
  return href ? (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={detail ? `${message} ${detail}` : message}
      onPress={() => router.push(href as Href)}
      style={box}
      testID={`activity-${item.id}`}
    >
      {body}
    </Pressable>
  ) : (
    <View style={box} testID={`activity-${item.id}`}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, minHeight: 44 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  icon: { marginTop: 2 },
  text: { flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
