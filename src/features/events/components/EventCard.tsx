import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { nearestAnchor } from "../distance";
import {
  formatDistanceKm,
  formatMagnitude,
  getRelativeTime,
  isolateNumeric,
} from "../format";
import { magnitudeTone } from "../magnitude-tone";
import type { Event } from "../types";
import { ProvenanceChip } from "./ProvenanceChip";

interface EventCardProps {
  event: Event;
  onPress: (event: Event) => void;
  /** Fixed "now" for relative-time math, passed down from the list screen
   * so every card in one render pass agrees on the same instant instead of
   * each computing `Date.now()` independently. Re-renders (query refetch,
   * pull-to-refresh) naturally refresh this — no internal ticking timer in
   * Phase 1, matching the "boring choice" instruction for this wave. */
  now: number;
}

function EventCardImpl({ event, onPress, now }: EventCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  const relativeTime = getRelativeTime(event.originTime, now);
  const relativeTimeText =
    relativeTime.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relativeTime.unit}`, { count: relativeTime.value });

  const { anchor, distanceKm } = nearestAnchor(event.lat, event.lon);
  const distanceText = t("events.distanceFromAnchor", {
    distance: isolateNumeric(formatDistanceKm(distanceKm)),
    anchor: t(anchor.nameKey),
  });

  const magnitudeText = formatMagnitude(event.magnitude);
  const tone = magnitudeTone(event.magnitude.value);

  const accessibilityLabel = [
    t("events.magnitudeA11yLabel", { value: event.magnitude.value.toFixed(1) }),
    event.placeName,
    distanceText,
    relativeTimeText,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(event)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          borderStartColor: colors.status[tone],
          padding: spacing[4],
          gap: spacing[1],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          allowFontScaling
          style={{
            color: colors.text.primary,
            fontSize: typography.magnitudeCompact.fontSize,
            lineHeight: typography.magnitudeCompact.lineHeight,
            fontWeight: typography.magnitudeCompact.fontWeight,
            fontVariant: ["tabular-nums"],
            writingDirection: "ltr",
          }}
        >
          {magnitudeText}
        </Text>
        <ProvenanceChip provider={event.provenance.provider} />
      </View>

      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {event.placeName}
      </Text>

      <View style={styles.metaRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {distanceText}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {relativeTimeText}
        </Text>
      </View>
    </Pressable>
  );
}

export const EventCard = memo(EventCardImpl);

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    // Tone accent stripe on the reading-start edge (logical property, per
    // design-language.md §5: never hardcode left/right). Kept separate from
    // MagnitudeChip's own always-neutral text color, per §3.2.
    borderStartWidth: 4,
    borderRadius: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
});
