import { memo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { placeLine } from "@/features/geo";
import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";
import {
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
} from "../format";
import { magnitudeTone } from "../magnitude-tone";
import type { Event } from "../types";
import { buildTagRowAccessibilityLabel, TagRow } from "./TagRow";

interface EventCardProps {
  event: Event;
  onPress: (event: Event) => void;
  /** Fixed "now" for relative-time math, passed down from the list screen
   * so every card in one render pass agrees on the same instant instead of
   * each computing `Date.now()` independently. Re-renders (query refetch,
   * pull-to-refresh) naturally refresh this — no internal ticking timer in
   * Phase 1, matching the "boring choice" instruction for this wave. */
  now: number;
  /** True when this card is only on Home because of the adaptive
   * Home-feed policy's magnitude-tiered notable carve-out
   * (`home-feed-policy.ts`) — i.e. it's older than the feed's normal
   * window. Renders a small "notable" tag in the tag row so an old, still-
   * significant event doesn't read as fresh or confusingly out of place
   * next to yesterday's smaller ones (update-plan-2026-08.md §1.1).
   * Defaults to `false` for every other list (World, Significant). */
  isNotable?: boolean;
  /** Distinct authoring agencies for this event from the corroboration
   * registry (`useEventSourceAgencies`, batched once per list — never
   * fetched per card). `undefined` when the registry has no match yet
   * (Supabase unreachable, or this event simply isn't there) — `TagRow`
   * falls back to the single provider chip in that case. */
  sourceAgencies?: readonly string[] | undefined;
}

function EventCardImpl({
  event,
  onPress,
  now,
  isNotable = false,
  sourceAgencies,
}: EventCardProps) {
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
  const magnitudeText = t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(event.magnitude.value, locale),
  });
  const tone = magnitudeTone(event.magnitude.value);

  // Web-only fix-up: react-native-web resolves logical style props
  // (`borderStartColor`/`borderStartWidth` below) from a `dir` prop
  // threaded onto *this* element, not from the ambient `<html dir="rtl">`
  // the i18n boot sets on `document.documentElement` — an unset `dir` prop
  // always bakes them to their LTR physical side regardless of document
  // direction (verified directly against the installed react-native-web
  // 0.21.2's SSR output). `I18nManager.isRTL` can't stand in for this
  // either: react-native-web's own `I18nManager` is a stub whose
  // `getConstants()` always reports `isRTL: false`. `isRTLLocale(locale)`,
  // driven straight off the active i18next language, is the one direction
  // signal this component can actually trust on web. Native needs none of
  // this — `I18nManager.isRTL` there is the real, correctly-set flag RN's
  // own layout engine already uses to flip `borderStart*`/etc.
  const webDirProp =
    Platform.OS === "web" ? { dir: isRTLLocale(locale) ? "rtl" : "ltr" } : null;

  const tagRowA11yLabel = buildTagRowAccessibilityLabel(
    { provider: event.provenance.provider, agencies: sourceAgencies, isNotable },
    t,
  );

  const accessibilityLabel = [
    t("events.magnitudeA11yLabel", {
      value: formatMagnitudeValue(event.magnitude.value, locale),
    }),
    placeText,
    relativeTimeText,
    tagRowA11yLabel,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      testID={`event-card-${event.id}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(event)}
      {...webDirProp}
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
      <Text
        allowFontScaling
        style={{
          color: colors.text.primary,
          fontSize: typography.magnitudeCompact.fontSize,
          lineHeight: typography.magnitudeCompact.lineHeight,
          fontWeight: typography.magnitudeCompact.fontWeight,
          fontVariant: ["tabular-nums"],
          // No forced writingDirection: "M 4.1" (en/kmr) is an LTR run
          // and "٤.١ پلە" (ckb/ar) an RTL run — Unicode auto-direction
          // resolves each correctly; forcing LTR would flip the Kurdish
          // template to "پلە ٤.١" read order.
        }}
      >
        {magnitudeText}
      </Text>

      {/* Own full-width row (not squeezed beside the magnitude, spec change
       * from the old single-chip layout): with up to three named source
       * tags plus notable/shakemap, this can run to two lines on a narrow
       * phone at large font scale — `TagRow`'s own `flexWrap: "wrap"`
       * handles that, but only if it has the card's full width to wrap
       * within, which a row shared with the magnitude text would not
       * reliably give it (owner brief: "rather than overflowing a phone
       * card"). */}
      <TagRow
        standalone={false}
        provider={event.provenance.provider}
        agencies={sourceAgencies}
        isNotable={isNotable}
      />

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
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
});
