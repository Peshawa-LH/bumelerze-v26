import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAccount } from "@/features/account/use-account";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

import { reachWho } from "../format";
import { useSafeAudience, useSetSafeAudience } from "../hooks";
import {
  SAFE_AUDIENCES,
  type SafeAudienceChoice,
  type SafeAudienceTransport,
} from "../transport";

/**
 * Settings > Notifications: who sees my "I'm safe" (review note 3.3,
 * migration 0064). Accounts only; three choices, mutual follows by default.
 * Under the choices, who that reaches today. Hidden for guests, and when the
 * setting cannot be loaded (before the migration, offline).
 */
export function SafeAudienceSection({
  transport,
}: {
  transport?: SafeAudienceTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const account = useAccount();
  const audience = useSafeAudience(transport);
  const setAudience = useSetSafeAudience(transport);
  const [pending, setPending] = useState<SafeAudienceChoice | null>(null);
  const [failed, setFailed] = useState(false);

  if (account.status !== "account" || !audience.data) {
    return null;
  }
  const data = audience.data;
  const selected = pending ?? data.audience;
  const counts = {
    family: data.family,
    follows:
      selected === "followers" ? data.followers : selected === "mutual" ? data.mutual : 0,
  };
  const who = reachWho(t, i18n.language, counts, selected);

  async function choose(choice: SafeAudienceChoice) {
    if (pending || choice === data.audience) {
      return;
    }
    setPending(choice);
    setFailed(false);
    try {
      await setAudience(choice);
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    ...READING_START,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  return (
    <View style={{ gap: spacing[2] }} testID="safe-audience">
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          fontFamily: nativeFontFamily(typography.h2),
          ...READING_START,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
        }}
      >
        {t("notificationSettings.safe.title")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault),
          ...READING_START,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("notificationSettings.safe.explainer")}
      </Text>
      <View style={{ gap: spacing[2] }} accessibilityRole="radiogroup">
        {SAFE_AUDIENCES.map((choice) => {
          const active = selected === choice;
          return (
            <Pressable
              key={choice}
              testID={`safe-audience-${choice}`}
              accessibilityRole="radio"
              accessibilityState={{
                selected: active,
                checked: active,
                disabled: !!pending,
              }}
              disabled={!!pending}
              onPress={() => void choose(choice)}
              style={[
                styles.row,
                {
                  borderColor: active ? colors.brand.primary : colors.border.default,
                  backgroundColor: active ? colors.surface.raised : "transparent",
                  paddingVertical: spacing[3],
                  paddingStart: spacing[4],
                  paddingEnd: spacing[4],
                },
              ]}
            >
              <Text
                allowFontScaling
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontFamily: nativeFontFamily(
                    typography.bodyDefault,
                    active ? "700" : "400",
                  ),
                  ...READING_START,
                  lineHeight: typography.bodyDefault.lineHeight,
                  fontWeight: active ? "700" : "400",
                }}
              >
                {t(`notificationSettings.safe.options.${choice}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={meta} testID="safe-audience-reach" accessibilityLiveRegion="polite">
        {who ? t("imSafe.reach.before", { who }) : t("notificationSettings.safe.nobody")}
      </Text>
      {failed ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="safe-audience-error"
        >
          {t("notificationSettings.safe.saveFailed")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 2,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
  },
});
