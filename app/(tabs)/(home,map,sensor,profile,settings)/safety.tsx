import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { usePrefsStore } from "@/features/onboarding";
import {
  SAFETY_SECTIONS,
  SafetyCard,
  SafetyTabs,
  UsingAppSection,
  type SafetySectionId,
} from "@/features/safety";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * Safety guide — spec-v1.md §4.9 (D11 "full feature"): PREPARE / SURVIVE /
 * RECOVER tri-tab with zero dependency on any event existing, fully
 * static/bundled so it renders offline by construction (no query, no
 * loading/error state — this screen only has one state: rendered). Since
 * D79 (2026-10-08) it is a pushed stack screen opened from Settings -> Safety
 * guide and the Home "Be ready" card, not a tab; the URL `/safety` is the
 * same as before, so old links keep working. The stack header carries the
 * title and the back button. Opening it once retires the Home card.
 */
export default function SafetyScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const hideBeReady = usePrefsStore((state) => state.hideBeReady);
  const [activeSection, setActiveSection] = useState<SafetySectionId>("prepare");

  const section = SAFETY_SECTIONS.find((candidate) => candidate.id === activeSection);
  const cards = section?.cards ?? [];

  // Having opened the guide once, the reader no longer needs the nudge.
  useEffect(() => {
    hideBeReady();
  }, [hideBeReady]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("safety.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <View
        style={{
          paddingTop: spacing[3],
          paddingStart: spacing[4],
          paddingEnd: spacing[4],
          paddingBottom: spacing[3],
        }}
      >
        <SafetyTabs activeSection={activeSection} onSelectSection={setActiveSection} />
      </View>

      <FlatList
        {...tabBarScroll}
        data={cards}
        keyExtractor={(card) => card.id}
        // The content is a small, fixed, compile-time list per section
        // (~5 cards) — render it all up front, same reasoning as
        // historical.tsx, so nothing pops in on scroll.
        initialNumToRender={cards.length}
        renderItem={({ item }) => <SafetyCard card={item} />}
        // "Using Bumelerze" is a quiet secondary section under the Prepare
        // guides; the Survive and Recover tabs stay purely panic-time content.
        ListFooterComponent={activeSection === "prepare" ? <UsingAppSection /> : null}
        contentContainerStyle={{
          paddingHorizontal: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
          gap: spacing[3],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
