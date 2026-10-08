import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account";
import { formatMagnitudeValue, type Event } from "@/features/events";
import { useEventUuidResult } from "@/features/feltmap/use-event-uuid";
import { placeLine } from "@/features/geo";
import { RestrictionBanner } from "@/features/restrictions/components/RestrictionBanner";
import { useMyRestriction } from "@/features/restrictions/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";

import {
  useEventHubSummary,
  useHubActions,
  useHubThread,
  useMyPermissions,
} from "../queries";
import { buildThreads } from "../threads";
import type { EventHubTransport } from "../transport";
import type { HubActions } from "../queries";
import { HubError, type HubThread, type HubThreadData } from "../types";
import { CommentComposer } from "./CommentComposer";
import { CommentItem, type CommentViewer } from "./CommentItem";
import { HubImpactSection } from "./HubImpactSection";
import { PrebunkCard } from "./PrebunkCard";
import { HubSummaryCard } from "./HubSummaryCard";
import { useTabBarScroll } from "@/features/tab-bar";

interface EventHubContentProps {
  event: Event;
  /** Test seam; the real Supabase transport by default. */
  transport?: EventHubTransport;
}

/**
 * The Event hub body: magnitude + place subtitle, the felt summary, the
 * impact-at-a-glance donuts, a composer, and the threaded comments. Reads refresh every 30 s while the
 * screen is focused, and on pull-to-refresh.
 */
export function EventHubContent({ event, transport }: EventHubContentProps) {
  const tabBarScroll = useTabBarScroll();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const locale = i18n.language;

  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const account = useAccount();
  const isAccount = account.status === "account";
  const viewerId = account.userId;
  const permissions = useMyPermissions(viewerId, transport);
  const isModerator = permissions.has("comments.moderate");
  // Removing any comment needs the server's own answer, not the role fallback.
  const canDelete = !permissions.legacy && permissions.has("comments.delete");
  const canRestrict = !permissions.legacy && permissions.has("accounts.restrict");
  const canSuspend = !permissions.legacy && permissions.has("accounts.suspend");
  // A restricted or suspended account reads but does not write (migration 0054).
  const mine = useMyRestriction();
  const limited = mine.isLimited;

  const uuidState = useEventUuidResult(event);
  const summary = useEventHubSummary(event, {
    polling: focused,
    ...(transport ? { transport } : {}),
  });
  const eventUuid = summary.eventUuid;
  const thread = useHubThread(eventUuid, {
    viewerId,
    isAccount,
    focused,
    ...(transport ? { transport } : {}),
  });
  const actions = useHubActions(eventUuid ?? "", transport);

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The server refused because the account is limited, which this screen did
  // not know yet (a limit made a moment ago): re-read it so the banner appears.
  const postComment = async (input: { parentId: string | null; body: string }) => {
    try {
      await actions.post(input);
    } catch (error) {
      if (error instanceof HubError && error.code === "restricted") {
        void mine.refresh();
      }
      throw error;
    }
  };

  const viewer: CommentViewer = useMemo(
    () => ({
      userId: viewerId,
      isAccount,
      isModerator,
      canDelete,
      canRestrict,
      canSuspend,
    }),
    [viewerId, isAccount, isModerator, canDelete, canRestrict, canSuspend],
  );
  const threads = useMemo(
    () =>
      thread.data
        ? buildThreads(thread.data.comments, {
            userId: viewerId,
            isModerator,
            followingIds: new Set(thread.data.followingIds),
          })
        : [],
    [thread.data, viewerId, isModerator],
  );

  function handleRefresh() {
    setRefreshing(true);
    void Promise.all([thread.refetch(), summary.refetch()]).finally(() =>
      setRefreshing(false),
    );
  }

  const bodyText = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  const subtitle = `${t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(event.magnitude.value, locale),
  })} · ${placeLine(event, locale, t)}`;

  const unavailable =
    !isSupabaseConfigured() || (eventUuid === null && !uuidState.isPending);
  const waiting =
    !unavailable && (eventUuid === null || (thread.isLoading && !thread.data));
  const loadFailed = thread.isError && !thread.data;

  const header = (
    <View style={{ gap: spacing[4], paddingBottom: spacing[4] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
        testID="hub-subtitle"
      >
        {subtitle}
      </Text>
      <PrebunkCard />
      {unavailable ? (
        <Text style={bodyText}>{t("eventHub.unavailable")}</Text>
      ) : (
        <>
          <HubSummaryCard summary={summary.summary} />
          <HubImpactSection event={event} summary={summary.summary} />
          <RestrictionBanner />
          <CommentComposer
            isAccount={isAccount}
            disabled={limited}
            placeholder={
              summary.summary?.featured && summary.summary.reports === 0
                ? t("eventHub.composer.memoryPlaceholder")
                : t("eventHub.composer.placeholder")
            }
            onSubmit={(body) => postComment({ parentId: null, body })}
          />
        </>
      )}
    </View>
  );

  let empty = null;
  if (!unavailable) {
    if (waiting) {
      empty = <Text style={bodyText}>{t("eventDetail.loading")}</Text>;
    } else if (loadFailed) {
      empty = (
        <View style={{ gap: spacing[2] }}>
          <Text style={bodyText}>{t("eventHub.loadError")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void thread.refetch()}
            style={styles.retry}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("events.retry")}
            </Text>
          </Pressable>
        </View>
      );
    } else {
      empty = (
        <Text style={bodyText} testID="hub-empty">
          {t("eventHub.thread.empty")}
        </Text>
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList<HubThread>
        {...tabBarScroll}
        testID="hub-list"
        data={unavailable ? [] : threads}
        keyExtractor={(item) => item.root.id}
        renderItem={({ item }) => (
          <ThreadView
            thread={item}
            data={thread.data}
            viewer={viewer}
            nowMs={thread.dataUpdatedAt}
            actions={actions}
            limited={limited}
            onSubmitReply={postComment}
            isReplying={replyTo === item.root.id}
            onReply={() => setReplyTo(item.root.id)}
            onCloseReply={() => setReplyTo(null)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border.subtle,
              marginVertical: spacing[3],
            }}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing[5],
          paddingBottom: insets.bottom + spacing[8],
        }}
        style={{ backgroundColor: colors.surface.base }}
      />
    </KeyboardAvoidingView>
  );
}

interface ThreadViewProps {
  thread: HubThread;
  data: HubThreadData | null;
  viewer: CommentViewer;
  nowMs: number;
  actions: HubActions;
  /** The viewer's account is limited: reply boxes stay off. */
  limited: boolean;
  onSubmitReply: (input: { parentId: string | null; body: string }) => Promise<void>;
  isReplying: boolean;
  onReply: () => void;
  onCloseReply: () => void;
}

function ThreadView({
  thread,
  data,
  viewer,
  nowMs,
  actions,
  limited,
  onSubmitReply,
  isReplying,
  onReply,
  onCloseReply,
}: ThreadViewProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const helped = useMemo(() => new Set(data?.helpedIds ?? []), [data]);
  const following = useMemo(() => new Set(data?.followingIds ?? []), [data]);
  const flagged = useMemo(() => new Set(data?.flaggedIds ?? []), [data]);

  const renderComment = (comment: HubThread["root"], isReply: boolean) => (
    <CommentItem
      key={comment.id}
      comment={comment}
      author={comment.userId ? data?.authors[comment.userId] : undefined}
      roles={comment.userId ? data?.roles[comment.userId] : undefined}
      viewer={viewer}
      helped={helped.has(comment.id)}
      flagged={flagged.has(comment.id)}
      isFollowing={comment.userId !== null && following.has(comment.userId)}
      nowMs={nowMs}
      actions={actions}
      isReply={isReply}
      {...(isReply ? {} : { onReply })}
    />
  );

  return (
    <View style={{ gap: spacing[3] }} testID={`thread-${thread.root.id}`}>
      {renderComment(thread.root, false)}
      {thread.replies.map((reply) => renderComment(reply, true))}
      {isReplying ? (
        <View style={{ marginStart: spacing[6] }}>
          <CommentComposer
            isAccount={viewer.isAccount}
            placeholder={t("eventHub.composer.replyPlaceholder")}
            disabled={limited}
            onSubmit={(body) => onSubmitReply({ parentId: thread.root.id, body })}
            onCancel={onCloseReply}
            autoFocus
            testID={`reply-composer-${thread.root.id}`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  retry: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
});
