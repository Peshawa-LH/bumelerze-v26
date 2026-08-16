import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  EventListScreen,
  HOME_FEED_MIN_MAGNITUDE,
  useRegionEvents,
} from "@/features/events";
import { FeltReportPill, resolveHomeFeltAssociation } from "@/features/felt";
import { useTheme } from "@/theme";

/**
 * Home / region-first feed (spec-v1.md §4.1) — the default landing screen,
 * cached-first. Header row links to World Catalog and Significant Events
 * (pushed routes, not tabs — D11 region-first inversion). Also hosts the
 * persistent felt-report pill (D8, wave brief point 4) — association is
 * resolved HERE (most recent regional event within the last hour, else
 * unassociated) using the already-loaded region feed, not inside the pill
 * itself, so the pill component stays a dumb navigation trigger reusable on
 * Event Detail too.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();

  const {
    events,
    isInitialLoading,
    isOfflineIsh,
    isHardError,
    isRefreshing,
    dataUpdatedAt,
    refetch,
  } = useRegionEvents();

  // Felt-pill association deliberately uses the UNFILTERED feed: a person
  // can feel an event the Home display floor hides.
  const associatedEventId = resolveHomeFeltAssociation(events);
  // The matched Event itself (not just its id) — passed to FeltReportPill
  // so it can build the registration snapshot the report resolves against
  // a canonical server uuid with (migration 0011). Same array `events`
  // already holds, no extra fetch.
  const associatedEvent = associatedEventId
    ? (events.find((event) => event.id === associatedEventId) ?? null)
    : null;

  // Display floor only — see HOME_FEED_MIN_MAGNITUDE's config comment.
  const shownEvents = events.filter(
    (event) => event.magnitude.value >= HOME_FEED_MIN_MAGNITUDE,
  );

  return (
    <View style={styles.flex}>
      <EventListScreen
        events={shownEvents}
        isInitialLoading={isInitialLoading}
        isOfflineIsh={isOfflineIsh}
        isHardError={isHardError}
        isRefreshing={isRefreshing}
        dataUpdatedAt={dataUpdatedAt}
        emptyMessage={t("home.emptyState")}
        onRefetch={() => void refetch()}
        applyTopInset
        headerContent={
          <View
            style={[
              styles.header,
              { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text.primary,
                fontSize: typography.h1.fontSize,
                lineHeight: typography.h1.lineHeight,
                fontWeight: typography.h1.fontWeight,
              }}
            >
              {t("home.title")}
            </Text>
            <View style={[styles.links, { gap: spacing[3] }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/world")}
                // Vertical-only hitSlop: these three links sit side by side
                // with only spacing[3] (12px) between them, so a symmetric
                // hitSlop would let adjacent links' hit areas overlap and
                // mis-target taps — growing only top/bottom avoids that
                // while still lifting the target closer to 48dp
                // (accessibility-tester Phase 5 audit).
                hitSlop={{ top: 10, bottom: 10 }}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {t("events.viewWorld")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/significant")}
                hitSlop={{ top: 10, bottom: 10 }}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {t("events.viewSignificant")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/historical")}
                hitSlop={{ top: 10, bottom: 10 }}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {t("events.viewHistorical")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/catalog")}
                hitSlop={{ top: 10, bottom: 10 }}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {t("events.viewCatalog")}
                </Text>
              </Pressable>
            </View>
          </View>
        }
      />
      <FeltReportPill eventId={associatedEventId} event={associatedEvent} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  links: {
    flexDirection: "row",
    // Four links now share this row (World/Significant/Historical/Catalog)
    // — flexWrap is the "small overflow pattern" the wave brief allows for
    // a crowded header row, letting the row grow to a second line on
    // narrow devices or longer-translation locales (e.g. Sorani) instead
    // of clipping or squeezing hit targets below the 44dp minimum.
    flexWrap: "wrap",
  },
});
