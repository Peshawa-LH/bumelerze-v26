import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
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
import { FeltReportPill, useOwnQueueItemForEvent } from "@/features/felt";
import { FeltMapSection } from "@/features/feltmap";
import { nearestCities, nearestCityDistanceLine, placeLine } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { ShakeMapSection } from "@/features/shakemap";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/**
 * Event Detail — header scope only (spec-v1.md §4.5, spec-v1.md §9 Phase 1
 * cut: "no shakemap/felt-map/comments yet"). Reads from the already-cached
 * region/world feed queries first (the common case — arriving from a list
 * row or a notification tap once those exist); falls back to a direct
 * fdsnws `eventid` lookup only for a cold-start deep link the cache
 * doesn't have yet.
 */
export default function EventDetailScreen() {
  const { id, origin } = useLocalSearchParams<{ id: string; origin?: string }>();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Map-event-sheet wave (owner: "an option to go back to the map"):
  // `origin === "map"` is set ONLY by the Map screen's preview sheet
  // (`EventPreviewSheet`'s `handleOpenFull`) when it pushes this route — a
  // notification tap or any other entry point into `/event/[id]` never sets
  // it, so this affordance only ever appears for the ONE path the owner was
  // actually asking about, not globally. `router.back()` already lands back
  // on Map by construction whenever `origin` is set this way (the sheet is
  // only ever open while already ON the Map screen, so pushing this route
  // always has Map directly beneath it on the stack) — `canGoBack()` +
  // `replace` as a fallback only guards the unusual case where something
  // else already cleared the stack out from under this screen before the
  // button is pressed.
  const handleBackToMap = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/map");
    }
  }, [router]);

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

  // Local-only lookup (D8, wave brief point 4): this device's own queued
  // report for this event, if any — there is no backend to ask for a
  // felt-map/report count yet, so "your report" can only ever reflect what
  // THIS device itself already submitted (features/felt/queue.ts).
  const ownReport = useOwnQueueItemForEvent(event?.id ?? null);

  return (
    <>
      <Stack.Screen
        options={{
          title: t("eventDetail.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <View style={styles.flex}>
        <ScrollView
          style={{ backgroundColor: colors.surface.base }}
          contentContainerStyle={{
            padding: spacing[5],
            paddingBottom: insets.bottom + spacing[8],
            gap: spacing[5],
          }}
        >
          {/* Map-event-sheet wave: an explicit, always-visible "back to
           * map" affordance, styled like this screen's own
           * `historicalContextLink` below — deliberately no directional
           * chevron/arrow glyph (Ionicons doesn't auto-mirror for RTL, and
           * this app has no established icon-flipping convention yet to
           * reuse; a plain text link avoids that pitfall entirely). Shown
           * ONLY for `origin === "map"` — see `handleBackToMap`'s own doc
           * comment for why. */}
          {origin === "map" ? (
            <Pressable
              accessibilityRole="button"
              onPress={handleBackToMap}
              hitSlop={12}
              style={styles.backToMapRow}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("eventDetail.backToMap")}
              </Text>
            </Pressable>
          ) : null}

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
              onNavigateHistorical={() => router.push("/historical")}
            />
          ) : null}

          {event && ownReport ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (ownReport.tier2) {
                  // Tier 2 already submitted — nothing further to reach from
                  // here this wave (no edit flow yet); the row still confirms
                  // detail was added.
                  return;
                }
                // 2026-08-15 flow restructure (owner directive): "add more
                // detail" on an existing tier-1-only report now enters at
                // window 2 (damage) — the baseline windows 2/3 upgrade path
                // — not straight into the deeper questionnaire, which is
                // reachable from window 3 itself if the user wants to go
                // further.
                router.push({
                  pathname: "/felt-report/damage",
                  params: {
                    feltReportId: ownReport.tier1.reportId,
                    eventId: event.id,
                  },
                });
              }}
              style={[
                styles.myReportRow,
                {
                  borderColor: colors.border.default,
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
                {t("eventDetail.myReportRow.reported", {
                  level: localizeDigits(
                    String(ownReport.tier1.cartoonLevel),
                    i18n.language,
                  ),
                })}
              </Text>
              {!ownReport.tier2 ? (
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.bodyMeta.fontSize,
                    fontWeight: "600",
                  }}
                >
                  {t("eventDetail.myReportRow.addDetail")}
                </Text>
              ) : (
                <Text
                  style={{
                    color: colors.text.secondary,
                    fontSize: typography.bodyMeta.fontSize,
                  }}
                >
                  {t("eventDetail.myReportRow.detailAdded")}
                </Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
        {/* Kurdistan gate (D26 item 5): the report entry only appears for
         * events felt inside/affecting the region — a world-only event gets
         * no report entry point on its own detail page (Home's own pill
         * stays available regardless, since it's associated to a regional
         * event by `resolveHomeFeltAssociation` in the first place). */}
        {event && event.isRegional ? (
          <FeltReportPill eventId={event.id} event={event} />
        ) : null}
      </View>
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
  onNavigateHistorical: () => void;
}

function EventDetailHeader({
  event,
  locale,
  colors,
  typography,
  spacing,
  t,
  onNavigateHistorical,
}: EventDetailHeaderProps) {
  const { utc, local } = formatAbsoluteDual(event.originTime, locale, t);

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
    t,
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

      {/* Historical-context link (spec-v1.md §4.5 "earthquakes here since
       * 1900" / §4.7 lite scope): points at the same bundled Historical View
       * for every screen — no per-location filtering in this "lite" wave —
       * shown only for regional events (the same `isRegional` flag the feed
       * already computes, event-pipeline-design.md §4), since a far-world
       * event has no regional history worth linking to. */}
      {event.isRegional ? (
        <Pressable accessibilityRole="button" onPress={onNavigateHistorical} hitSlop={12}>
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("eventDetail.historicalContextLink")}
          </Text>
        </Pressable>
      ) : null}

      {/* Lazy, self-contained (spec-v1.md §4.5 ordering: Distance -> ShakeMap
       * -> Source) — mounted unconditionally, but renders nothing for the
       * common no-shakemap-product event (no empty shell) and never blocks
       * this header, which is already fully rendered above from feed data. */}
      <ShakeMapSection event={event} />

      {/* Felt map (spec-v1.md §4.5 "Felt map tab: our own CDI-aggregated
       * grid cells"), a sibling of ShakeMap directly below it — mounted
       * unconditionally too; `FeltMapSection` itself decides
       * hidden/offline/ready (no Supabase project configured yet ->
       * hidden, same graceful env-gating as the rest of the app). */}
      <FeltMapSection event={event} />

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
        {/* Citation only — deliberately NO outbound link to the provider
         * (owner call 2026-08-06): we cite the source network per the
         * provenance principle, but users stay in the app. The network
         * name comes from the event's provenance so future FDSN providers
         * (EMSC, GEOFON — D4) slot in without UI changes; a configurable
         * network-priority display is a later system feature (see
         * docs/research/event-pipeline-design.md §2 authority tiers). */}
        <Text
          style={{
            marginTop: spacing[2],
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("eventDetail.sourceCitation", {
            network: event.provenance.provider.toUpperCase(),
          })}
        </Text>
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
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  myReportRow: {
    borderWidth: 1,
    borderRadius: 12,
  },
  backToMapRow: {
    alignSelf: "flex-start",
  },
});
