import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  NEAREST_CITY_FALLBACK_THRESHOLD_KM,
  nearestCities,
  pickLocalizedName,
} from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { POSSIBLE_EVENT_FRESH_MINUTES } from "../config";
import { formatRelativeTimeValue, getRelativeTime, isolateNumeric } from "../format";
import type { PossibleEvent } from "../possible";

interface PossibleEventCardProps {
  event: PossibleEvent;
}

/**
 * A crowd-detected possible event on Home (D26 item 3, crowd detection v2:
 * migration 0034 and the EMSC study, research/emsc-crowd-detection-
 * 2026-10-04.md). It names SHAKING, not an earthquake — explosions and
 * strikes can raise reports too — and says plainly that seismic networks
 * have not confirmed it. Two stages: for its first 30 minutes it is an
 * alert-styled card; after that it stays visible but muted as
 * "unconfirmed" until it leaves Home at 3 hours (EMSC: an unconfirmed
 * detection that silently vanishes feeds rumours). Once a provider event
 * matches it, the server merges it and the card disappears.
 */
export function PossibleEventCard({ event }: PossibleEventCardProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;

  const [nearest] = nearestCities(event.lat, event.lon, 1);
  const city =
    nearest && nearest.distanceKm <= NEAREST_CITY_FALLBACK_THRESHOLD_KM
      ? pickLocalizedName(nearest.city.names, locale)
      : null;

  // eslint-disable-next-line react-hooks/purity -- see EventListScreen.tsx's comment on this exact pattern
  const now = Date.now();
  const fresh = now - event.firstReportAt < POSSIBLE_EVENT_FRESH_MINUTES * 60_000;

  const title = fresh
    ? city
      ? t("home.possibleEvent.freshTitle", { city })
      : t("home.possibleEvent.freshTitleUnknownArea")
    : city
      ? t("home.possibleEvent.staleTitle", { city })
      : t("home.possibleEvent.staleTitleUnknownArea");

  const relativeTime = getRelativeTime(event.firstReportAt, now);
  const relativeTimeText =
    relativeTime.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relativeTime.unit}`, {
          value: formatRelativeTimeValue(relativeTime.value, locale),
        });
  const people =
    event.userCount !== null
      ? t("home.possibleEvent.people", {
          count: event.userCount,
          number: isolateNumeric(localizeDigits(String(event.userCount), locale)),
        })
      : null;
  const meta = [people, relativeTimeText].filter(Boolean).join(" · ");

  const a11yLabel = [
    fresh ? t("home.possibleEvent.a11yAlert") : null,
    title,
    fresh ? t("home.possibleEvent.notConfirmed") : null,
    meta,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <View
      accessible
      accessibilityRole={fresh ? "alert" : "summary"}
      accessibilityLabel={a11yLabel}
      testID={fresh ? "possible-event-fresh" : "possible-event-stale"}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: fresh ? colors.status.warning : colors.border.default,
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
          fontWeight: fresh ? "600" : "400",
        }}
      >
        {title}
      </Text>
      {fresh ? (
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("home.possibleEvent.notConfirmed")}
        </Text>
      ) : null}
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {meta}
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
