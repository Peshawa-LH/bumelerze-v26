import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { placeLine } from "@/features/geo";
import { useTheme } from "@/theme";
import {
  formatMagnitude,
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
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
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();

  const relativeTime = getRelativeTime(event.originTime, now);
  const relativeTimeText =
    relativeTime.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relativeTime.unit}`, {
          value: formatRelativeTimeValue(relativeTime.value, locale),
        });

  // Single place/distance line (ui-backlog.md wave 5 items 3 & 5): replaces
  // both the raw USGS place string AND the old separate anchor-distance
  // line with one localized "{distance} {direction} of {city}, {region}"
  // built from the gazetteer — falling back to the raw USGS string only
  // for far-world events (see `placeLine`'s own doc comment).
  const placeText = placeLine(event, locale, t);
  const magnitudeText = formatMagnitude(event.magnitude, locale);
  const tone = magnitudeTone(event.magnitude.value);

  const accessibilityLabel = [
    t("events.magnitudeA11yLabel", {
      value: formatMagnitudeValue(event.magnitude.value, locale),
    }),
    placeText,
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
        {placeText}
      </Text>

      <View style={styles.metaRow}>
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
