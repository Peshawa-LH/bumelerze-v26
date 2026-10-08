import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, type ReactNode } from "react";
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
  MAX_NAMED_SOURCE_TAGS_FULL,
  TagRow,
  useBumelerzeId,
  useEventById,
  useEventSourceAgencies,
} from "@/features/events";
import {
  FELT_PILL_CLEARANCE,
  FeltReportPill,
  useOwnQueueItemForEvent,
} from "@/features/felt";
import { EventHubPill, useRouteEvent } from "@/features/eventhub";
import { FeltMapSection } from "@/features/feltmap";
import { nearestCities, nearestCityDistanceLine, placeLine } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { ShareToProfileButton } from "@/features/posts/components/ShareToProfileButton";
import { ShareButton, shareIdFor } from "@/features/share";
import { RiskSection, ShakeMapSection } from "@/features/shakemap";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * Event Detail — header scope only (spec-v1.md §4.5, spec-v1.md §9 Phase 1
 * cut: "no shakemap/felt-map/comments yet"). Reads from the already-cached
 * region/world feed queries first (the common case — arriving from a list
 * row or a notification tap once those exist); falls back to a direct
 * fdsnws `eventid` lookup only for a cold-start deep link the cache
 * doesn't have yet.
 *
 * **Identity (owner directive 2026-09-02): the canonical route id is the
 * Bumelerze `bml` id, never a provider id** — USGS/EMSC/GEOFON ids and
 * event names are provenance only, cited in the Source section, never our
 * own identity surface. Two entry shapes:
 *  - **A `bml` id** (`isBumelerzeId(id)`): look for it in the cached feeds
 *    (by `event.bumelerzeId`, which a live feed event never carries yet —
 *    see `types.ts` — or, for the 11 curated Historical events, by the
 *    static provider-id ALIAS `NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID`), else
 *    fetch it straight from Supabase (`useEventByBumelerzeId`) and
 *    normalize it (`supabase-event.ts`).
 *  - **A provider id** (old links, a notification payload, a feed row that
 *    still only carries one) — resolved the existing way (cache, else the
 *    USGS `byId` fetch), then `router.replace`d to `/event/<bml>` the
 *    moment a bml id is known for it, either instantly from the static
 *    curated-event alias (no network) or from `useBumelerzeId`'s Supabase
 *    lookup. The screen renders fully at the OLD url while that resolves —
 *    the redirect is a URL hygiene step, never a loading gate.
 */
export default function EventDetailScreen() {
  const tabBarScroll = useTabBarScroll();
  const { id, origin } = useLocalSearchParams<{ id: string; origin?: string }>();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Event lookup (feed caches, then a direct fetch) is shared with the Event
  // hub screen — see `useRouteEvent`.
  const { event, isLoading, isNotFound, routeIsBumelerzeId, staticBumelerzeIdAlias } =
    useRouteEvent(id);

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

  // Resolve this event's bml id from Supabase ONLY when we don't already
  // know one another way (a bml-id route, or the static curated alias) —
  // `useBumelerzeId` itself no-ops (stays disabled) whenever `enabled` is
  // false, so this never issues a network request those two cases don't
  // need. `event` may still be `null` momentarily (loading) — `useBumelerzeId`
  // handles that too (its own `enabled` gate requires a non-null event).
  const shouldResolveBumelerzeId =
    !routeIsBumelerzeId && !staticBumelerzeIdAlias && Boolean(event);
  const resolvedBumelerzeId = useBumelerzeId(
    shouldResolveBumelerzeId ? event : null,
    shouldResolveBumelerzeId,
  );

  // The bml id to show in the header the moment ANY source knows it — the
  // event's own field (set directly for a Supabase-normalized event),
  // else the route param itself (we arrived via a bml-id alias match),
  // else the static curated alias, else whatever `useBumelerzeId` resolved.
  const displayBumelerzeId =
    event?.bumelerzeId ??
    (routeIsBumelerzeId ? id : null) ??
    staticBumelerzeIdAlias ??
    resolvedBumelerzeId.bumelerzeId;

  // URL hygiene only (this file's own header doc comment) — never a loading
  // gate; the screen already has everything it needs to render fully at
  // the OLD (provider-id) url the instant `displayBumelerzeId` is known.
  useEffect(() => {
    if (!routeIsBumelerzeId && displayBumelerzeId) {
      router.replace(`/event/${displayBumelerzeId}`);
    }
  }, [routeIsBumelerzeId, displayBumelerzeId, router]);

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
          headerRight: () =>
            event ? (
              <ShareButton
                event={event}
                shareId={shareIdFor(event, displayBumelerzeId)}
              />
            ) : null,
        }}
      />
      <View style={styles.flex}>
        <ScrollView
          {...tabBarScroll}
          style={{ backgroundColor: colors.surface.base }}
          contentContainerStyle={{
            padding: spacing[5],
            paddingBottom: insets.bottom + spacing[8] + FELT_PILL_CLEARANCE,
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
              bumelerzeId={displayBumelerzeId}
              locale={i18n.language}
              colors={colors}
              typography={typography}
              spacing={spacing}
              t={t}
              onNavigateHistorical={() => router.push("/historical")}
            />
          ) : null}

          {/* "Share to my profile" (P2-11): an event card on my profile, never
           * my location. Needs the bml id, so it waits until one is known. */}
          {event ? (
            <ShareToProfileButton
              eventRef={displayBumelerzeId ?? null}
              preview={{
                magnitude: event.magnitude.value,
                lat: event.lat,
                lon: event.lon,
                time: event.originTime,
              }}
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
        {/* "Who felt it?" (Event hub), the mirror pill at the opposite
         * corner; applies its own regional + activity/recency rule. */}
        {event ? <EventHubPill event={event} routeId={displayBumelerzeId ?? id} /> : null}
      </View>
    </>
  );
}

interface EventDetailHeaderProps {
  event: NonNullable<ReturnType<typeof useEventById>["event"]>;
  /** The event's bml id, from whichever source resolved it first — see
   * `EventDetailScreen`'s own `displayBumelerzeId` doc comment. `null`
   * whenever nothing has resolved one yet (or ever will — most feed events,
   * most of the time); the header still renders fully without it, just
   * without the "Bumelerze ID" row (never a loading gate). */
  bumelerzeId: string | null;
  locale: string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  t: ReturnType<typeof useTranslation>["t"];
  onNavigateHistorical: () => void;
}

function EventDetailHeader({
  event,
  bumelerzeId,
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

  // Same batched transport as the list screens — a single-element array is
  // just the degenerate batch, never a second per-event code path.
  const sourceAgencies = useEventSourceAgencies([event]).get(event.id)?.agencies;

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
        {/* The detail page is where the full corroboration belongs: the
         * card stays compact (owner directive 2026-08-28), but here there
         * is room to name every agency that located this earthquake. */}
        <TagRow
          provider={event.provenance.provider}
          agencies={sourceAgencies}
          maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL}
        />
        {/* Bumelerze's own identity (owner directive 2026-09-02: "we
         * cannot replicate [USGS's] id or event names") — shown the moment
         * it's known, from whichever source resolved it
         * (`EventDetailScreen`'s own `displayBumelerzeId`); silently absent
         * otherwise, never a loading placeholder. */}
        {bumelerzeId ? (
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
              fontVariant: ["tabular-nums"],
            }}
          >
            {t("eventDetail.bumelerzeIdRow", { id: isolateNumeric(bumelerzeId) })}
          </Text>
        ) : null}
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

      {/* Damage-estimate dashboard (D46 risk chain, `risk-dashboard`
       * wave), directly below ShakeMap — mounted unconditionally too;
       * `RiskSection` itself renders nothing for the common no-risk-
       * product event (only 3 events carry one at launch). */}
      <RiskSection event={event} />

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
        {/* The provider's OWN free-text place/title (USGS `properties.place`,
         * EMSC `flynn_region`) — cited here, and ONLY here, never as this
         * screen's headline (owner directive 2026-09-02: "we cannot
         * replicate their id or event names"; `placeText` above is always
         * our own localized place line). Hidden for the common case where
         * the provider text is empty or is already exactly what the
         * headline shows (e.g. a curated Historical event whose
         * `placeNameKey` translation happens to read the same) — citing an
         * identical string twice on one screen is noise, not provenance. */}
        {event.placeName && event.placeName !== placeText ? (
          <Text
            style={{
              marginTop: spacing[2],
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {t("eventDetail.sourceProviderTitle", {
              network: event.provenance.provider.toUpperCase(),
              title: event.placeName,
            })}
          </Text>
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

/**
 * Label over value, start-aligned — the same shape every other section on
 * this page uses. Until 2026-09-27 this was a `space-between` row, which
 * pushed the value to the far edge on any wide layout and, under RTL,
 * parked the (necessarily LTR) timestamp on the LEFT of its label: "the
 * time parts go to the left side of the other text" (feedback e1221625).
 */
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
          // A timestamp reads left-to-right in every locale; `alignSelf`
          // keeps it at the reading START under RTL rather than letting the
          // LTR run float to the opposite edge.
          writingDirection: "ltr",
          alignSelf: "flex-start",
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
    gap: 2,
  },
  myReportRow: {
    borderWidth: 1,
    borderRadius: 12,
  },
  backToMapRow: {
    alignSelf: "flex-start",
  },
});
