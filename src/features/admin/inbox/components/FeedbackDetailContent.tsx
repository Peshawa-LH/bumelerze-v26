import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSnackbar } from "@/components/Snackbar";
import { formatUsername } from "@/features/community/username";
import { formatAbsoluteDual } from "@/features/events";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { levelText, reasonText, untilText } from "@/features/restrictions/labels";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../../queries";
import { GRANTABLE_RANKS, type GrantableRank } from "../../types";
import { inboxErrorText } from "../error-text";
import { useFeedbackDetail, useInboxActions, useScreenshots } from "../queries";
import { guessRequestedRank } from "../rank-guess";
import type { InboxTransport } from "../transport";
import {
  FEEDBACK_STATUSES,
  TRIAGE_NOTE_MAX,
  type FeedbackDetail,
  type FeedbackStatus,
} from "../types";

/**
 * One feedback message (Admin > Feedback > message, migration 0060): the text,
 * what the sender typed to be reached at, the app and language it came from,
 * the person (a link to their page), screenshots, and for an appeal the
 * restriction it asks about. Actions: set the status with a triage note, and
 * for a badge request "Grant requested badge" in one tap (needs
 * `badges.grant`). Gated by `feedback.manage` inside.
 */
export function FeedbackDetailContent({
  feedbackId,
  transport,
  hubTransport,
}: {
  feedbackId: string;
  transport?: InboxTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const detail = useFeedbackDetail(feedbackId, access.canManageFeedback, transport);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canManageFeedback) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="feedback-detail-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }
  if (detail.isLoading) {
    return (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="feedback-detail-loading">
          {t("eventDetail.loading")}
        </Text>
      </View>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <View style={{ padding: spacing[4], gap: spacing[2] }}>
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="feedback-detail-error"
        >
          {inboxErrorText(t, detail.error)}
        </Text>
        <ActionButton
          label={t("events.retry")}
          onPress={() => void detail.refetch()}
          testID="feedback-detail-retry"
        />
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      testID="admin-feedback-detail"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[4],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      {/* keyed on the server's state: after a save the refetched status and
          note start a fresh form instead of being copied in by an effect */}
      <DetailBody
        key={`${detail.data.id}:${detail.data.status}:${detail.data.triageNote ?? ""}`}
        data={detail.data}
        {...(transport ? { transport } : {})}
        {...(hubTransport ? { hubTransport } : {})}
      />
    </ScrollView>
  );
}

function DetailBody({
  data,
  transport,
  hubTransport,
}: {
  data: FeedbackDetail;
  transport?: InboxTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const snackbar = useSnackbar();
  const { colors, typography, spacing } = useTheme();
  const access = useAdminAccess(hubTransport);
  const actions = useInboxActions(transport);
  const screenshots = useScreenshots(
    data.id,
    data.photos.map((p) => p.storagePath),
    transport,
  );
  const [status, setStatus] = useState<FeedbackStatus>(data.status);
  const [note, setNote] = useState(data.triageNote ?? "");
  const [rank, setRank] = useState<GrantableRank | null>(() =>
    data.category === "badge_request" ? guessRequestedRank(data.message) : null,
  );
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const language = i18n.language;
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
  const when = (value: number) => formatAbsoluteDual(value, language, t).local;

  const person = data.person;
  const personLabel = person
    ? (person.displayName ??
      (person.username ? formatUsername(person.username) : null) ??
      t(person.isAccount ? "admin.feedback.account" : "admin.feedback.guest"))
    : t("admin.feedback.noSender");
  const canOpenPerson =
    person !== null && (person.isAccount ? access.canViewPeople : access.canViewGuests);
  const changed =
    status !== data.status || note.trim() !== (data.triageNote ?? "").trim();
  const isBadgeRequest = data.category === "badge_request";
  const alreadyHolds = rank !== null && (person?.ranks ?? []).includes(rank);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      snackbar.show({ message: done });
    } catch (error) {
      setErrorText(inboxErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* the message */}
      <View style={{ gap: spacing[1] }} testID="feedback-message-block">
        <Text style={[meta, { fontWeight: "600" }]} testID="feedback-heading">
          {[
            t(`admin.feedback.status.${data.status}`),
            data.category ? t(`admin.feedback.category.${data.category}`) : null,
            when(data.createdAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Text selectable style={[body, { textAlign: "auto" }]} testID="feedback-message">
          {data.message}
        </Text>
      </View>

      {/* who and from where */}
      <Block title={t("admin.feedback.from")} testID="feedback-from">
        <Text style={body} testID="feedback-person">
          {personLabel}
          {person?.username && person.displayName
            ? ` · ${formatUsername(person.username)}`
            : ""}
        </Text>
        {data.contact ? (
          <Text
            selectable
            style={[meta, { writingDirection: "ltr", textAlign: "left" }]}
            testID="feedback-contact"
          >
            {t("admin.feedback.contact", { contact: data.contact })}
          </Text>
        ) : null}
        <Text style={meta} testID="feedback-device">
          {[
            data.platform
              ? t(`admin.people.platforms.${data.platform}`, {
                  defaultValue: data.platform,
                })
              : null,
            data.appVersion
              ? t("admin.feedback.version", { version: data.appVersion })
              : null,
            data.locale ? t("admin.feedback.language", { language: data.locale }) : null,
          ]
            .filter(Boolean)
            .join(" · ") || t("admin.feedback.noDevice")}
        </Text>
        {canOpenPerson && person ? (
          <View style={styles.row}>
            <ActionButton
              label={t("admin.feedback.openPerson")}
              onPress={() => router.push(`/admin/person/${person.userId}`)}
              testID="feedback-open-person"
            />
          </View>
        ) : null}
      </Block>

      {/* screenshots */}
      {data.photos.length > 0 ? (
        <Block title={t("admin.feedback.screenshots")} testID="feedback-screenshots">
          {screenshots.isError ? (
            <Text style={[meta, { color: colors.status.danger }]}>
              {inboxErrorText(t, screenshots.error)}
            </Text>
          ) : (
            <View style={[styles.row, { gap: spacing[2] }]}>
              {(screenshots.data ?? []).map((shot, index) => (
                <Image
                  key={shot.path}
                  source={{ uri: shot.url }}
                  contentFit="contain"
                  accessibilityLabel={t("admin.feedback.screenshotLabel", {
                    number: index + 1,
                  })}
                  style={[styles.shot, { backgroundColor: colors.surface.sunken }]}
                  testID={`feedback-screenshot-${index}`}
                />
              ))}
            </View>
          )}
        </Block>
      ) : null}

      {/* an appeal: the restriction it is about */}
      {data.category === "appeal" ? (
        <Block title={t("admin.feedback.appeal.title")} testID="feedback-appeal">
          {data.restriction ? (
            <Text style={body} testID="feedback-appeal-restriction">
              {[
                levelText(t, data.restriction.level),
                reasonText(t, data.restriction.reason),
                data.restriction.active
                  ? data.restriction.endsAt !== null
                    ? t("admin.feedback.appeal.until", {
                        date: untilText(t, language, data.restriction.endsAt),
                      })
                    : t("admin.feedback.appeal.noEnd")
                  : t("admin.feedback.appeal.notActive"),
              ].join(" · ")}
            </Text>
          ) : (
            <Text style={meta}>{t("admin.feedback.appeal.unknown")}</Text>
          )}
          {access.canRestrict ? (
            <View style={styles.row}>
              <ActionButton
                label={t("admin.feedback.appeal.openLimited")}
                onPress={() => router.push("/admin/limited")}
                testID="feedback-open-limited"
              />
            </View>
          ) : null}
        </Block>
      ) : null}

      {/* a badge request: grant in one tap */}
      {isBadgeRequest && access.canGrant ? (
        <Block title={t("admin.feedback.badge.title")} testID="feedback-badge">
          {person && person.ranks.length > 0 ? (
            <Text style={meta}>
              {t("admin.person.badge.holds", {
                ranks: person.ranks.map((r) => t(`eventHub.roles.${r}`)).join(", "),
              })}
            </Text>
          ) : null}
          <View style={styles.row} accessibilityRole="radiogroup">
            {GRANTABLE_RANKS.map((candidate) => (
              <ActionButton
                key={candidate}
                label={t(`eventHub.roles.${candidate}`)}
                selected={rank === candidate}
                onPress={() => setRank(candidate)}
                testID={`feedback-rank-${candidate}`}
              />
            ))}
          </View>
          {rank === "partner" ? (
            <TextInput
              value={orgName}
              onChangeText={setOrgName}
              maxLength={80}
              placeholder={t("admin.feedback.badge.orgPlaceholder")}
              placeholderTextColor={colors.text.tertiary}
              accessibilityLabel={t("admin.feedback.badge.orgPlaceholder")}
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
              testID="feedback-org-input"
            />
          ) : null}
          {person === null || !person.isAccount ? (
            <Text style={meta} testID="feedback-badge-guest">
              {t("admin.feedback.errors.guest")}
            </Text>
          ) : person.username === null ? (
            <Text style={meta} testID="feedback-badge-no-username">
              {t("admin.feedback.errors.noUsername")}
            </Text>
          ) : (
            <View style={styles.row}>
              <ActionButton
                label={
                  alreadyHolds
                    ? t("admin.feedback.badge.markSolved")
                    : t("admin.feedback.badge.grant")
                }
                disabled={busy || rank === null}
                onPress={() => {
                  const chosen = rank;
                  if (chosen === null) {
                    return;
                  }
                  void run(
                    () =>
                      actions.grantBadge(
                        data.id,
                        chosen,
                        chosen === "partner" && orgName.trim() !== ""
                          ? orgName.trim()
                          : null,
                      ),
                    t("admin.feedback.badge.granted"),
                  );
                }}
                testID="feedback-grant"
              />
            </View>
          )}
        </Block>
      ) : null}

      {/* triage */}
      <Block title={t("admin.feedback.triage")} testID="feedback-triage">
        <View style={styles.row} accessibilityRole="radiogroup">
          {FEEDBACK_STATUSES.map((candidate) => (
            <ActionButton
              key={candidate}
              label={t(`admin.feedback.status.${candidate}`)}
              selected={status === candidate}
              onPress={() => setStatus(candidate)}
              testID={`feedback-status-${candidate}`}
            />
          ))}
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={TRIAGE_NOTE_MAX}
          placeholder={t("admin.feedback.notePlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("admin.feedback.noteLabel")}
          style={[
            styles.input,
            styles.note,
            {
              color: colors.text.primary,
              borderColor: colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[2],
              textAlign: "auto",
            },
          ]}
          testID="feedback-note-input"
        />
        <Text style={meta}>{t("admin.feedback.noteHint")}</Text>
        <View style={styles.row}>
          <ActionButton
            label={t("admin.feedback.save")}
            disabled={busy || !changed}
            onPress={() =>
              void run(
                () => actions.setStatus(data.id, status, note.trim()),
                t("admin.feedback.saved"),
              )
            }
            testID="feedback-save"
          />
        </View>
      </Block>

      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="feedback-action-error"
        >
          {errorText}
        </Text>
      ) : null}
    </>
  );
}

function Block({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: ReactNode;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.block,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  block: { borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 44 },
  note: { minHeight: 96, textAlignVertical: "top" },
  shot: { width: 140, height: 220, borderRadius: 8 },
});
