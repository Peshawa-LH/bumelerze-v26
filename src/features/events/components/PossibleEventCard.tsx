import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  NEAREST_CITY_FALLBACK_THRESHOLD_KM,
  nearestCities,
  pickLocalizedName,
} from "@/features/geo";
import { useTheme } from "@/theme";
import { formatRelativeTimeValue, getRelativeTime } from "../format";
import type { PossibleEvent } from "../possible";

interface PossibleEventCardProps {
  event: PossibleEvent;
}

/**
 * The crowd-detected "possible event" alert card (D26 item 3,
 * felt-detection-design.md §3), rendered above the event list on Home
 * whenever `usePossibleEvents` has at least one active row. Deliberately
 * NOT pressable this wave (no detail page for crowd events yet — design
 * doc §6 records this as future work) and deliberately NOT gated by
 * `HOME_FEED_MIN_MAGNITUDE`: a possible event has no magnitude to compare
 * against that floor in the first place (design doc §3: "NOT subject to
 * the M>=3 floor").
 *
 * Visual treatment uses `colors.status.warning` (an "attention" tone) —
 * explicitly NOT the intensity ramp (`colors.intensity[n]`), since this
 * card has no intensity/CDI value behind it, only "people nearby reported
 * something".
 */
export function PossibleEventCard({ event }: PossibleEventCardProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  // Same "close enough to name" contract as `placeLine` (geo/place-line.ts):
  // `nearestCities` always returns a result for n>=1 no matter how far away
  // (it's the geometrically closest of a fixed, non-empty gazetteer), so
  // the real "is this actually nearby" test is the distance threshold, not
  // nullishness.
  const [nearest] = nearestCities(event.lat, event.lon, 1);
  const city =
    nearest && nearest.distanceKm <= NEAREST_CITY_FALLBACK_THRESHOLD_KM
      ? pickLocalizedName(nearest.city.names, i18n.language)
      : null;

  const message = city
    ? t("home.possibleEvent.message", { city })
    : t("home.possibleEvent.messageUnknownArea");

  // Reuses EventCard's own relative-time phrase machinery/i18n keys
  // (events/format.ts, "events.relativeTime.*") — same digit-localization
  // path (`formatRelativeTimeValue` -> `localizeDigits`) every other
  // relative-time display in the app already goes through, not a separate
  // one-off implementation. No live ticking clock (boring choice, same
  // `Date.now()`-at-render pattern as `EventListScreen.tsx`'s own `now`).
  // eslint-disable-next-line react-hooks/purity -- see EventListScreen.tsx's comment on this exact pattern
  const now = Date.now();
  const relativeTime = getRelativeTime(event.originTime, now);
  const relativeTimeText =
    relativeTime.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relativeTime.unit}`, {
          value: formatRelativeTimeValue(relativeTime.value, i18n.language),
        });

  const a11yLabel = [
    city
      ? t("home.possibleEvent.a11yLabel", { city })
      : t("home.possibleEvent.messageUnknownArea"),
    relativeTimeText,
  ].join(". ");

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={a11yLabel}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.status.warning,
          padding: spacing[4],
          gap: spacing[1],
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontWeight: "600",
        }}
      >
        {message}
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
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderStartWidth: 4,
    borderRadius: 12,
  },
});
