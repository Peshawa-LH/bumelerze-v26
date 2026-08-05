import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { EventListScreen, useRegionEvents } from "@/features/events";
import { useTheme } from "@/theme";

/**
 * Home / region-first feed (spec-v1.md §4.1) — the default landing screen,
 * cached-first. Header row links to World Catalog and Significant Events
 * (pushed routes, not tabs — D11 region-first inversion).
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

  return (
    <EventListScreen
      events={events}
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
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  links: {
    flexDirection: "row",
  },
});
