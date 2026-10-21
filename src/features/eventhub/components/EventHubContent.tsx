import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
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

import { DirectionalChevron } from "@/components/DirectionalChevron";
import { Avatar, getAvatarUrl, useAccount } from "@/features/account";
import {
  useContentFilterActions,
  useSurgeActive,
} from "@/features/contentfilter/queries";
import type { ContentFilterTransport } from "@/features/contentfilter/transport";
import {
  formatAbsoluteDual,
  formatDepthKm,
  formatMagnitudeValue,
  isolateLocalizedTime,
  isolateNumeric,
  type Event,
} from "@/features/events";
import {
  encodeEventRegistrationParam,
  toEventRegistration,
} from "@/features/felt/event-registration";
import { useEventUuidResult } from "@/features/feltmap/use-event-uuid";
import { nearestCities, pickLocalizedName, placeLine } from "@/features/geo";
import { useMutedIds } from "@/features/mute/queries";
import { RestrictionBanner } from "@/features/restrictions/components/RestrictionBanner";
import { useMyRestriction } from "@/features/restrictions/queries";
import { ShareSheet } from "@/features/share/ShareSheet";
import { shareIdFor } from "@/features/share/share-id";
import { ActionRow } from "@/features/social/components/ActionRow";
import { EventMark, PostHeader } from "@/features/social/components/PostHeader";
import { ReplyToggle } from "@/features/social/components/ReplyToggle";
import { useHubLikes } from "@/features/social/queries";
import type { SocialTransport } from "@/features/social/transport";
import { useTabBarScroll } from "@/features/tab-bar";
import { isSupabaseConfigured } from "@/lib/supabase";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

import { HubCarousel } from "../carousel/HubCarousel";
import { useHubSlides } from "../carousel/use-hub-slides";
import {
  useEventHubSummary,
  useHubActions,
  useHubThread,
  useMyPermissions,
} from "../queries";
import { buildThreads } from "../threads";
import type { EventHubTransport } from "../transport";
import type { HubActions } from "../queries";
import { HubError, type HubRole, type HubThread, type HubThreadData } from "../types";
import { CommentComposer } from "./CommentComposer";
import { CommentItem, type CommentViewer, type PinActions } from "./CommentItem";
import { PrebunkCard } from "./PrebunkCard";
import { RoleMark } from "./RoleMark";

interface EventHubContentProps {
  event: Event;
  /** The `bml` id the screen was opened with, when it was one. */
  bumelerzeId?: string | null;
  /** Test seam; the real Supabase transport by default. */
  transport?: EventHubTransport;
  /** Test seam for pins and the busy-time banner (migration 0059). */
  filterTransport?: ContentFilterTransport;
  /** Test seam for the heart and the slides' aggregates (migration 0065). */
  socialTransport?: SocialTransport;
}

/** Within this distance the header says "near {town}"; farther, the place
 * line ("120 km E of ..."). */
const NEAR_TOWN_KM = 150;

/** The official mark beside the earthquake's name: the hub is Bumelerze's. */
const OFFICIAL: readonly HubRole[] = [{ role: "official", orgName: null }];

/**
 * The Event hub as a post (review notes 4.3 and 4.4): a header like a post
 * (the earthquake's magnitude ring, "M 7.3 · near Halabja", the official
 * mark, the date, "..."), the swipeable slides, one action row (heart,
 * comments, "N felt it", share), the facts line and a link to the
 * earthquake page, the calm prediction note, then the conversation with
 * the team's pinned note first. "Add a comment..." stays docked at the
 * bottom with the reader's photo. Reads refresh every 30 s while the screen
 * is in front, and on pull-to-refresh.
 */
export function EventHubContent({
  event,
  bumelerzeId = null,
  transport,
  filterTransport,
  socialTransport,
}: EventHubContentProps) {
  const tabBarScroll = useTabBarScroll();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
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
  const mutedIds = useMutedIds();
  const permissions = useMyPermissions(viewerId, transport);
  const isModerator = permissions.has("comments.moderate");
  // Removing any comment needs the server's own answer, not the role fallback.
  const canDelete = !permissions.legacy && permissions.has("comments.delete");
  const canRestrict = !permissions.legacy && permissions.has("accounts.restrict");
  const canSuspend = !permissions.legacy && permissions.has("accounts.suspend");
  const canPin = !permissions.legacy && permissions.has("hubs.feature");
  const filterActions = useContentFilterActions(filterTransport);
  const pinActions: PinActions = {
    pin: filterActions.pinComment,
    unpin: filterActions.unpinComment,
  };
  // Busy-time review (migration 0059): new accounts' comments wait for review.
  const surge = useSurgeActive(filterTransport);
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
  const likes = useHubLikes(eventUuid, {
    polling: focused,
    ...(socialTransport ? { transport: socialTransport } : {}),
  });
  const shareId = shareIdFor(event, bumelerzeId);
  const slides = useHubSlides({
    event,
    shareId,
    eventUuid,
    summary: summary.summary,
    ...(socialTransport ? { transport: socialTransport } : {}),
  });

  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [likeError, setLikeError] = useState(false);

  // The server refused because the account is limited, which this screen did
  // not know yet (a limit made a moment ago): re-read it so the banner appears.
  const postComment = async (input: { parentId: string | null; body: string }) => {
    try {
      await actions.post(input);
      if (input.parentId) {
        const parentId = input.parentId;
        setOpenThreads((open) => new Set(open).add(parentId));
      }
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
      canPin,
    }),
    [viewerId, isAccount, isModerator, canDelete, canRestrict, canSuspend, canPin],
  );
  const threads = useMemo(
    () =>
      thread.data
        ? buildThreads(thread.data.comments, {
            userId: viewerId,
            isModerator,
            followingIds: new Set(thread.data.followingIds),
            mutedIds,
          })
        : [],
    [thread.data, viewerId, isModerator, mutedIds],
  );

  function handleRefresh() {
    setRefreshing(true);
    void Promise.all([thread.refetch(), summary.refetch(), likes.refetch()]).finally(() =>
      setRefreshing(false),
    );
  }

  const number = (value: number) => isolateNumeric(localizeDigits(String(value), locale));
  const bodyText = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    fontFamily: nativeFontFamily(typography.bodyDefault),
    ...READING_START,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    ...READING_START,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const magnitudeText = t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(event.magnitude.value, locale),
  });
  const [nearest] = nearestCities(event.lat, event.lon, 1);
  const where =
    nearest && nearest.distanceKm <= NEAR_TOWN_KM
      ? t("eventHub.post.near", { city: pickLocalizedName(nearest.city.names, locale) })
      : placeLine(event, locale, t);
  const title = `${magnitudeText} · ${where}`;
  const when = t("eventHub.post.when", {
    time: isolateLocalizedTime(formatAbsoluteDual(event.originTime, locale, t).local),
  });
  const facts = [
    t("eventHub.post.depth", {
      depth: isolateNumeric(`${formatDepthKm(event.depthKm, locale)} ${t("units.km")}`),
    }),
    t(`events.provenance.${event.provenance.provider}`),
    placeLine(event, locale, t),
  ].join(" · ");
  const eventRef = event.bumelerzeId ?? bumelerzeId ?? event.id;
  const openEventPage = () => router.push(`/event/${eventRef}`);
  const openFeltReport = () =>
    router.push({
      pathname: "/felt-report",
      params: {
        eventId: event.id,
        eventReg: encodeEventRegistrationParam(toEventRegistration(event)),
      },
    });

  const unavailable =
    !isSupabaseConfigured() || (eventUuid === null && !uuidState.isPending);
  const waiting =
    !unavailable && (eventUuid === null || (thread.isLoading && !thread.data));
  const loadFailed = thread.isError && !thread.data;
  const reports = summary.summary?.reports ?? 0;
  const commentCount = summary.summary?.comments ?? threads.length;

  function scrollToComments() {
    const list = tabBarScroll.ref.current as unknown as FlatList<HubThread> | null;
    if (threads.length > 0) {
      list?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
    }
  }

  async function toggleLike() {
    setLikeError(false);
    try {
      await likes.setLiked(!(likes.state?.liked ?? false));
    } catch {
      setLikeError(true);
    }
  }

  const header = (
    <View style={{ gap: spacing[3], paddingBottom: spacing[3] }}>
      <PostHeader
        testID="hub-post-header"
        leading={<EventMark magnitude={event.magnitude.value} />}
        title={
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={[
              styles.title,
              {
                color: colors.text.primary,
                fontFamily: nativeFontFamily(typography.bodyDefault, "600"),
              },
            ]}
            testID="hub-subtitle"
          >
            {title}
          </Text>
        }
        mark={<RoleMark roles={OFFICIAL} explain />}
        subtitle={when}
        moreLabel={t("social.moreOptions")}
        menuItems={[
          {
            key: "open",
            icon: "information-circle-outline",
            label: t("eventHub.post.openEvent"),
            onPress: openEventPage,
            testID: "hub-menu-open-event",
          },
          {
            key: "share",
            icon: "share-outline",
            label: t("share.title"),
            onPress: () => setSharing(true),
            testID: "hub-menu-share",
          },
        ]}
      />

      <HubCarousel slides={slides} />

      <ActionRow
        testID="hub-actions"
        heart={
          !unavailable && likes.state && !likes.isUnavailable
            ? {
                count: likes.state.count,
                liked: likes.state.liked,
                onToggle: isAccount ? () => void toggleLike() : undefined,
              }
            : undefined
        }
        comments={
          unavailable ? undefined : { count: commentCount, onPress: scrollToComments }
        }
        felt={{
          label:
            reports > 0
              ? t("eventHub.post.felt", { number: number(reports) })
              : t("felt.pill.label"),
          onPress: openFeltReport,
        }}
        onShare={() => setSharing(true)}
      />
      {likeError ? (
        <Text
          style={[meta, { color: colors.status.danger }]}
          accessibilityLiveRegion="polite"
          testID="hub-like-error"
        >
          {t("eventHub.thread.actionError")}
        </Text>
      ) : null}

      <View style={{ gap: spacing[1] }}>
        <Text style={meta} testID="hub-facts">
          {facts}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={openEventPage}
          hitSlop={4}
          style={[styles.link, { gap: spacing[1] }]}
          testID="hub-open-event"
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.bodyMeta.fontSize,
              fontFamily: nativeFontFamily(typography.bodyMeta, "600"),
              ...READING_START,
              fontWeight: "600",
            }}
          >
            {t("eventHub.post.openEvent")}
          </Text>
          <DirectionalChevron />
        </Pressable>
      </View>

      <PrebunkCard />

      {unavailable ? (
        <Text style={bodyText}>{t("eventHub.unavailable")}</Text>
      ) : (
        <>
          <RestrictionBanner />
          {surge ? (
            <View
              testID="hub-surge-note"
              style={[
                styles.surgeNote,
                {
                  backgroundColor: colors.surface.raised,
                  borderColor: colors.border.default,
                  padding: spacing[3],
                  gap: spacing[2],
                },
              ]}
            >
              <Ionicons name="time-outline" size={18} color={colors.text.secondary} />
              <Text style={[bodyText, styles.flex]}>
                {t("eventHub.composer.surgeNote")}
              </Text>
            </View>
          ) : null}
          <View style={[styles.commentsHeading, { gap: spacing[2] }]}>
            <Text
              accessibilityRole="header"
              style={[typography.h3, { color: colors.text.primary }]}
            >
              {t("eventHub.post.comments")}
            </Text>
            {commentCount > 0 ? (
              <Text style={meta} testID="hub-comment-count">
                {number(commentCount)}
              </Text>
            ) : null}
          </View>
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
                fontFamily: nativeFontFamily(typography.labelButton),
                ...READING_START,
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
          {summary.summary?.featured && reports === 0
            ? t("eventHub.summary.memories")
            : t("eventHub.thread.empty")}
        </Text>
      );
    }
  }

  const composerAvatar = (
    <Avatar
      uri={getAvatarUrl(account.profile?.avatarPath)}
      name={account.profile?.displayName ?? null}
      size={32}
      placeholder="person"
      testID="hub-composer-avatar"
    />
  );

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
            pinActions={canPin ? pinActions : undefined}
            limited={limited}
            open={openThreads.has(item.root.id)}
            onToggle={() =>
              setOpenThreads((open) => {
                const next = new Set(open);
                if (next.has(item.root.id)) next.delete(item.root.id);
                else next.add(item.root.id);
                return next;
              })
            }
            onReply={(name) => setReplyTo({ id: item.root.id, name })}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={{ height: spacing[4] }} />}
        onScrollToIndexFailed={() => undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[6] }}
        style={{ backgroundColor: colors.surface.base }}
      />
      {unavailable ? null : (
        <View
          style={[
            styles.dock,
            {
              backgroundColor: colors.surface.base,
              borderTopColor: colors.border.subtle,
              paddingHorizontal: spacing[3],
              paddingVertical: spacing[2],
            },
          ]}
          testID="hub-dock"
        >
          <CommentComposer
            variant="docked"
            isAccount={isAccount}
            disabled={limited}
            leading={composerAvatar}
            focusKey={replyTo?.id ?? null}
            placeholder={
              replyTo
                ? t("eventHub.composer.replyPlaceholder")
                : summary.summary?.featured && reports === 0
                  ? t("eventHub.composer.memoryPlaceholder")
                  : t("eventHub.composer.placeholder")
            }
            banner={
              replyTo ? (
                <View style={[styles.replyBanner, { gap: spacing[2] }]}>
                  <Text style={[meta, styles.flex]} numberOfLines={1}>
                    {t("social.replyingTo", { name: replyTo.name })}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("social.cancelReply")}
                    onPress={() => setReplyTo(null)}
                    hitSlop={8}
                    style={styles.closeReply}
                    testID="hub-reply-cancel"
                  >
                    <Ionicons name="close" size={20} color={colors.text.secondary} />
                  </Pressable>
                </View>
              ) : null
            }
            onSubmit={(body) => postComment({ parentId: replyTo?.id ?? null, body })}
            {...(replyTo ? { onCancel: () => setReplyTo(null) } : {})}
          />
        </View>
      )}
      {sharing ? (
        <ShareSheet
          event={event}
          shareId={shareId}
          profileRef={event.bumelerzeId ?? bumelerzeId ?? eventUuid ?? null}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

interface ThreadViewProps {
  thread: HubThread;
  data: HubThreadData | null;
  viewer: CommentViewer;
  nowMs: number;
  actions: HubActions;
  pinActions?: PinActions | undefined;
  /** The viewer's account is limited: no Reply. */
  limited: boolean;
  /** The replies are open. */
  open: boolean;
  onToggle: () => void;
  onReply: (name: string) => void;
}

/** One conversation: the comment, then "View N replies" and the replies,
 * indented. My own reply that waits for review shows only to me (the server
 * gives held comments to their author alone). */
function ThreadView({
  thread,
  data,
  viewer,
  nowMs,
  actions,
  pinActions,
  limited,
  open,
  onToggle,
  onReply,
}: ThreadViewProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const helped = useMemo(() => new Set(data?.helpedIds ?? []), [data]);
  const following = useMemo(() => new Set(data?.followingIds ?? []), [data]);
  const flagged = useMemo(() => new Set(data?.flaggedIds ?? []), [data]);
  const rootAuthor = thread.root.userId ? data?.authors[thread.root.userId] : undefined;
  const rootName = rootAuthor?.displayName ?? t("eventHub.thread.anonymous");

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
      {...(isReply || limited ? {} : { onReply: () => onReply(rootName) })}
      {...(pinActions ? { pinActions } : {})}
    />
  );

  return (
    <View style={{ gap: spacing[2] }} testID={`thread-${thread.root.id}`}>
      {renderComment(thread.root, false)}
      {thread.replies.length > 0 ? (
        <ReplyToggle
          count={thread.replies.length}
          open={open}
          onToggle={onToggle}
          testID={`replies-toggle-${thread.root.id}`}
        />
      ) : null}
      {open ? thread.replies.map((reply) => renderComment(reply, true)) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "600", flexShrink: 1 },
  link: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  surgeNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
  },
  commentsHeading: { flexDirection: "row", alignItems: "baseline", marginTop: 4 },
  retry: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
  replyBanner: { flexDirection: "row", alignItems: "center" },
  closeReply: {
    minWidth: 44,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
