import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { EventRegistration } from "@/features/felt";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

import { eventLineText, reachWho } from "../format";
import {
  checkInKey,
  useCheckInAudience,
  useInAppCheckIn,
  useSafeAudience,
} from "../hooks";
import { useCheckInForEvent, useCheckInItem, type CheckInItem } from "../queue";
import { buildSafeShareMessage, shareSafeMessage } from "../share";
import { NoHelpNote } from "./NoHelpNote";
import { SafeButton } from "./SafeButton";

export interface CheckInPanelProps {
  /** The earthquake the check-in is about; null when there is none. */
  event: EventRegistration | null;
  /** The person's own felt report it comes from (review note 3.3): with it
   * the check-in is real even without a regional M4.0, tied to the report's
   * earthquake when it has one, else to the report. */
  feltReportId?: string | null;
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
 * phone" until the server confirms, then who can see it).
 *
 * - Account: the tap tells the people the person chose inside the app
 *   (family, mutual follows or followers; Settings > Notifications). The
 *   panel says who before and after; a 10 s Undo shows. A message outside
 *   the app is an optional extra after the tap.
 * - Account nobody would see yet (no family home, no follows): the panel
 *   says so and the tap opens the share sheet instead.
 * - Guest: the tap opens the share sheet with a pre-written message (no
 *   server row), plus one invitation line.
 * - Practice: a rehearsal; nothing leaves the phone.
 */
export function CheckInPanel({
  event,
  feltReportId = null,
  practice = false,
  noticeFirst = false,
  onNotNow,
  titleLevel = 2,
  testID = "im-safe-panel",
}: CheckInPanelProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const { audience } = useCheckInAudience();
  const reach = useSafeAudience();
  const inAppCheckIn = useInAppCheckIn();
  const [clientId, setClientId] = useState<string | null>(null);
  const [practiceDone, setPracticeDone] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const target = { event, feltReportId };
  const key = practice ? null : checkInKey(target);
  const existing = useCheckInForEvent(key);
  const tapped = useCheckInItem(clientId);
  const item: CheckInItem | null = tapped ?? existing;

  const locale = i18n.language;
  const shareMessage = buildSafeShareMessage(t, locale, event?.originTime ?? null);
  const choice = reach.data?.audience ?? "mutual";
  const before = reach.data
    ? reachWho(
        t,
        locale,
        { family: reach.data.family, follows: reach.data.follows },
        choice,
      )
    : null;
  // Known to reach nobody: say so and offer the message as the main action.
  const nobody = audience === "inapp" && reach.data !== null && before === null;
  const canQueue = !practice && audience === "inapp" && key !== null && !nobody;

  async function share() {
    const result = await shareSafeMessage(shareMessage);
    setShareNote(result === "copied" ? t("imSafe.action.copied") : null);
  }

  function onSafe() {
    if (practice) {
      setPracticeDone(true);
      return;
    }
    if (canQueue) {
      setClientId(inAppCheckIn(target));
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
    if (item.state === "sent") {
      const told = item.told ?? null;
      const who = told ? reachWho(t, locale, told, choice) : before;
      status = who
        ? t("imSafe.reach.after", { who })
        : told
          ? t("imSafe.status.sentNobody")
          : t("imSafe.status.sent");
    } else {
      status =
        item.state === "failed" ? t("imSafe.status.failed") : t("imSafe.status.queued");
    }
  }
  const done = practiceDone || item !== null;

  const meta = [typography.bodyMeta, { color: colors.text.secondary }];

  return (
    <View testID={testID} style={{ gap: spacing[3] }}>
      {noticeFirst ? <NoHelpNote /> : null}
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: titleToken.fontSize,
          fontFamily: nativeFontFamily(titleToken),
          ...READING_START,
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
        <Text testID="im-safe-event-line" style={meta}>
          {eventLineText(t, locale, event.magnitude, event.originTime)}
        </Text>
      ) : null}

      {!done && canQueue && before ? (
        <Text testID="im-safe-reach" style={meta}>
          {t("imSafe.reach.before", { who: before })}
        </Text>
      ) : null}
      {!done && !practice && nobody ? (
        <Text testID="im-safe-nobody" style={meta}>
          {t("imSafe.reach.nobody")}
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
                flex: 1,
                color: colors.text.primary,
                fontWeight: item?.state === "sent" ? "700" : "400",
              },
            ]}
          >
            {status}
          </Text>
        </View>
      ) : null}

      {/* A message outside the app: the optional extra after the tap. */}
      {!practice && done && !practiceDone ? (
        <LinkButton
          label={t("imSafe.action.shareAlso")}
          onPress={() => void share()}
          testID="im-safe-share"
        />
      ) : null}
      {shareNote ? (
        <Text testID="im-safe-copied" style={meta}>
          {shareNote}
        </Text>
      ) : null}

      {!practice && audience === "share" ? (
        <View style={{ gap: spacing[1] }} testID="im-safe-invite-guest">
          <Text style={meta}>{t("imSafe.guest.body")}</Text>
          <Text style={meta}>{t("imSafe.guest.invite")}</Text>
          <LinkButton
            label={t("imSafe.guest.create")}
            onPress={() => router.push("/account/sign-in")}
            testID="im-safe-create-account"
          />
        </View>
      ) : null}
      {!practice && nobody && !done ? (
        <LinkButton
          label={t("imSafe.noFamily.join")}
          onPress={() => router.push("/home/join")}
          testID="im-safe-join"
        />
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
