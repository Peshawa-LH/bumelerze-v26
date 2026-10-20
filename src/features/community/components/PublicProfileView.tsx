import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { AccountButton } from "@/features/account/components/AccountButton";
import { EarnedBadges } from "@/features/badges";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import { formatMagnitudeValue, useEventByBumelerzeId } from "@/features/events";
import { isolateName, placeLine } from "@/features/geo";
import { isRTLLocale } from "@/i18n";
import { useMuteActions, useMutedIds } from "@/features/mute/queries";
import { PostsSection } from "@/features/posts/components/PostsSection";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import type { PostsTransport } from "@/features/posts/transport";
import { MenuSheet, type MenuItem } from "@/features/social/components/MenuSheet";
import { useProfileHeader } from "@/features/social/queries";
import type { SocialTransport } from "@/features/social/transport";
import { ProfileStats } from "@/features/profile/components/ProfileStats";
import { ProfileTabs, type ProfileTab } from "@/features/profile/components/ProfileTabs";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { profileBadgeEntries } from "../badges";
import { communityErrorText } from "../error-text";
import type { CommunityActions } from "../queries";
import { peopleHref } from "../routes";
import type { ProfileComment, PublicProfile } from "../types";
import { formatUsername } from "../username";
import { FollowButton } from "./FollowButton";
import { ProfileAbout } from "./ProfileAbout";
import { ProfileShareSheet } from "./ProfileShareSheet";

/** What only the owner's own page knows and passes in (never fetched here):
 * the report count (local queue merged with the server) and how many badges
 * the full collection has, for "See all (N)". */
export interface SelfFigures {
  reports: number;
  badgeTotal: number;
}

interface PublicProfileViewProps {
  profile: PublicProfile;
  actions: CommunityActions;
  /** Only the Profile tab's own view passes this, and only when
   * `profile.isSelf`; a visitor's page never has it. */
  self?: SelfFigures;
  /** The owner's "Only you see this" part, between the badges and the
   * Posts / Comments tabs. Only `OwnProfile` passes it. */
  ownerSection?: ReactNode;
  /** The page sits in a stack screen: Block, Mute and Report go into its
   * top bar's "..." (mockup 3c). Otherwise the "..." is on the page. */
  moreInHeader?: boolean;
  /** Tests inject fakes; the app uses the Supabase ones. */
  postsTransport?: PostsTransport;
  socialTransport?: SocialTransport;
}

/**
 * A profile page (review note 5.1, mockups 3a-3d), the same for the owner
 * and for visitors: photo with posts, followers and following; name and rank
 * mark, @username, bio and town; Edit profile + Share profile (owner) or
 * Follow + Share profile (visitor), "Followed by ..." for trust; the badges
 * row; then Posts and Comments as two tabs. A private account the viewer may
 * not see into keeps its header and counts and shows a calm lock in place of
 * the posts. Renders ONLY what `PublicProfile` (and the header counts)
 * carry, which is public-safe by construction: no felt-report places, home
 * tags, profession or email exist in the data, so none can be shown. Block,
 * Mute and Report are in the "..." of the top bar.
 */
export function PublicProfileView({
  profile,
  actions,
  self,
  ownerSection,
  moreInHeader = false,
  postsTransport,
  socialTransport,
}: PublicProfileViewProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>("posts");
  const mutedIds = useMutedIds();
  const muteActions = useMuteActions();
  const { header } = useProfileHeader(
    profile.suspended && !profile.isSelf ? undefined : profile.username,
    socialTransport,
  );
  // Muted (0061): their posts and comments stay hidden here too, for me only.
  const isMuted = !profile.isSelf && mutedIds.has(profile.userId);

  const details = profile.canViewFull ? profile.details : null;
  const badges = details ? profileBadgeEntries(profile) : [];
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  // Logical start for the Latin @username: RN's `textAlign` has no `start`,
  // and the physical "left" put the handle on the far side of a Sorani or
  // Arabic page (B-8).
  const usernameAlign = isRTLLocale(i18n.language) ? "right" : "left";

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      return true;
    } catch (error) {
      setErrorText(communityErrorText(t, error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleBlock() {
    confirmDialog({
      title: t("community.block.confirmTitle", { name: profile.displayName }),
      message: t("community.block.confirmMessage"),
      confirmLabel: t("community.block.block"),
      cancelLabel: t("eventHub.thread.cancel"),
      destructive: true,
      onConfirm: () => void run(() => actions.block(profile.userId)),
    });
  }

  async function sendReport({ reason, note }: ReportInput) {
    await actions.report(profile.userId, reason, note);
    setReported(true);
  }

  // A suspended account (migration 0054) shows only its @username to everybody
  // but the person themself: no name, photo, counts, posts or comments.
  if (profile.suspended && !profile.isSelf) {
    return (
      <View style={{ gap: spacing[4] }} testID="public-profile-suspended">
        <View style={[styles.header, { gap: spacing[4] }]}>
          <Avatar
            uri={null}
            name={profile.username}
            size={80}
            placeholder="person"
            testID="public-profile-avatar"
          />
          <View style={styles.flex}>
            <Text
              accessibilityRole="header"
              testID="public-profile-username"
              style={[
                typography.h2,
                {
                  color: colors.text.primary,
                  // A handle is Latin, so it reads left to right — but it
                  // sits on the READING side of the page, not glued to the
                  // physical left edge under a right-aligned name (B-8).
                  writingDirection: "ltr",
                  textAlign: usernameAlign,
                },
              ]}
            >
              {formatUsername(profile.username)}
            </Text>
          </View>
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.bodyDefault, { color: colors.text.secondary }]}
          testID="public-profile-suspended-note"
        >
          {t("community.profile.suspended")}
        </Text>
      </View>
    );
  }

  const posts = header?.posts ?? details?.postsCount ?? null;
  const followers = header?.followers ?? details?.followers ?? null;
  const following = header?.following ?? details?.following ?? null;
  const canOpenLists = details !== null;

  const menuItems: MenuItem[] =
    profile.isSelf || profile.isBlocked
      ? []
      : [
          {
            key: "mute",
            icon: isMuted ? "volume-high-outline" : "volume-mute-outline",
            label: isMuted
              ? t("community.mute.unmute")
              : t("social.menu.mute", { name: profile.displayName }),
            detail: isMuted ? undefined : t("social.menu.muteDetail"),
            disabled: busy,
            onPress: () =>
              void run(() =>
                isMuted
                  ? muteActions.unmute(profile.userId)
                  : muteActions.mute(profile.userId),
              ),
            testID: isMuted ? "public-profile-unmute" : "public-profile-mute",
          },
          ...(reported
            ? []
            : [
                {
                  key: "report",
                  icon: "flag-outline" as const,
                  label: t("community.report.action"),
                  detail: t("social.menu.reportProfileDetail"),
                  onPress: () => setReporting(true),
                  testID: "public-profile-report",
                },
              ]),
          {
            key: "block",
            icon: "ban-outline",
            label: t("community.block.block"),
            detail: t("social.menu.blockDetail"),
            danger: true,
            disabled: busy,
            onPress: handleBlock,
            testID: "public-profile-block",
          },
        ];

  const moreButton =
    menuItems.length > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("social.profileMore", { name: profile.displayName })}
        onPress={() => setMenuOpen(true)}
        hitSlop={4}
        style={styles.more}
        testID="public-profile-more"
      >
        <Ionicons name="ellipsis-horizontal" size={22} color={colors.text.primary} />
      </Pressable>
    ) : null;

  const followedBy = header?.followedBy ?? [];
  const followedTotal = header?.followedByTotal ?? 0;
  let followedByText: string | null = null;
  if (!profile.isSelf && followedBy.length > 0) {
    const [a, b] = followedBy;
    const more = followedTotal - followedBy.length;
    followedByText =
      more > 0 && a && b
        ? t("social.followedBy.more", {
            a: a.username,
            b: b.username,
            number: localizeDigits(String(more), i18n.language),
          })
        : a && b
          ? t("social.followedBy.two", { a: a.username, b: b.username })
          : t("social.followedBy.one", { a: a?.username ?? "" });
  }

  return (
    <View style={{ gap: spacing[3] }} testID="public-profile">
      {moreInHeader && moreButton ? (
        <Stack.Screen
          options={{
            title: formatUsername(profile.username),
            headerRight: () => moreButton,
          }}
        />
      ) : null}

      <View style={[styles.header, { gap: spacing[4] }]}>
        <Avatar
          uri={getAvatarUrl(profile.avatarPath)}
          name={profile.displayName}
          size={80}
          placeholder="person"
          testID="public-profile-avatar"
        />
        {posts !== null && followers !== null && following !== null ? (
          <ProfileStats
            posts={posts}
            followers={followers}
            following={following}
            {...(canOpenLists
              ? {
                  onOpenFollowers: () =>
                    router.push(peopleHref(profile.username, "followers")),
                  onOpenFollowing: () =>
                    router.push(peopleHref(profile.username, "following")),
                }
              : {})}
          />
        ) : (
          <View style={styles.flex} />
        )}
        {!moreInHeader ? moreButton : null}
      </View>

      <View style={{ gap: 2 }}>
        <View style={[styles.nameRow, { gap: spacing[2] }]}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            testID="public-profile-name"
            style={[typography.h3, styles.name, { color: colors.text.primary }]}
          >
            {profile.displayName}
          </Text>
          <RoleMark roles={profile.roles} size={20} explain />
        </View>
        <Text
          testID="public-profile-username"
          style={[meta, { writingDirection: "ltr", textAlign: usernameAlign }]}
        >
          {formatUsername(profile.username)}
        </Text>
        {profile.isPrivate && details ? (
          <View style={[styles.nameRow, { gap: spacing[1] }]}>
            <Ionicons name="lock-closed" size={14} color={colors.text.secondary} />
            <Text style={meta}>{t("community.profile.private")}</Text>
          </View>
        ) : null}
      </View>

      {details ? <ProfileAbout details={details} /> : null}

      {profile.isSelf ? (
        <View style={[styles.buttons, { gap: spacing[2] }]}>
          <View style={styles.buttonCell}>
            <AccountButton
              tone="secondary"
              label={t("myData.account.editProfile")}
              onPress={() => router.push("/account/profile")}
              testID="public-profile-edit"
            />
          </View>
          <View style={styles.buttonCell}>
            <AccountButton
              tone="secondary"
              label={t("community.profile.share")}
              onPress={() => setSharing(true)}
              testID="public-profile-share"
            />
          </View>
        </View>
      ) : profile.isBlocked ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={meta} testID="public-profile-blocked">
            {t("community.block.blocked")}
          </Text>
          <AccountButton
            label={t("community.block.unblock")}
            disabled={busy}
            onPress={() => void run(() => actions.unblock(profile.userId))}
            testID="public-profile-unblock"
          />
        </View>
      ) : (
        <View style={[styles.buttons, { gap: spacing[2] }]}>
          <View style={styles.buttonCell}>
            <FollowButton profile={profile} actions={actions} />
          </View>
          <View style={styles.buttonCell}>
            <AccountButton
              tone="secondary"
              label={t("community.profile.share")}
              onPress={() => setSharing(true)}
              testID="public-profile-share"
            />
          </View>
        </View>
      )}

      {followedByText ? (
        <Text style={meta} testID="public-profile-followed-by">
          {followedByText}
        </Text>
      ) : null}

      {sharing ? (
        <ProfileShareSheet
          username={profile.username}
          displayName={profile.displayName}
          onClose={() => setSharing(false)}
        />
      ) : null}

      {details ? (
        <EarnedBadges
          variant="row"
          entries={badges}
          {...(profile.isSelf && self ? { seeAllCount: self.badgeTotal } : {})}
        />
      ) : null}

      {isMuted ? (
        <Text style={meta} testID="public-profile-muted">
          {t("community.mute.muted")}
        </Text>
      ) : null}

      {!profile.isBlocked && !details ? (
        // A private account the viewer cannot see into: a calm lock.
        <View
          style={[styles.lock, { gap: spacing[2], paddingVertical: spacing[6] }]}
          testID="posts-gate"
        >
          <Ionicons name="lock-closed-outline" size={36} color={colors.text.secondary} />
          <Text
            accessibilityRole="header"
            style={[typography.labelButton, { color: colors.text.primary }]}
          >
            {t("community.profile.private")}
          </Text>
          <Text style={[meta, styles.center]} testID="public-profile-private-note">
            {profile.followStatus === "pending"
              ? t("community.profile.requestSent")
              : t("community.profile.privateNote")}
          </Text>
        </View>
      ) : null}

      {details && !isMuted ? (
        <View style={{ gap: spacing[3] }}>
          <ProfileTabs value={tab} onChange={setTab} />
          {tab === "posts" ? (
            <PostsSection
              profile={profile}
              showHeading={false}
              {...(postsTransport ? { transport: postsTransport } : {})}
              {...(socialTransport ? { socialTransport } : {})}
            />
          ) : details.recentComments.length === 0 ? (
            <Text style={meta} testID="public-profile-no-comments">
              {t("community.profile.noComments")}
            </Text>
          ) : (
            <View style={{ gap: spacing[2] }} testID="public-profile-comments">
              {details.recentComments.map((comment) => (
                <RecentComment key={comment.id} comment={comment} />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* Your own tools ("Only you see this") come after your posts and comments. */}
      {ownerSection}

      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}
      {reported ? (
        <Text style={meta} testID="public-profile-reported">
          {t("community.report.sent")}
        </Text>
      ) : null}

      {menuOpen ? (
        <MenuSheet
          items={menuItems}
          onClose={() => setMenuOpen(false)}
          testID="public-profile-menu"
        />
      ) : null}

      {reporting ? (
        <ReportSheet
          kind="profile"
          testID="public-profile-report-sheet"
          onSubmit={sendReport}
          onClose={() => setReporting(false)}
          errorText={(error) => communityErrorText(t, error)}
        />
      ) : null}
    </View>
  );
}

/**
 * One of the person's recent Event hub comments, opening its hub.
 *
 * The place is the app's OWN place line (`placeLine`, the same rule the
 * Home cards use), resolved from the hub's event: `public_profile()` only
 * ships the provider's raw English text ("38 km W of Sarpol-e Z̄ahāb,
 * Iran"), which read as a foreign fragment inside a Sorani line (B-25).
 * The event lookup is the cached Supabase query every hub and event page
 * shares, so a comment whose event was already opened costs nothing; until
 * it answers (or when there is no hub), the raw text is shown isolated so
 * at least its words keep their order.
 */
function RecentComment({ comment }: { comment: ProfileComment }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { event } = useEventByBumelerzeId(
    comment.hubId ?? undefined,
    comment.hubId !== null && comment.place !== null,
  );
  const place = event
    ? placeLine(event, i18n.language, t)
    : comment.place
      ? isolateName(comment.place)
      : null;
  const where = [
    comment.magnitude !== null
      ? t("events.magnitudeDisplay", {
          value: formatMagnitudeValue(comment.magnitude, i18n.language),
        })
      : null,
    place,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  const content = (
    <View style={{ gap: spacing[1] }}>
      {where ? (
        <Text
          numberOfLines={1}
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            fontFamily: nativeFontFamily(typography.bodyMeta),
            ...READING_START,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {where}
        </Text>
      ) : null}
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault),
          lineHeight: typography.bodyDefault.lineHeight,
          textAlign: "auto",
        }}
      >
        {comment.body}
      </Text>
    </View>
  );
  const box = [
    styles.comment,
    {
      backgroundColor: colors.surface.raised,
      borderColor: colors.border.default,
      padding: spacing[3],
    },
  ];
  return comment.hubId ? (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("community.profile.openHub", {
        place: where || comment.body,
      })}
      onPress={() => router.push(`/event-hub/${comment.hubId as string}`)}
      style={box}
      testID={`profile-comment-${comment.id}`}
    >
      {content}
    </Pressable>
  ) : (
    <View style={box} testID={`profile-comment-${comment.id}`}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { flexShrink: 1 },
  buttons: { flexDirection: "row" },
  buttonCell: { flex: 1 },
  more: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  lock: { alignItems: "center" },
  center: { textAlign: "center" },
  comment: { borderWidth: 1, borderRadius: 12, minHeight: 44 },
});
