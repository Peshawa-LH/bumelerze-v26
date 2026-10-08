import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { AccountButton } from "@/features/account/components/AccountButton";
import type { MemberProfile } from "@/features/building/types";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { summarizeFamilyStatus, type MemberStatus } from "../family-status";
import { agoText, clockText, eventLineText } from "../format";
import { useFamilyCheckIns, useSetCheckInSharing } from "../hooks";

/**
 * Family status of one home (on the Family screen). For the latest
 * earthquake somebody checked in for: who said they are safe, when, and who
 * has not been heard from yet. Neutral words and colours: never "missing",
 * never red, never a location, a distance or a "last seen". Each person
 * also gets their own switch "Show my check-ins to this home".
 *
 * Hidden entirely when the status cannot be loaded (for example before
 * migration 0057 is applied): the rest of the Family screen is unaffected.
 */
export function FamilyStatusCard({
  tagId,
  profiles,
  myUserId,
}: {
  tagId: string;
  profiles: Record<string, MemberProfile>;
  myUserId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const family = useFamilyCheckIns(tagId);
  const setSharing = useSetCheckInSharing();
  const [busy, setBusy] = useState(false);
  const [pendingShare, setPendingShare] = useState<boolean | null>(null);

  if (family.isError) {
    return null;
  }
  const locale = i18n.language;
  // eslint-disable-next-line react-hooks/purity -- see EventListScreen.tsx's comment on this exact pattern
  const now = Date.now();
  const summary = family.data ? summarizeFamilyStatus(family.data, now) : null;
  const myShare = pendingShare ?? family.data?.myShare ?? true;

  const name = (userId: string) => {
    const base = profiles[userId]?.displayName ?? t("building.family.unnamed");
    return userId === myUserId ? t("building.family.you", { name: base }) : base;
  };

  function line(member: MemberStatus): { text: string; a11y: string } {
    const who = name(member.userId);
    const c = member.checkin;
    if (!c || member.state === "none") {
      return {
        text: t("imSafe.family.none"),
        a11y: t("imSafe.family.rowNoneA11y", { name: who }),
      };
    }
    const time = clockText(t, locale, c.checkedInAt);
    const ago = agoText(t, locale, c.checkedInAt, now);
    if (member.state === "before" && summary?.focus) {
      const later = clockText(t, locale, summary.focus.originTime);
      return {
        text: t("imSafe.family.beforeLater", { time: later }),
        a11y: t("imSafe.family.rowBeforeA11y", { name: who, time, later }),
      };
    }
    if (member.state === "earlier") {
      return {
        text: t("imSafe.family.earlier", { time, ago }),
        a11y: t("imSafe.family.rowSafeA11y", { name: who, time, ago }),
      };
    }
    return {
      text: t("imSafe.family.safe", { time, ago }),
      a11y: t("imSafe.family.rowSafeA11y", { name: who, time, ago }),
    };
  }

  async function toggle(on: boolean) {
    setBusy(true);
    setPendingShare(on);
    try {
      await setSharing(tagId, on);
    } catch {
      setPendingShare(null);
    } finally {
      setBusy(false);
    }
  }

  const others = summary ? summary.members.filter((m) => m.userId !== myUserId) : [];

  return (
    <View
      testID="family-status"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("imSafe.family.title")}
      </Text>

      {family.isLoading ? (
        <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
          {t("building.loading")}
        </Text>
      ) : null}

      {summary?.focus ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            testID="family-status-event"
            style={[typography.bodyDefault, { color: colors.text.primary }]}
          >
            {eventLineText(t, locale, summary.focus.magnitude, summary.focus.originTime)}
          </Text>
          <Text
            testID="family-status-summary"
            accessibilityLabel={t("imSafe.family.summaryA11y", {
              n: localizeDigits(String(summary.checkedIn), locale),
              total: localizeDigits(String(summary.total), locale),
            })}
            style={[typography.bodyMeta, { color: colors.text.secondary }]}
          >
            {t("imSafe.family.summary", {
              n: localizeDigits(String(summary.checkedIn), locale),
              total: localizeDigits(String(summary.total), locale),
            })}
          </Text>
        </View>
      ) : summary ? (
        <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
          {others.length === 0 ? t("imSafe.family.alone") : t("imSafe.family.empty")}
        </Text>
      ) : null}

      {summary?.members.map((member) => {
        const { text, a11y } = line(member);
        const profile = profiles[member.userId];
        const current = member.state === "safe";
        return (
          <View
            key={member.userId}
            testID={`family-status-row-${member.userId}`}
            accessible
            accessibilityLabel={a11y}
            style={[styles.row, { gap: spacing[3] }]}
          >
            <Avatar
              uri={getAvatarUrl(profile?.avatarPath)}
              name={profile?.displayName ?? null}
              size={36}
            />
            <View style={styles.grow}>
              <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
                {name(member.userId)}
              </Text>
              <View style={[styles.row, { gap: spacing[1] }]}>
                <Ionicons
                  name={
                    current
                      ? "checkmark-circle"
                      : member.state === "none"
                        ? "ellipse-outline"
                        : "time-outline"
                  }
                  size={16}
                  color={current ? colors.status.success : colors.text.tertiary}
                />
                <Text
                  testID={`family-status-state-${member.userId}`}
                  style={[
                    typography.bodyMeta,
                    styles.grow,
                    { color: current ? colors.text.primary : colors.text.secondary },
                  ]}
                >
                  {text}
                </Text>
              </View>
            </View>
          </View>
        );
      })}

      <AccountButton
        tone="primary"
        label={t("imSafe.button.safe")}
        onPress={() => router.push("/im-safe")}
        testID="family-status-check-in"
      />

      {family.data ? (
        <View style={[styles.row, { gap: spacing[3] }]}>
          <View style={styles.grow}>
            <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
              {t("imSafe.family.setting")}
            </Text>
            <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
              {t("imSafe.family.settingHint")}
            </Text>
          </View>
          <Switch
            testID="family-status-share-switch"
            accessibilityLabel={t("imSafe.family.setting")}
            accessibilityHint={t("imSafe.family.settingHint")}
            value={myShare}
            disabled={busy}
            onValueChange={(on) => void toggle(on)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
  row: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
});
