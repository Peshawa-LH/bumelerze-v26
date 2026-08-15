import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useQueueItemState } from "@/features/felt";
import { useTheme } from "@/theme";

/**
 * Shared completion screen (2026-08-15 flow restructure, owner directive)
 * — reached from window 3's Submit (baseline: damage + comment/photo only)
 * AND from the "add more detail" questionnaire's last step (full
 * submission) alike, since both ultimately call the same
 * `enqueueTier2Report` (`queue.ts`). Subscribes to the same queue item's
 * live state the old tier-1 confirmation screen used to (`useQueueItemState`)
 * so the queued-vs-sent wording stays accurate if a real transport resolves
 * while this screen is on-screen — this wave that's always "queued"
 * (`PendingTransport`, no Supabase project yet), but the reactive read costs
 * nothing and needs no future change once a transport exists.
 */
export default function FeltReportDoneScreen() {
  const { feltReportId } = useLocalSearchParams<{
    feltReportId?: string;
    eventId?: string;
  }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queueState = useQueueItemState(feltReportId ?? null);

  function handleClose() {
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.back();
    }
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top + spacing[4],
          paddingBottom: insets.bottom + spacing[5],
          paddingStart: spacing[5],
          paddingEnd: spacing[5],
          justifyContent: "center",
        },
      ]}
    >
      <View style={{ gap: spacing[4] }}>
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={{
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
          }}
        >
          {t("felt.done.title")}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {/* PendingTransport always ends in "awaiting-backend" this wave
           * (no Supabase project yet) — the message stays honest about that
           * rather than implying a real server confirmation. */}
          {queueState === "submitted"
            ? t("felt.done.submittedMessage")
            : t("felt.done.queuedMessage")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleClose}
          style={[
            styles.primaryButton,
            { backgroundColor: colors.brand.primary, paddingVertical: spacing[3] },
          ]}
        >
          <Text
            style={{
              color: colors.brand.onPrimary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.done.close")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  primaryButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
