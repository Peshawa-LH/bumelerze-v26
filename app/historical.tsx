import { Stack, useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  HistoricalEventRow,
  NOTABLE_HISTORICAL_EVENTS,
  sortNewestFirst,
  type NotableHistoricalEvent,
} from "@/features/historical";
import { useTheme } from "@/theme";

/**
 * Historical View (lite) — spec-v1.md §4.7: "earthquakes here since 1900"
 * context from a bundled, hand-curated list, not a live fetch. Fully
 * offline-tolerant by construction — the list itself is a compile-time
 * constant, so this screen never shows a loading/error/empty state; only
 * the destination (`/event/[id]`) needs connectivity, same as any other
 * deep link into Event Detail.
 */
export default function HistoricalScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const events = sortNewestFirst(NOTABLE_HISTORICAL_EVENTS);

  function handlePress(event: NotableHistoricalEvent) {
    router.push(`/event/${event.id}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: t("historical.title") }} />
      <View style={[styles.container, { backgroundColor: colors.surface.base }]}>
        <FlatList
          data={events}
          keyExtractor={(event) => event.id}
          // The curated bundle is small (~10 rows) and fixed at build time —
          // render it all up front rather than relying on FlatList's default
          // windowing, so every row (including the last) is guaranteed on
          // screen immediately with no scroll-triggered pop-in.
          initialNumToRender={events.length}
          renderItem={({ item }) => (
            <HistoricalEventRow event={item} onPress={handlePress} />
          )}
          ListFooterComponent={
            // regional-catalog wave entry point 2/2 (the other is Home's
            // header link row) — this curated ~10-event list is "since
            // 1900" context (spec-v1.md §4.7); the full bundled/offline
            // catalog (872-2023, thousands of events, filterable) lives one
            // tap away for anyone who wants more than the hand-picked set.
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/catalog")}
              style={[
                styles.catalogLink,
                { borderColor: colors.border.default, padding: spacing[4] },
              ]}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                  textAlign: "center",
                }}
              >
                {t("historical.catalogLink")}
              </Text>
            </Pressable>
          }
          contentContainerStyle={{
            padding: spacing[4],
            gap: spacing[3],
            paddingBottom: insets.bottom + spacing[6],
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  catalogLink: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
