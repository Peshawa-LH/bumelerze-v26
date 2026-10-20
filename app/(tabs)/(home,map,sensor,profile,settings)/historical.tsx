import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import {
  HistoricalEventRow,
  NOTABLE_HISTORICAL_EVENTS,
  sortNewestFirst,
  type NotableHistoricalEvent,
} from "@/features/historical";
import { isRTLLocale, physicalTextAlign } from "@/i18n";
import { useTheme, nativeFontFamily } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * Historical View (lite) — the v1 spec §4.7: "earthquakes here since 1900"
 * context from a bundled, hand-curated list, not a live fetch. Fully
 * offline-tolerant by construction — the list itself is a compile-time
 * constant, so this screen never shows a loading/error/empty state; only
 * the destination (`/event/[id]`) needs connectivity, same as any other
 * deep link into Event Detail.
 */
export default function HistoricalScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isRTL = isRTLLocale(i18n.language);

  const events = sortNewestFirst(NOTABLE_HISTORICAL_EVENTS);

  // Bumelerze identity, not the provider's (owner directive 2026-09-02:
  // "we cannot replicate [USGS's] id or event names") — every one of these
  // 11 curated events already carries a verified `bumelerzeId`
  // (`notable-events.ts`), so navigation always has one to push; `event.id`
  // (the USGS ComCat id) stays Event Detail's own cold-start fallback key,
  // never the URL.
  function handlePress(event: NotableHistoricalEvent) {
    router.push(`/event/${event.bumelerzeId}`);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t("historical.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.surface.base }]}>
        <FlatList
          {...tabBarScroll}
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
            // Owner: "we don't remove the catalog, instead in order to
            // access catalog you go through Historical" — since Home's own
            // header link row dropped its direct Catalog link, this row is
            // now the ONLY in-app path to `/catalog` (regional-catalog
            // wave's original entry point 2/2, the other having been
            // removed). A trailing chevron (mirrored for RTL below) plus
            // start-aligned text reads as a real navigation destination
            // rather than a plain button, matching the owner's ask for a
            // clearer affordance now that it's carrying more weight. A plain
            // `row`: the layout already runs right to left in Sorani and
            // Arabic (the page's `dir` on the web, the native layout on the
            // phone), so the text sits at the right and the chevron at the
            // end, the left. `row-reverse` picked by locale flipped it back
            // and put the chevron first, on both.
            <Pressable
              accessibilityRole="button"
              testID="historical-catalog-link"
              onPress={() => router.push("/catalog")}
              style={[
                styles.catalogLink,
                {
                  borderColor: colors.border.default,
                  padding: spacing[4],
                  flexDirection: "row",
                },
              ]}
            >
              <Text
                style={{
                  flex: 1,
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontFamily: nativeFontFamily(typography.labelButton),
                  fontWeight: typography.labelButton.fontWeight,
                  textAlign: physicalTextAlign(isRTL ? "right" : "left"),
                }}
              >
                {t("historical.catalogLink")}
              </Text>
              <Ionicons
                testID="historical-catalog-link-chevron"
                name={isRTL ? "chevron-back" : "chevron-forward"}
                size={20}
                color={colors.text.link}
              />
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
    justifyContent: "space-between",
    gap: 8,
  },
});
