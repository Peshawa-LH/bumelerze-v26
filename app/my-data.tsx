import { Stack, useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ContributionRow,
  IdentityHeader,
  buildContributionRow,
} from "@/features/mydata";
import {
  sortQueueItemsNewestFirst,
  useFeltQueueHasHydrated,
  useFeltQueueItems,
} from "@/features/felt";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/**
 * My Data (D26 item 7: "a MyShake-style personal view shows the user's own
 * reports and contributions", per the internal design reference (MyShake
 * IMG_3480.PNG`). Reached only from the new Settings row this wave.
 *
 * Data source is exclusively the LOCAL felt-report queue
 * (`features/felt/queue.ts`) — every report this device has ever submitted
 * is already durably there by construction (the offline-first queue's own
 * whole reason to exist), so this screen needs no network fetch of any
 * kind to be complete and correct, and works fully offline like every other
 * screen in the app. See `supabase/migrations/0015_felt_reports_select_own.sql`
 * for the (now-correct, not-yet-exercised) server-side RLS predicate a
 * future multi-device sync wave would read through instead.
 */
export default function MyDataScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const hasHydrated = useFeltQueueHasHydrated();
  const items = useFeltQueueItems();
  // Sorting/mapping happen here (the calling component), not inside the
  // zustand selector — see `useFeltQueueItems`'s own doc comment for the
  // infinite-render-loop this avoids. `useMemo` keeps both derivations from
  // re-running on every unrelated render (locale switches, theme, etc.).
  const rows = useMemo(
    () => sortQueueItemsNewestFirst(items).map((item) => buildContributionRow(item, locale, t)),
    [items, locale, t],
  );
  const countText = localizeDigits(String(rows.length), locale);

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen options={{ title: t("myData.title") }} />
      <FlatList
        data={hasHydrated ? rows : []}
        keyExtractor={(row) => row.reportId}
        renderItem={({ item }) => <ContributionRow row={item} />}
        ListHeaderComponent={
          <View style={{ gap: spacing[3] }}>
            <IdentityHeader />
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text.primary,
                fontSize: typography.h3.fontSize,
                lineHeight: typography.h3.lineHeight,
                fontWeight: typography.h3.fontWeight,
              }}
            >
              {t("myData.summaryTitle", { count: countText })}
            </Text>
          </View>
        }
        ListEmptyComponent={
          hasHydrated ? (
            <View style={[styles.emptyState, { gap: spacing[3] }]}>
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.bodyDefault.fontSize,
                  lineHeight: typography.bodyDefault.lineHeight,
                  textAlign: "center",
                }}
              >
                {t("myData.emptyStateMessage")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/felt-report")}
                style={[
                  styles.emptyStateButton,
                  { backgroundColor: colors.brand.primary, paddingVertical: spacing[3] },
                ]}
              >
                <Text
                  style={{
                    color: colors.brand.onPrimary,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {t("myData.emptyStateCta")}
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={{
          gap: spacing[3],
          paddingHorizontal: spacing[4],
          paddingTop: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
          flexGrow: 1,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  emptyState: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  emptyStateButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 24,
  },
});
