import { useRouter } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import {
  AccessibilityInfo,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily } from "@/theme";
import { useEventSourceAgencies } from "../source-corroboration";
import type { Event } from "../types";
import { EventCard } from "./EventCard";
import { OfflineBanner } from "./OfflineBanner";
import { useTabBarScroll } from "@/features/tab-bar";

interface EventListScreenProps {
  events: Event[];
  isInitialLoading: boolean;
  isOfflineIsh: boolean;
  isHardError: boolean;
  isRefreshing: boolean;
  dataUpdatedAt: number;
  emptyMessage: string;
  onRefetch: () => void;
  /** Home renders its title row and the World/Significant/Historical links
   * above the list; pushed screens (World, Significant) pass nothing — their
   * native Stack header already carries the title. Stays put while the
   * list scrolls, so keep it to one row. */
  headerContent?: ReactNode;
  /** Scrolls WITH the list (rendered as the list's own header): Home's
   * "Be ready" card, the "Are you safe?" banner and the possible-event
   * cards. Review A-19: kept fixed, these held about a quarter of a phone's
   * height while the feed scrolled underneath. Content here is expected to
   * carry its own horizontal padding, like a card; the list cancels its
   * content inset around it so the two line up. */
  listHeaderContent?: ReactNode;
  /** Home sits inside the tab navigator with `headerShown: false`, so it
   * needs its own top safe-area padding; pushed screens get that from the
   * native header and should leave this `false` (default). */
  applyTopInset?: boolean;
  /** ids of events present in `events` only because of the adaptive
   * Home-feed policy's magnitude-tiered notable carve-out
   * (`home-feed-policy.ts`) — passed through to `EventCard` so it can show
   * a "notable" cue instead of reading as a confusing, out-of-place-old
   * card. Home is the only caller that ever passes this; World/Significant
   * default to an empty set. */
  notableEventIds?: ReadonlySet<string>;
  /** Extra bottom padding so the last card can scroll clear of a floating
   * control the host renders over the list (Home's felt pill). */
  bottomClearance?: number;
}

const SKELETON_ROW_COUNT = 5;

/**
 * Shared list rendering used by Home (region feed), World Catalog, and
 * Significant Events (brief point 3: "pushed routes reusing the same
 * list component"). FlatList, not FlashList — boring choice, deliberate:
 * these lists run in the low hundreds of rows at most (30-day regional
 * window / weekly M4.5+ world window), well under where FlashList's extra
 * setup earns its keep (the project's TypeScript conventions' FlashList guidance is
 * aimed at large/likely-growing feeds; revisit if list sizes grow).
 */
export function EventListScreen({
  events,
  isInitialLoading,
  isOfflineIsh,
  isHardError,
  isRefreshing,
  dataUpdatedAt,
  emptyMessage,
  onRefetch,
  headerContent,
  listHeaderContent,
  applyTopInset = false,
  notableEventIds,
  bottomClearance = 0,
}: EventListScreenProps) {
  const tabBarScroll = useTabBarScroll();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Relative-time math only needs a roughly-current instant (re-renders on
  // every fetch/pull-to-refresh keep it fresh) — no live ticking clock in
  // Phase 1 (boring choice, brief). The react-hooks/purity rule flags
  // any `Date.now()` read during render on principle (it's aimed at making
  // components safe for the React Compiler's memoization); this read is
  // intentionally non-memoized so it never goes stale across re-renders.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const now = Date.now();

  // Batched corroboration lookup for the WHOLE on-screen list, one call
  // here rather than one per `EventCard` (owner brief: "batched, not one
  // request per card"). Degrades to an empty map (every card falls back to
  // its own provider chip) when Supabase is unreachable or an event isn't
  // in the registry yet — never a loading state of its own, never blocks
  // this list's own render.
  const sourceAgenciesByEventId = useEventSourceAgencies(events);

  // iOS VoiceOver companion to `OfflineBanner`'s `accessibilityLiveRegion`
  // (Android-only) — announces the offline/stale-data state on the
  // false->true transition so it isn't silently visual-only on iOS
  // (Phase 5 accessibility audit). Guarded to fire once per
  // "went offline" event, not on every re-render while still offline.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (isOfflineIsh && !wasOfflineRef.current) {
      AccessibilityInfo.announceForAccessibility(t("events.offlineAnnouncement"));
    }
    wasOfflineRef.current = isOfflineIsh;
  }, [isOfflineIsh, t]);

  // Review E-10: a screen-reader user on the two-minute poll had no cue when
  // a refresh brought new earthquakes (only the offline state was spoken).
  // After every COMPLETED fetch (`dataUpdatedAt` moves only then) the ids are
  // compared with the previous list and the number of newcomers announced.
  // The first population and a later arrival of the notable-tail pool (which
  // changes `events` without a new `dataUpdatedAt`, and is old news by
  // definition) only update the remembered ids.
  const seenIdsRef = useRef<ReadonlySet<string> | null>(null);
  const announcedAtRef = useRef(dataUpdatedAt);
  useEffect(() => {
    const ids = new Set(events.map((event) => event.id));
    const previous = seenIdsRef.current;
    seenIdsRef.current = ids;
    if (previous === null || previous.size === 0 || dataUpdatedAt === announcedAtRef.current) {
      return;
    }
    announcedAtRef.current = dataUpdatedAt;
    let added = 0;
    for (const id of ids) {
      if (!previous.has(id)) {
        added += 1;
      }
    }
    if (added > 0) {
      AccessibilityInfo.announceForAccessibility(
        t("events.newEventsAnnouncement", {
          count: added,
          number: localizeDigits(String(added), i18n.language),
        }),
      );
    }
  }, [events, dataUpdatedAt, t, i18n.language]);

  const containerStyle = [
    styles.container,
    {
      backgroundColor: colors.surface.base,
      paddingTop: applyTopInset ? insets.top + spacing[4] : 0,
    },
  ];

  if (isHardError) {
    return (
      <View style={containerStyle}>
        {headerContent}
        {listHeaderContent}
        <View style={styles.centered}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text.primary,
              fontSize: typography.h3.fontSize,
              fontFamily: nativeFontFamily(typography.h3),
              lineHeight: typography.h3.lineHeight,
              fontWeight: typography.h3.fontWeight,
              textAlign: "center",
              marginBottom: spacing[3],
            }}
          >
            {t("events.errorTitle")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRefetch}
            style={[
              styles.retryButton,
              {
                backgroundColor: colors.brand.primary,
                paddingHorizontal: spacing[5],
                paddingVertical: spacing[3],
              },
            ]}
          >
            <Text
              style={{
                color: colors.brand.onPrimary,
                fontSize: typography.labelButton.fontSize,
                fontFamily: nativeFontFamily(typography.labelButton),
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("events.retry")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (isInitialLoading) {
    return (
      <View style={containerStyle}>
        {headerContent}
        {listHeaderContent}
        <View style={{ padding: spacing[4], gap: spacing[3] }}>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
            <View
              // Static placeholder rows, never reordered — index key is safe.
              key={index}
              style={{
                height: 96,
                borderRadius: 12,
                backgroundColor: colors.surface.sunken,
              }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      {headerContent}
      {isOfflineIsh ? <OfflineBanner dataUpdatedAt={dataUpdatedAt} /> : null}
      <FlatList
        {...tabBarScroll}
        testID="event-list"
        data={events}
        keyExtractor={(event) => event.id}
        ListHeaderComponent={listHeaderContent ? <>{listHeaderContent}</> : null}
        // The header's cards bring their own side padding (`BeReadyCard`,
        // `PossibleEventCard`'s wrapper); pull the header back out of this
        // list's content inset so they line up with the event cards below,
        // and up to where the fixed `headerContent` ends.
        ListHeaderComponentStyle={{
          marginHorizontal: -spacing[4],
          marginTop: -spacing[4],
        }}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            now={now}
            // Bumelerze identity first, the provider id only as a fallback
            // (owner directive 2026-09-02) — most feed events don't carry
            // a `bumelerzeId` yet (`types.ts`'s own doc comment), so this
            // still commonly pushes the provider id today; Event Detail's
            // own redirect (`app/(tabs)/(home,map,sensor,profile,settings)/event/[id].tsx`) closes that gap the
            // moment one resolves, without this list needing to wait for it.
            onPress={(event) => router.push(`/event/${event.bumelerzeId ?? event.id}`)}
            isNotable={notableEventIds?.has(item.id) ?? false}
            sourceAgencies={sourceAgenciesByEventId.get(item.id)?.agencies}
            hasShakemap={sourceAgenciesByEventId.get(item.id)?.hasShakemap ?? false}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          {
            padding: spacing[4],
            gap: spacing[3],
            paddingBottom: insets.bottom + spacing[6] + bottomClearance,
            flexGrow: 1,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefetch}
            tintColor={colors.brand.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                fontFamily: nativeFontFamily(typography.bodyDefault),
                lineHeight: typography.bodyDefault.lineHeight,
                textAlign: "center",
              }}
            >
              {emptyMessage}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  retryButton: {
    borderRadius: 10,
  },
  listContent: {
    flexGrow: 1,
  },
});
