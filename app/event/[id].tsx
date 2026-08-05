import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  distanceFromUserKm,
  formatAbsoluteDual,
  formatCoordinates,
  formatDepthKm,
  formatIsolatedDistance,
  formatMagnitudeValue,
  isolateNumeric,
  ProvenanceChip,
  useEventById,
  useRegionEvents,
  useWorldEvents,
} from "@/features/events";
import { nearestCities, nearestCityDistanceLine, placeLine } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { useTheme } from "@/theme";

/**
 * Event Detail — header scope only (spec-v1.md §4.5, spec-v1.md §9 Phase 1
 * cut: "no ShakeMap/felt-map/comments yet"). Reads from the already-cached
 * region/world feed queries first (the common case — arriving from a list
 * row or a notification tap once those exist); falls back to a direct
 * fdsnws `eventid` lookup only for a cold-start deep link the cache
 * doesn't have yet.
 */
export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const region = useRegionEvents();
  const world = useWorldEvents();

  const cachedEvent = useMemo(
    () =>
      region.events.find((event) => event.id === id) ??
      world.events.find((event) => event.id === id) ??
      null,
    [region.events, world.events, id],
  );

  const shouldFetchById =
    !cachedEvent && Boolean(id) && !region.isInitialLoading && !world.isInitialLoading;
  const byId = useEventById(id, shouldFetchById);

  const event = cachedEvent ?? byId.event;
  const isLoading =
    !event && (region.isInitialLoading || world.isInitialLoading || byId.isLoading);
  const isNotFound = !event && !isLoading;

  return (
    <>
      <Stack.Screen options={{ title: t("eventDetail.title") }} />
      <ScrollView
        style={{ backgroundColor: colors.surface.base }}
        contentContainerStyle={{
          padding: spacing[5],
          paddingBottom: insets.bottom + spacing[8],
          gap: spacing[5],
        }}
      >
        {isLoading ? (
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("eventDetail.loading")}
          </Text>
        ) : null}

        {isNotFound ? (
          <View style={{ gap: spacing[2] }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text.primary,
                fontSize: typography.h2.fontSize,
                lineHeight: typography.h2.lineHeight,
                fontWeight: typography.h2.fontWeight,
              }}
            >
              {t("eventDetail.notFoundTitle")}
            </Text>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {t("eventDetail.notFoundDescription", { id })}
            </Text>
          </View>
        ) : null}

        {event ? (
          <EventDetailHeader
            event={event}
            locale={i18n.language}
            colors={colors}
            typography={typography}
            spacing={spacing}
            t={t}
          />
        ) : null}
      </ScrollView>
    </>
  );
}

interface EventDetailHeaderProps {
  event: NonNullable<ReturnType<typeof useEventById>["event"]>;
  locale: string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  t: ReturnType<typeof useTranslation>["t"];
}

function EventDetailHeader({
  event,
  locale,
  colors,
  typography,
  spacing,
  t,
}: EventDetailHeaderProps) {
  const { utc, local } = formatAbsoluteDual(event.originTime, locale);

  // Nearest-cities list (ui-backlog.md wave 5 item 5) — always shown, no
  // location permission needed. "From you" is a separate, optional extra
  // line, shown only once a real device fix exists.
  const nearestCityResults = nearestCities(event.lat, event.lon);
  const userFix = useUserDistanceAnchor();
  const fromYouText = userFix.hasFix
    ? t("events.distanceFromYou", {
        distance: formatIsolatedDistance(
          distanceFromUserKm(event, userFix),
          locale,
          t("units.km"),
        ),
      })
    : null;

  const { local: sourceUpdatedLocal } = formatAbsoluteDual(
    event.provenance.providerUpdatedAt,
    locale,
  );

  const placeText = placeLine(event, locale, t);

  return (
    <View style={{ gap: spacing[6] }}>
      <View style={{ gap: spacing[1] }}>
        <Text
          accessibilityRole="header"
          accessibilityLabel={t("events.magnitudeA11yLabel", {
            value: formatMagnitudeValue(event.magnitude.value, locale),
          })}
          style={{
            color: colors.text.primary,
            fontSize: typography.magnitudeHero.fontSize,
            lineHeight: typography.magnitudeHero.lineHeight,
            fontWeight: typography.magnitudeHero.fontWeight,
            fontVariant: ["tabular-nums"],
            // No forced writingDirection — see EventCard's magnitude Text.
          }}
        >
          {t("events.magnitudeDisplay", {
            value: formatMagnitudeValue(event.magnitude.value, locale),
          })}
        </Text>
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {placeText}
        </Text>
        <ProvenanceChip provider={event.provenance.provider} />
      </View>

      <DetailSection
        title={t("eventDetail.timeSectionTitle")}
        colors={colors}
        typography={typography}
        spacing={spacing}
      >
        <DetailRow
          label={t("eventDetail.utcTimeLabel")}
          value={utc}
          colors={colors}
          typography={typography}
        />
        <DetailRow
          label={t("eventDetail.localTimeLabel")}
          value={local}
          colors={colors}
          typography={typography}
        />
      </DetailSection>

      <DetailSection
        title={t("eventDetail.coordinatesSectionTitle")}
        colors={colors}
        typography={typography}
        spacing={spacing}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            fontVariant: ["tabular-nums"],
            writingDirection: "ltr",
          }}
        >
          {formatCoordinates(event.lat, event.lon, locale)}
        </Text>
      </DetailSection>

      <DetailSection
        title={t("eventDetail.depthSectionTitle")}
        colors={colors}
        typography={typography}
        spacing={spacing}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            fontVariant: ["tabular-nums"],
            writingDirection: "ltr",
          }}
        >
          {isolateNumeric(`${formatDepthKm(event.depthKm, locale)} ${t("units.km")}`)}
        </Text>
      </DetailSection>

      <DetailSection
        title={t("eventDetail.distanceSectionTitle")}
        colors={colors}
        typography={typography}
        spacing={spacing}
      >
        <View style={{ gap: spacing[1] }}>
          {nearestCityResults.map((result) => (
            <Text
              key={result.city.id}
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {nearestCityDistanceLine(result, locale, t)}
            </Text>
          ))}
          {fromYouText ? (
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {fromYouText}
            </Text>
          ) : null}
        </View>
      </DetailSection>

      <DetailSection
        title={t("eventDetail.sourceSectionTitle")}
        colors={colors}
        typography={typography}
        spacing={spacing}
      >
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("eventDetail.sourceUpdated", { time: isolateNumeric(sourceUpdatedLocal) })}
        </Text>
        {event.url ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(event.url)}
            style={{ marginTop: spacing[2] }}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("eventDetail.viewOnUsgs")}
            </Text>
          </Pressable>
        ) : null}
      </DetailSection>
    </View>
  );
}

interface DetailSectionProps {
  title: string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  children: ReactNode;
}

function DetailSection({
  title,
  colors,
  typography,
  spacing,
  children,
}: DetailSectionProps) {
  return (
    <View style={{ gap: spacing[1] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
}

function DetailRow({ label, value, colors, typography }: DetailRowProps) {
  return (
    <View style={styles.row}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontVariant: ["tabular-nums"],
          writingDirection: "ltr",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
