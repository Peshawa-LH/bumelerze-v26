import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { useTheme } from "@/theme";
import { bannerMessage } from "../labels";
import { useMyRestriction, useRequestReview } from "../queries";
import type { RestrictionsTransport } from "../transport";
import { limitsWriting } from "../types";
import { ReviewSheet } from "./ReviewSheet";

/**
 * The calm notice for a person whose account is limited: what it means, until
 * when and why, plus "Ask for review". Shows nothing for everybody else, for a
 * limit that has ended, and before the server knows about limits. Felt
 * reports and alerts are never part of a limit, and the text says so.
 */
export function RestrictionBanner({ transport }: { transport?: RestrictionsTransport }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const mine = useMyRestriction(transport);
  const review = useRequestReview(transport);
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);

  const restriction = mine.restriction;
  if (!restriction) {
    return null;
  }
  const requested = sent || restriction.appealRequestedAt !== null;
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function sendReview(message: string) {
    if (!restriction) {
      return;
    }
    await review.mutateAsync({ restrictionId: restriction.id, message });
    setSent(true);
    setAsking(false);
  }

  return (
    <View
      testID="restriction-banner"
      accessibilityLiveRegion="polite"
      style={[
        styles.box,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing[2] }]}>
        <Ionicons
          name="information-circle-outline"
          size={22}
          color={colors.status.info}
          style={styles.icon}
        />
        <View style={[styles.text, { gap: spacing[1] }]}>
          <Text
            testID="restriction-banner-message"
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
              textAlign: "auto",
            }}
          >
            {bannerMessage(t, i18n.language, restriction)}
          </Text>
          {limitsWriting(restriction.level) ? (
            <Text style={meta} testID="restriction-banner-detail">
              {t(
                restriction.level === "suspend"
                  ? "restrictions.banner.detailSuspended"
                  : "restrictions.banner.detailLimited",
              )}
            </Text>
          ) : null}
        </View>
      </View>
      {requested ? (
        <Text
          style={meta}
          accessibilityLiveRegion="polite"
          testID="restriction-requested"
        >
          {t("restrictions.banner.requested")}
        </Text>
      ) : (
        <View style={styles.actions}>
          <ActionButton
            label={t("restrictions.banner.ask")}
            onPress={() => setAsking(true)}
            testID="restriction-ask"
          />
        </View>
      )}
      {asking ? (
        <ReviewSheet onSend={sendReview} onClose={() => setAsking(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  icon: { marginTop: 1 },
  text: { flex: 1 },
  actions: { flexDirection: "row", alignItems: "center" },
});
