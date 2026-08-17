import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatMagnitudeValue } from "@/features/events";
import { placeLine } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import type { NotableHistoricalEvent } from "../notable-events";

interface HistoricalEventRowProps {
  event: NotableHistoricalEvent;
  onPress: (event: NotableHistoricalEvent) => void;
}

/**
 * One row of the Historical View (lite) list (spec-v1.md §4.7): year,
 * magnitude, localized place line, one-line factual note. Deliberately its
 * own small component rather than a reuse of `EventCard` — the curated
 * dataset has a different display contract (year instead of relative time,
 * a note line, no provenance chip/live sig score) even though it shares the
 * same magnitude/place-line formatting primitives as the live feed.
 */
export function HistoricalEventRow({ event, onPress }: HistoricalEventRowProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();

  const yearText = localizeDigits(String(event.year), locale);
  const magnitudeText = t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(event.magnitude, locale),
  });
  // Localized event NAME (owner 2026-08-17: "some of the event names are
  // still in English, especially the ones in the Historical category") —
  // a real translated string in every locale catalog, not derived from
  // `placeLine`'s gazetteer-distance logic. `placeNameKey` (only set for
  // the 2023 Kahramanmaraş doublet, the two events beyond the gazetteer's
  // fallback radius) closes the one remaining English leak in `placeText`
  // below — see `placeLine`'s own doc comment.
  const nameText = t(`historical.eventNames.${event.noteKey}`);
  const placeText = placeLine(
    {
      lat: event.lat,
      lon: event.lon,
      placeName: event.placeName,
      // `exactOptionalPropertyTypes`: only include the key when actually
      // set, rather than assigning `undefined` explicitly.
      ...(event.placeNameKey ? { placeNameKey: event.placeNameKey } : {}),
    },
    locale,
    t,
  );
  const noteText = t(`historical.notes.${event.noteKey}`);

  const accessibilityLabel = [yearText, magnitudeText, nameText, placeText, noteText].join(
    ". ",
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(event)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[1],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
            fontWeight: typography.labelCaption.fontWeight,
            fontVariant: ["tabular-nums"],
          }}
        >
          {yearText}
        </Text>
        <Text
          allowFontScaling
          style={{
            color: colors.text.primary,
            fontSize: typography.magnitudeCompact.fontSize,
            lineHeight: typography.magnitudeCompact.lineHeight,
            fontWeight: typography.magnitudeCompact.fontWeight,
            fontVariant: ["tabular-nums"],
          }}
        >
          {magnitudeText}
        </Text>
      </View>

      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {nameText}
      </Text>

      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {placeText}
      </Text>

      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {noteText}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
