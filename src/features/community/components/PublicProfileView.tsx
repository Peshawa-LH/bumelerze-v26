import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { AccountButton } from "@/features/account/components/AccountButton";
import { EarnedBadges } from "@/features/badges";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import { formatMagnitudeValue } from "@/features/events";
import { formatMonthYear } from "@/features/mydata/format";
import { useMuteActions, useMutedIds } from "@/features/mute/queries";
import { PostsSection } from "@/features/posts/components/PostsSection";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import type { PostsTransport } from "@/features/posts/transport";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { profileBadgeEntries } from "../badges";
import { communityErrorText } from "../error-text";
import type { CommunityActions } from "../queries";
import { peopleHref } from "../routes";
import type { ProfileComment, PublicProfile } from "../types";
import { formatUsername } from "../username";
import { FollowButton } from "./FollowButton";
import { LinkButton } from "./LinkButton";
import { ProfileAbout } from "./ProfileAbout";
import { ProfileCounts } from "./ProfileCounts";
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
  /** Tests inject a fake; the app uses the Supabase one. */
  postsTransport?: PostsTransport;
}

/**
 * A public profile page. Renders ONLY what `PublicProfile` carries, which is
 * public-safe by construction (see `parsePublicProfile`): no felt-report
 * places, home tags, profession or email exist in the data, so none can be
 * shown. A private account the viewer may not follow-see shows the basics
 * (photo, name, @username, rank) and a Request button.
 *
 * Since D79 this is also the TOP of the owner's own Profile tab: the same
 * public part for owner and visitors (buttons differ: Edit / Share profile
 * for the owner, Follow for a visitor). Everything only the owner may see
 * (My home, My reports, People, Admin, Password, Privacy, Sign out, Delete)
 * is NOT in this component; the owner's page renders it after this view.
 */
export function PublicProfileView({
  profile,
  actions,
  self,
  postsTransport,
}: PublicProfileViewProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const mutedIds = useMutedIds();
  const muteActions = useMuteActions();
  // Muted (0061): their posts and comments stay hidden here too, for me only.
  const isMuted = !profile.isSelf && mutedIds.has(profile.userId);

  const details = profile.canViewFull ? profile.details : null;
  const badges = details ? profileBadgeEntries(profile) : [];
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

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
            size={88}
            placeholder="person"
            testID="public-profile-avatar"
          />
          <View style={styles.headerText}>
            <Text
              accessibilityRole="header"
              testID="public-profile-username"
              style={[
                typography.h2,
                {
                  color: colors.text.primary,
                  writingDirection: "ltr",
                  textAlign: "left",
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

  return (
    <View style={{ gap: spacing[4] }} testID="public-profile">
      <View style={[styles.header, { gap: spacing[4] }]}>
        <Avatar
          uri={getAvatarUrl(profile.avatarPath)}
          name={profile.displayName}
          size={88}
          placeholder="person"
          testID="public-profile-avatar"
        />
        <View style={styles.headerText}>
          <View style={[styles.nameRow, { gap: spacing[2] }]}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              testID="public-profile-name"
              style={[typography.h2, styles.name, { color: colors.text.primary }]}
            >
              {profile.displayName}
            </Text>
            <RoleMark roles={profile.roles} size={20} explain />
          </View>
          <Text
            testID="public-profile-username"
            style={[meta, { writingDirection: "ltr", textAlign: "left" }]}
          >
            {formatUsername(profile.username)}
          </Text>
          {profile.isPrivate ? (
            <View style={[styles.nameRow, { gap: spacing[1] }]}>
              <Ionicons name="lock-closed" size={14} color={colors.text.secondary} />
              <Text style={meta}>{t("community.profile.private")}</Text>
            </View>
          ) : null}
          {details && details.memberSince !== null ? (
            <Text testID="public-profile-member-since" style={meta}>
              {t("myData.memberSince", {
                date: formatMonthYear(details.memberSince, i18n.language, t),
              })}
            </Text>
          ) : null}
        </View>
      </View>

      {details ? <ProfileAbout details={details} /> : null}

      {profile.isSelf ? (
        <View style={{ gap: spacing[2] }}>
          <View style={[styles.buttons, { gap: spacing[2] }]}>
            <View style={styles.buttonCell}>
              <AccountButton
                label={t("myData.account.editProfile")}
                onPress={() => router.push("/account/profile")}
                testID="public-profile-edit"
              />
            </View>
            <View style={styles.buttonCell}>
              <AccountButton
                label={t("community.profile.share")}
                onPress={() => setSharing(true)}
                testID="public-profile-share"
              />
            </View>
          </View>
          {sharing ? (
            <ProfileShareSheet
              username={profile.username}
              displayName={profile.displayName}
              onClose={() => setSharing(false)}
            />
          ) : null}
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
        <FollowButton profile={profile} actions={actions} />
      )}

      {!profile.isBlocked && !details ? (
        <Text style={meta} testID="public-profile-private-note">
          {profile.followStatus === "pending"
            ? t("community.profile.requestSent")
            : t("community.profile.privateNote")}
        </Text>
      ) : null}

      {isMuted ? (
        <Text style={meta} testID="public-profile-muted">
          {t("community.mute.muted")}
        </Text>
      ) : null}

      {!details && !isMuted ? (
        // a private account the viewer cannot see into: "visible to followers"
        <PostsSection profile={profile} />
      ) : null}

      {details ? (
        <>
          <ProfileCounts
            reports={
              profile.isSelf && self
                ? self.reports
                : (details.milestones?.reports ?? null)
            }
            comments={details.comments}
            followers={details.followers}
            following={details.following}
            onOpenFollowers={() => router.push(peopleHref(profile.username, "followers"))}
            onOpenFollowing={() => router.push(peopleHref(profile.username, "following"))}
          />

          <EarnedBadges
            entries={badges}
            {...(profile.isSelf && self ? { seeAllCount: self.badgeTotal } : {})}
          />

          {isMuted ? null : (
            <PostsSection
              profile={profile}
              {...(postsTransport ? { transport: postsTransport } : {})}
            />
          )}

          {profile.isSelf || isMuted ? null : (
            <View style={{ gap: spacing[2] }}>
              <Text
                accessibilityRole="header"
                style={[typography.h3, { color: colors.text.primary }]}
              >
                {t("community.profile.recent")}
              </Text>
              {details.recentComments.length === 0 ? (
                <Text style={meta} testID="public-profile-no-comments">
                  {t("community.profile.noComments")}
                </Text>
              ) : (
                details.recentComments.map((comment) => (
                  <RecentComment key={comment.id} comment={comment} />
                ))
              )}
            </View>
          )}
        </>
      ) : null}

      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}

      {!profile.isSelf && !profile.isBlocked ? (
        <View style={[styles.actions, { gap: spacing[1] }]}>
          <LinkButton
            label={t("community.block.block")}
            danger
            disabled={busy}
            onPress={handleBlock}
            testID="public-profile-block"
          />
          <LinkButton
            label={isMuted ? t("community.mute.unmute") : t("community.mute.mute")}
            disabled={busy}
            onPress={() =>
              void run(() =>
                isMuted
                  ? muteActions.unmute(profile.userId)
                  : muteActions.mute(profile.userId),
              )
            }
            testID={isMuted ? "public-profile-unmute" : "public-profile-mute"}
          />
          {reported ? (
            <Text style={meta}>{t("community.report.sent")}</Text>
          ) : (
            <LinkButton
              label={t("community.report.action")}
              onPress={() => setReporting(true)}
              testID="public-profile-report"
            />
          )}
        </View>
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

function RecentComment({ comment }: { comment: ProfileComment }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const where = [
    comment.magnitude !== null
      ? t("events.magnitudeDisplay", {
          value: formatMagnitudeValue(comment.magnitude, i18n.language),
        })
      : null,
    comment.place,
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
  headerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { flexShrink: 1 },
  buttons: { flexDirection: "row" },
  buttonCell: { flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  comment: { borderWidth: 1, borderRadius: 12, minHeight: 44 },
});
