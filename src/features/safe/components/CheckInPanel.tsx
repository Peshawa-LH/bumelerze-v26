import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { EventRegistration } from "@/features/felt";
import { useTheme } from "@/theme";

import { eventLineText } from "../format";
import { registrationKey, useCheckInAudience, useFamilyCheckIn } from "../hooks";
import { useCheckInForEvent, useCheckInItem, type CheckInItem } from "../queue";
import { buildSafeShareMessage, shareSafeMessage } from "../share";
import { NoHelpNote } from "./NoHelpNote";
import { SafeButton } from "./SafeButton";

export interface CheckInPanelProps {
  /** The earthquake the check-in is about; null when there is none to attach
   * to (then only the share sheet is offered). */
  event: EventRegistration | null;
  /** Practice: nothing stored, nothing shared. */
  practice?: boolean;
  /** Put the "cannot send help" statement first (after a damage report of
   * DG3 or more, a cheerful card first would be wrong). */
  noticeFirst?: boolean;
  /** Shows "Not now" when given. */
  onNotNow?: () => void;
  /** Header level of the title: 1 on its own screen, 2 inside a card. */
  titleLevel?: 1 | 2;
  testID?: string;
}

/**
 * "Are you safe?" with one big "I'm safe" button. Panic-time rules: one tap,
 * no typing, no map, no image download, honest wording ("Saved on your
 * phone" until the server confirms, then "Your family can see it").
 *
 * - Account in a home: the tap is queued for the family, a 10 s Undo shows,
 *   and "Send a message" stays available.
 * - Guest, or account without a home: the tap opens the share sheet with a
 *   pre-written message (no server row), plus one invitation line.
 * - Practice: a rehearsal; nothing leaves the phone.
 */
export function CheckInPanel({
  event,
  practice = false,
  noticeFirst = false,
  onNotNow,
  titleLevel = 2,
  testID = "im-safe-panel",
}: CheckInPanelProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const { audience, reason } = useCheckInAudience();
  const familyCheckIn = useFamilyCheckIn();
  const [clientId, setClientId] = useState<string | null>(null);
  const [practiceDone, setPracticeDone] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const key = event ? registrationKey(event) : null;
  const existing = useCheckInForEvent(practice ? null : key);
  const tapped = useCheckInItem(clientId);
  const item: CheckInItem | null = tapped ?? existing;

  const locale = i18n.language;
  const shareMessage = buildSafeShareMessage(t, locale, event?.originTime ?? null);
  const canQueue = !practice && audience === "family" && event !== null;

  async function share() {
    const result = await shareSafeMessage(shareMessage);
    setShareNote(result === "copied" ? t("imSafe.action.copied") : null);
  }

  function onSafe() {
    if (practice) {
      setPracticeDone(true);
      return;
    }
    if (canQueue && event) {
      setClientId(familyCheckIn(event));
      return;
    }
    void share();
  }

  const title = practice ? t("imSafe.practice.title") : t("imSafe.prompt.title");
  const titleToken = titleLevel === 1 ? typography.h1 : typography.h2;

  let status: string | null = null;
  if (practiceDone) {
    status = t("imSafe.practice.done");
  } else if (item) {
    status =
      item.state === "sent"
        ? t("imSafe.status.sent")
        : item.state === "failed"
          ? t("imSafe.status.failed")
          : t("imSafe.status.queued");
  }
  const done = practiceDone || item !== null;

  return (
    <View testID={testID} style={{ gap: spacing[3] }}>
      {noticeFirst ? <NoHelpNote /> : null}
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: titleToken.fontSize,
          lineHeight: titleToken.lineHeight,
          fontWeight: titleToken.fontWeight,
        }}
      >
        {title}
      </Text>
      <Text style={[typography.bodyDefault, { color: colors.text.secondary }]}>
        {practice ? t("imSafe.practice.body") : t("imSafe.prompt.body")}
      </Text>
      {event && !practice ? (
        <Text
          testID="im-safe-event-line"
          style={[typography.bodyMeta, { color: colors.text.secondary }]}
        >
          {eventLineText(t, locale, event.magnitude, event.originTime)}
        </Text>
      ) : null}

      {!done ? (
        <SafeButton
          label={t("imSafe.button.safe")}
          onPress={onSafe}
          testID="im-safe-button"
          {...(canQueue ? {} : { accessibilityHint: t("imSafe.action.shareMessage") })}
        />
      ) : null}

      {status ? (
        <View
          testID="im-safe-status"
          accessibilityLiveRegion="polite"
          style={[styles.status, { gap: spacing[2] }]}
        >
          <Text
            style={[
              typography.bodyDefault,
              {
                color: colors.text.primary,
                fontWeight: item?.state === "sent" ? "700" : "400",
              },
            ]}
          >
            {status}
          </Text>
        </View>
      ) : null}

      {!practice && (canQueue || done) ? (
        <LinkButton
          label={done ? t("imSafe.action.shareAlso") : t("imSafe.action.shareMessage")}
          onPress={() => void share()}
          testID="im-safe-share"
        />
      ) : null}
      {shareNote ? (
        <Text
          testID="im-safe-copied"
          style={[typography.bodyMeta, { color: colors.text.secondary }]}
        >
          {shareNote}
        </Text>
      ) : null}

      {!practice && audience === "share" ? (
        <View style={{ gap: spacing[1] }} testID={`im-safe-invite-${reason ?? "guest"}`}>
          <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
            {reason === "no_home" ? t("imSafe.noFamily.invite") : t("imSafe.guest.body")}
          </Text>
          {reason === "no_home" ? (
            <LinkButton
              label={t("imSafe.noFamily.join")}
              onPress={() => router.push("/home/join")}
              testID="im-safe-join"
            />
          ) : (
            <>
              <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
                {t("imSafe.guest.invite")}
              </Text>
              <LinkButton
                label={t("imSafe.guest.create")}
                onPress={() => router.push("/account/sign-in")}
                testID="im-safe-create-account"
              />
            </>
          )}
        </View>
      ) : null}

      {onNotNow && !done ? (
        <LinkButton
          label={t("imSafe.button.later")}
          onPress={onNotNow}
          testID="im-safe-not-now"
        />
      ) : null}

      {noticeFirst ? null : <NoHelpNote />}
    </View>
  );
}

function LinkButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={styles.link}
    >
      <Text style={[typography.labelButton, { color: colors.text.link }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: "row", alignItems: "center" },
  link: { minHeight: 48, justifyContent: "center" },
});
