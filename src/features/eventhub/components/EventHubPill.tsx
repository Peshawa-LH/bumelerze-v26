import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Event } from "@/features/events";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";

import { useEventHubSummary } from "../queries";
import { shouldShowHubPill } from "../visibility";

interface EventHubPillProps {
  event: Event;
  /** The id the hub route is opened with: the event's bml id when known,
   * else the route id this page itself was opened with. */
  routeId: string;
}

/**
 * "Who felt it?": the Event hub entry on the event page. Same shape and size
 * as the felt-report pill but in the calm brand colour (the red is reserved
 * for "I felt it"), floating at the opposite bottom corner: `start`, where
 * the felt pill sits at `end`, so it mirrors itself under RTL.
 *
 * Hidden unless the event is regional AND it already has reports/comments or
 * happened within the last 72 hours (`shouldShowHubPill`), and hidden when no
 * Supabase project is configured, since the hub has nothing to read then.
 */
export function EventHubPill({ event, routeId }: EventHubPillProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { summary } = useEventHubSummary(event);
  // One reading of the clock per mount: the rule works in days, so a pill
  // that stays up a little past its window until the page is reopened is fine.
  const [nowMs] = useState(() => Date.now());

  const visible =
    isSupabaseConfigured() &&
    shouldShowHubPill({
      isRegional: event.isRegional,
      originTime: event.originTime,
      nowMs,
      summary,
    });
  if (!visible) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("eventHub.pill.label")}
      accessibilityHint={t("eventHub.pill.hint")}
      onPress={() => router.push(`/event-hub/${routeId}`)}
      testID="event-hub-pill"
      style={({ pressed }) => [
        styles.pill,
        {
          start: spacing[4],
          bottom: insets.bottom + spacing[4],
          backgroundColor: colors.brand.primary,
          paddingHorizontal: spacing[5],
          // Same vertical padding and minimum height as the felt pill.
          paddingVertical: spacing[4],
          minHeight: 48,
          // Same rule as the felt pill: the Sorani label's width for every
          // language (owner, 2026-10-08).
          minWidth: HUB_PILL_MIN_WIDTH,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text
        allowFontScaling
        style={{
          color: colors.brand.onPrimary,
          fontSize: typography.labelButton.fontSize,
          fontWeight: typography.labelButton.fontWeight,
        }}
      >
        {t("eventHub.pill.label")}
      </Text>
    </Pressable>
  );
}

export const HUB_PILL_MIN_WIDTH = 152;

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    borderRadius: 999,
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
});
