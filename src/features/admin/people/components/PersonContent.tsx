import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSnackbar } from "@/components/Snackbar";
import { Avatar, getAvatarUrl, useAccount } from "@/features/account";
import { communityErrorText } from "@/features/community/error-text";
import { profileHref } from "@/features/community/routes";
import { formatAbsoluteDual } from "@/features/events";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { levelText, reasonText, untilText } from "@/features/restrictions/labels";
import { useRestrictionActions } from "@/features/restrictions/queries";
import type { RestrictionsTransport } from "@/features/restrictions/transport";
import { LimitAccountButton } from "@/features/restrictions/components/LimitAccountButton";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../../queries";
import { SupabaseAdminTransport, type AdminTransport } from "../../transport";
import { formatCount, personName, shortId } from "../format";
import { usePeopleActions, usePerson } from "../queries";
import type { PeopleTransport } from "../transport";
import type { PersonDetail } from "../types";
import { generateTempPassword } from "../../temp-password";
import { BadgeSheet } from "./BadgeSheet";
import { PersonHistory } from "./PersonHistory";
import { PersonNotes } from "./PersonNotes";
import { ResetFieldsSheet } from "./ResetFieldsSheet";
import { StatusChip } from "./StatusChip";
import { TempPasswordCard } from "./TempPasswordCard";

/**
 * One person's page (Admin > People > person). Opening it is logged on the
 * server (`person_view`); the page shows counts, lists and fingerprints only,
 * never a location, a raw device id or a full email (that needs a tap, a
 * confirmation and is logged too). Actions reuse the existing flows: view the
 * public profile, Limit / Lift (migration 0054), reset a password (0051), give
 * or take a badge (0046), reset a copied name or photo and add a private note
 * (0055). Each action shows only for the permission it needs.
 */
export function PersonContent({
  userId,
  transport,
  adminTransport,
  hubTransport,
  restrictionsTransport,
}: {
  userId: string;
  transport?: PeopleTransport;
  adminTransport?: AdminTransport;
  hubTransport?: EventHubTransport;
  restrictionsTransport?: RestrictionsTransport;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const access = useAdminAccess(hubTransport);
  const person = usePerson(userId, access.canViewPeople && userId !== "", transport);
  const language = i18n.language;
  const scroll = useRef<ScrollView>(null);
  const notesY = useRef(0);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canViewPeople) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="person-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }
  if (person.isLoading) {
    return (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="person-loading">
          {t("eventDetail.loading")}
        </Text>
      </View>
    );
  }
  if (person.isError || !person.data) {
    return (
      <View style={{ padding: spacing[4], gap: spacing[2] }}>
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="person-error"
        >
          {communityErrorText(t, person.error)}
        </Text>
        <ActionButton
          label={t("events.retry")}
          onPress={() => void person.refetch()}
          testID="person-retry"
        />
      </View>
    );
  }
  const data = person.data;

  return (
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      testID="admin-person"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[4],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <PersonBody
        data={data}
        isSelf={account.userId === data.identity.userId}
        language={language}
        onAddNote={() => scroll.current?.scrollTo({ y: notesY.current, animated: true })}
        router={router}
        transport={transport}
        adminTransport={adminTransport}
        hubTransport={hubTransport}
        restrictionsTransport={restrictionsTransport}
      />
      <View onLayout={(e) => (notesY.current = e.nativeEvent.layout.y)}>
        <PersonNotes userId={userId} {...(transport ? { transport } : {})} />
      </View>
    </ScrollView>
  );
}

function PersonBody({
  data,
  isSelf,
  language,
  onAddNote,
  router,
  transport,
  adminTransport,
  hubTransport,
  restrictionsTransport,
}: {
  data: PersonDetail;
  isSelf: boolean;
  language: string;
  onAddNote: () => void;
  router: ReturnType<typeof useRouter>;
  transport: PeopleTransport | undefined;
  adminTransport: AdminTransport | undefined;
  hubTransport: EventHubTransport | undefined;
  restrictionsTransport: RestrictionsTransport | undefined;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const access = useAdminAccess(hubTransport);
  const peopleActions = usePeopleActions(transport);
  const restrictionActions = useRestrictionActions(restrictionsTransport);
  const snackbar = useSnackbar();
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const id = data.identity;
  const name = personName(t, id);
  const date = (value: number | null) =>
    value === null ? "-" : formatAbsoluteDual(value, language, t).local;
  const n = (value: number) => formatCount(value, language);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const body = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  const isAccount = id.kind === "account";
  // Who is protected is decided by permission (migration 0060's flags), so the
  // private admin rank counts too. An older server: the public ranks.
  const flags = data.flags ?? null;
  const protectedAccount = flags
    ? flags.protected
    : id.ranks.some((r) => r.role === "official" || r.role === "moderator");
  const targetResetsPasswords = flags
    ? flags.resetsPasswords
    : id.ranks.some((r) => r.role === "official");
  const activeLimits = data.restrictions.filter(
    (r) => r.active && (r.level !== "suspend" || access.canSuspend),
  );
  const canLimit = access.canRestrict && !isSelf && !protectedAccount;
  const canResetPassword =
    access.canResetPasswords &&
    isAccount &&
    !(targetResetsPasswords && !isSelf);
  const canResetFields =
    access.canRestrict && isAccount && !isSelf && !protectedAccount &&
    (id.displayName !== null || id.avatarPath !== null);
  const canBadge = access.canGrant && isAccount;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  function confirmReveal() {
    confirmDialog({
      title: t("admin.person.email.confirmTitle"),
      message: t("admin.person.email.confirmMessage", { name }),
      confirmLabel: t("admin.person.email.confirm"),
      cancelLabel: t("eventHub.thread.cancel"),
      onConfirm: () =>
        void run(async () => {
          setEmail((await peopleActions.revealEmail(id.userId)) ?? "");
        }),
    });
  }

  function confirmPassword() {
    confirmDialog({
      title: t("admin.passwords.confirmTitle"),
      message: t("admin.passwords.confirmMessage", { name }),
      confirmLabel: t("admin.passwords.confirmButton"),
      cancelLabel: t("eventHub.thread.cancel"),
      destructive: true,
      onConfirm: () =>
        void run(async () => {
          const password = generateTempPassword();
          await (adminTransport ?? SupabaseAdminTransport).resetPassword(id.userId, password);
          setIssued(password);
        }),
    });
  }

  async function lift(restrictionId: string) {
    await run(async () => {
      await restrictionActions.lift(restrictionId);
      snackbar.show({ message: t("snackbar.limitLifted") });
    });
  }

  async function copyId() {
    try {
      await Clipboard.setStringAsync(id.userId);
      snackbar.show({ message: t("admin.person.idCopied") });
    } catch {
      // the id is selectable text anyway
    }
  }

  const Section = ({
    title,
    children,
    testID,
  }: {
    title: string;
    children: ReactNode;
    testID: string;
  }) => (
    <View style={{ gap: spacing[2] }} testID={testID}>
      <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
        {title}
      </Text>
      {children}
    </View>
  );
  const Line = ({ label, value, ltr, testID }: { label: string; value: string; ltr?: boolean; testID?: string }) => (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[meta, styles.lineLabel]}>{label}</Text>
      <Text
        selectable
        testID={testID}
        style={[body, styles.lineValue, ltr ? { writingDirection: "ltr", textAlign: "left" } : null]}
      >
        {value}
      </Text>
    </View>
  );

  const c = data.counts;
  const yesNo = (value: boolean) => t(value ? "admin.person.yes" : "admin.person.no");

  return (
    <>
      {/* header */}
      <View style={[styles.header, { gap: spacing[3] }]} testID="person-header">
        <Avatar
          uri={getAvatarUrl(id.avatarPath)}
          name={id.displayName}
          placeholder="person"
          size={64}
          testID="person-avatar"
        />
        <View style={styles.headerText}>
          <View style={[styles.nameRow, { gap: spacing[2] }]}>
            <Text
              accessibilityRole="header"
              style={[typography.h2, { color: colors.text.primary }, styles.name]}
              testID="person-name"
            >
              {name}
            </Text>
            <RoleMark roles={id.ranks} size={20} />
          </View>
          {id.username ? (
            <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]} testID="person-username">
              @{id.username}
            </Text>
          ) : null}
          <View style={[styles.nameRow, { gap: spacing[2] }]}>
            <StatusChip status={id.status} testID="person-status" />
            {flags?.privateAdmin ? (
              <Text style={[meta, { fontWeight: "600" }]} testID="person-private-admin">
                {t("admin.rank.adminPrivate")}
              </Text>
            ) : null}
            <Text style={meta} testID="person-kind">
              {t(id.kind === "guest" ? "admin.people.guestKind" : "admin.people.accountKind")}
            </Text>
          </View>
        </View>
      </View>

      {/* actions */}
      <View style={[styles.actions, { gap: spacing[1] }]} testID="person-actions">
        {id.username ? (
          <ActionButton
            label={t("admin.person.actions.viewProfile")}
            onPress={() => router.push(profileHref(id.username as string))}
            testID="person-action-profile"
          />
        ) : null}
        {canLimit ? (
          <LimitAccountButton
            target={{ userId: id.userId, name }}
            canSuspend={access.canSuspend}
            {...(restrictionsTransport ? { transport: restrictionsTransport } : {})}
            testID="person-action-limit"
          />
        ) : null}
        {activeLimits.length > 0 ? (
          <ActionButton
            label={t("admin.person.actions.lift")}
            disabled={busy}
            onPress={() => void lift((activeLimits[0] as { restrictionId: string }).restrictionId)}
            testID="person-action-lift"
          />
        ) : null}
        {canResetPassword ? (
          <ActionButton
            label={t("admin.person.actions.resetPassword")}
            danger
            disabled={busy}
            onPress={confirmPassword}
            testID="person-action-password"
          />
        ) : null}
        {canBadge ? (
          <ActionButton
            label={t("admin.person.actions.badge")}
            disabled={!id.username}
            onPress={() => setBadgeOpen(true)}
            testID="person-action-badge"
          />
        ) : null}
        {canResetFields ? (
          <ActionButton
            label={t("admin.person.actions.resetFields")}
            danger
            onPress={() => setResetOpen(true)}
            testID="person-action-reset"
          />
        ) : null}
        {access.canViewEmail && isAccount && id.maskedEmail ? (
          <ActionButton
            label={t("admin.person.actions.revealEmail")}
            disabled={busy}
            onPress={confirmReveal}
            testID="person-action-email"
          />
        ) : null}
        <ActionButton
          label={t("admin.person.actions.addNote")}
          onPress={onAddNote}
          testID="person-action-note"
        />
      </View>
      {canBadge && !id.username ? (
        <Text style={meta} testID="person-badge-needs-username">
          {t("admin.person.badge.needsUsername")}
        </Text>
      ) : null}
      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]} testID="person-action-error">
          {errorText}
        </Text>
      ) : null}
      {issued ? (
        <TempPasswordCard name={name} password={issued} onDone={() => setIssued(null)} />
      ) : null}
      {badgeOpen && id.username ? (
        <BadgeSheet
          username={id.username}
          name={name}
          heldRanks={id.ranks.map((r) => r.role)}
          onClose={() => setBadgeOpen(false)}
          {...(adminTransport ? { transport: adminTransport } : {})}
          {...(hubTransport ? { hubTransport } : {})}
        />
      ) : null}
      {resetOpen ? (
        <ResetFieldsSheet
          userId={id.userId}
          name={name}
          canReset={{ display_name: id.displayName !== null, avatar: id.avatarPath !== null }}
          onClose={() => setResetOpen(false)}
          {...(transport ? { peopleTransport: transport } : {})}
          {...(adminTransport ? { transport: adminTransport } : {})}
        />
      ) : null}

      {/* identity */}
      <Section title={t("admin.person.identity.title")} testID="person-identity">
        <View style={styles.idRow}>
          <Line label={t("admin.person.identity.userId")} value={id.userId} ltr testID="person-userid" />
          <ActionButton
            label={t("admin.person.copyId")}
            onPress={() => void copyId()}
            testID="person-copy-id"
          />
        </View>
        {id.kind === "guest" ? (
          <Text style={meta}>{t("admin.person.identity.guestShort", { id: shortId(id.userId) })}</Text>
        ) : null}
        <Line label={t("admin.person.identity.joined")} value={date(id.joined)} />
        {id.firstSeen !== null ? (
          <Line label={t("admin.person.identity.firstSeen")} value={date(id.firstSeen)} />
        ) : null}
        <Line label={t("admin.person.identity.lastSeen")} value={date(id.lastSeen)} />
        {id.platform ? (
          <Line
            label={t("admin.person.identity.platform")}
            value={[t(`admin.people.platforms.${id.platform}`), id.appVersion].filter(Boolean).join(" ")}
          />
        ) : null}
        {id.locale ? (
          <Line label={t("admin.person.identity.language")} value={t(`settings.languageNative.${id.locale}`, { defaultValue: id.locale })} />
        ) : null}
        {isAccount ? (
          <Line label={t("admin.person.identity.private")} value={yesNo(id.isPrivate)} />
        ) : null}
        {id.termsVersion ? (
          <Line
            label={t("admin.person.identity.terms")}
            value={`${id.termsVersion} · ${date(id.termsAcceptedAt)}`}
          />
        ) : null}
        {id.researchConsentVersion ? (
          <Line
            label={t("admin.person.identity.research")}
            value={`${id.researchConsentVersion} · ${date(id.researchConsentAt)}`}
          />
        ) : null}
        {id.maskedEmail !== null && isAccount ? (
          <Line
            label={t("admin.person.identity.email")}
            value={email ?? id.maskedEmail}
            ltr
            testID="person-email"
          />
        ) : null}
        {id.hasPassword !== null && isAccount ? (
          <Line label={t("admin.person.identity.password")} value={yesNo(id.hasPassword)} />
        ) : null}
      </Section>

      {/* devices */}
      <Section title={t("admin.person.devices.title")} testID="person-devices">
        <Text style={meta}>{t("admin.person.devices.hint")}</Text>
        {data.devices.length === 0 ? (
          <Text style={meta} testID="person-devices-empty">
            {t("admin.person.devices.none")}
          </Text>
        ) : (
          data.devices.map((d) => (
            <View key={d.fingerprint} testID={`person-device-${d.fingerprint}`} style={{ gap: 2 }}>
              <Text style={[body, { writingDirection: "ltr", textAlign: "left", fontWeight: "600" }]}>
                {d.fingerprint}
              </Text>
              <Text style={meta}>
                {[
                  t("admin.people.counts.feltReports", { count: n(d.feltReports) }),
                  t("admin.people.counts.feedback", { count: n(d.feedback) }),
                  d.platform ? t(`admin.people.platforms.${d.platform}`) : null,
                  `${date(d.firstSeen)} - ${date(d.lastSeen)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          ))
        )}
        {data.sameDeviceUsers.length > 0 ? (
          <View style={{ gap: spacing[1] }} testID="person-same-device">
            <Text style={[body, { fontWeight: "600" }]}>{t("admin.person.devices.shared")}</Text>
            {data.sameDeviceUsers.map((s) => (
              <ActionButton
                key={s.userId}
                label={`${personName(t, s)} · ${s.fingerprint}`}
                onPress={() => router.push(`/admin/person/${s.userId}`)}
                testID={`person-same-${s.userId}`}
              />
            ))}
          </View>
        ) : null}
      </Section>

      {/* activity */}
      <Section title={t("admin.person.activity.title")} testID="person-activity">
        <Line label={t("admin.person.activity.feltReports")} value={n(c.feltReports)} />
        <Line
          label={t("admin.person.activity.comments")}
          value={t("admin.person.activity.commentsValue", {
            total: n(c.comments),
            visible: n(c.commentsVisible),
            pending: n(c.commentsPending),
            hidden: n(c.commentsHidden),
            removed: n(c.commentsRemoved),
          })}
        />
        <Line label={t("admin.person.activity.posts")} value={n(c.posts)} />
        <Line label={t("admin.person.activity.feedback")} value={n(c.feedback)} />
        <Line
          label={t("admin.person.activity.follows")}
          value={t("admin.person.activity.followsValue", { followers: n(c.followers), following: n(c.following) })}
        />
        <Line
          label={t("admin.person.activity.blocks")}
          value={t("admin.person.activity.blocksValue", { made: n(c.blocksMade), received: n(c.blocksReceived) })}
        />
        <Line
          label={t("admin.person.activity.reports")}
          value={t("admin.person.activity.reportsValue", {
            filed: n(c.reportsFiled),
            received: n(c.reportsReceived),
            open: n(c.reportsOpen),
          })}
        />
        <Line
          label={t("admin.person.activity.homes")}
          value={t("admin.person.activity.homesValue", { owned: n(c.homesOwned), member: n(c.homesMember) })}
        />

        <ListBlock title={t("admin.person.recent.feltReports")} empty={data.recent.feltReports.length === 0} testID="person-recent-felt">
          {data.recent.feltReports.map((r) => (
            <Text key={r.reportId} style={meta} testID={`person-felt-${r.reportId}`}>
              {[
                date(r.createdAt),
                r.event ?? t("admin.person.recent.notLinked"),
                r.intensity !== null ? t("admin.person.recent.intensity", { level: n(r.intensity) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ))}
        </ListBlock>
        <ListBlock title={t("admin.person.recent.comments")} empty={data.recent.comments.length === 0} testID="person-recent-comments">
          {data.recent.comments.map((cm) => (
            <View key={cm.commentId} testID={`person-comment-${cm.commentId}`} style={{ gap: 2 }}>
              <Text style={meta}>
                {[
                  date(cm.createdAt),
                  cm.event,
                  cm.authorDeleted ? t("admin.person.recent.authorDeleted") : t(`admin.person.recent.status.${cm.status}`, { defaultValue: cm.status }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {cm.excerpt ? <Text style={body}>{cm.excerpt}</Text> : null}
            </View>
          ))}
        </ListBlock>
        <ListBlock title={t("admin.person.recent.posts")} empty={data.recent.posts.length === 0} testID="person-recent-posts">
          {data.recent.posts.map((p) => (
            <View key={p.postId} testID={`person-post-${p.postId}`} style={{ gap: 2 }}>
              <Text style={meta}>
                {[date(p.createdAt), t(`admin.person.recent.status.${p.status}`, { defaultValue: p.status })].join(" · ")}
              </Text>
              {p.excerpt ? <Text style={body}>{p.excerpt}</Text> : null}
            </View>
          ))}
        </ListBlock>
        <ListBlock title={t("admin.person.recent.feedback")} empty={data.recent.feedback.length === 0} testID="person-recent-feedback">
          {data.recent.feedback.map((f) => {
            const label = [
              date(f.createdAt),
              f.category
                ? t(`admin.feedback.category.${f.category}`, { defaultValue: f.category })
                : null,
              f.status ? t(`admin.feedback.status.${f.status}`, { defaultValue: f.status }) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return access.canManageFeedback ? (
              <ActionButton
                key={f.feedbackId}
                label={label}
                onPress={() => router.push(`/admin/feedback/${f.feedbackId}`)}
                testID={`person-feedback-${f.feedbackId}`}
              />
            ) : (
              <Text key={f.feedbackId} style={meta} testID={`person-feedback-${f.feedbackId}`}>
                {label}
              </Text>
            );
          })}
        </ListBlock>
      </Section>

      {/* limits */}
      {access.canRestrict ? (
        <Section title={t("admin.person.limits.title")} testID="person-limits">
          {data.restrictions.length === 0 ? (
            <Text style={meta} testID="person-limits-empty">
              {t("admin.person.limits.none")}
            </Text>
          ) : (
            data.restrictions.map((r) => {
              const liftable = r.active && (r.level !== "suspend" || access.canSuspend);
              return (
                <View
                  key={r.restrictionId}
                  testID={`person-limit-${r.restrictionId}`}
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
                  <Text style={[body, { fontWeight: "600" }]}>
                    {[levelText(t, r.level), reasonText(t, r.reason)].join(" · ")}
                  </Text>
                  <Text style={meta}>
                    {r.active
                      ? r.endsAt === null
                        ? t("restrictions.list.untilLifted")
                        : t("restrictions.list.until", { date: untilText(t, language, r.endsAt) })
                      : r.liftedAt !== null
                        ? t("restrictions.list.liftedPlain")
                        : t("restrictions.list.ended")}
                  </Text>
                  {r.createdByName ? (
                    <Text style={meta}>{t("admin.activity.by", { name: r.createdByName })}</Text>
                  ) : null}
                  {r.note ? <Text style={meta}>{t("restrictions.list.note", { note: r.note })}</Text> : null}
                  {r.appealRequestedAt !== null ? (
                    <Text style={[meta, { fontWeight: "600" }]}>{t("restrictions.list.appeal")}</Text>
                  ) : null}
                  {liftable ? (
                    <ActionButton
                      label={t("restrictions.list.lift")}
                      disabled={busy}
                      onPress={() => void lift(r.restrictionId)}
                      testID={`person-limit-lift-${r.restrictionId}`}
                    />
                  ) : null}
                </View>
              );
            })
          )}
        </Section>
      ) : null}

      <PersonHistory
        userId={id.userId}
        {...(adminTransport ? { transport: adminTransport } : {})}
        {...(hubTransport ? { hubTransport } : {})}
      />
    </>
  );

  function ListBlock({
    title,
    empty,
    testID,
    children,
  }: {
    title: string;
    empty: boolean;
    testID: string;
    children: ReactNode;
  }) {
    return (
      <View style={{ gap: spacing[1] }} testID={testID}>
        <Text style={[body, { fontWeight: "600" }]}>{title}</Text>
        {empty ? <Text style={meta}>{t("admin.person.recent.none")}</Text> : children}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center" },
  headerText: { flex: 1, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  name: { flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  line: { gap: 2 },
  lineLabel: { fontWeight: "600" },
  lineValue: { flexShrink: 1 },
  idRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  card: { borderWidth: 1, borderRadius: 12 },
});
