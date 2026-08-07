import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SAFETY_SECTIONS,
  SafetyCard,
  SafetyTabs,
  type SafetySectionId,
} from "@/features/safety";
import { useTheme } from "@/theme";

/**
 * Safety content — spec-v1.md §4.9 (D11 "full feature"): PREPARE / SURVIVE /
 * RECOVER tri-tab, always reachable from the tab bar with zero dependency on
 * any event existing, fully static/bundled so it renders offline by
 * construction (no query, no loading/error state — this screen only has one
 * state: rendered). Sits directly in the tab navigator (headerShown: false,
 * like Home), so it owns its own top safe-area padding.
 */
export default function SafetyScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeSection, setActiveSection] = useState<SafetySectionId>("prepare");

  const section = SAFETY_SECTIONS.find((candidate) => candidate.id === activeSection);
  const cards = section?.cards ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.surface.base }]}>
      <View
        style={{
          paddingTop: insets.top + spacing[4],
          paddingStart: spacing[4],
          paddingEnd: spacing[4],
          paddingBottom: spacing[3],
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
            marginBottom: spacing[3],
          }}
        >
          {t("safety.title")}
        </Text>
        <SafetyTabs activeSection={activeSection} onSelectSection={setActiveSection} />
      </View>

      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        // The content is a small, fixed, compile-time list per section
        // (~5 cards) — render it all up front, same reasoning as
        // historical.tsx, so nothing pops in on scroll.
        initialNumToRender={cards.length}
        renderItem={({ item }) => <SafetyCard card={item} />}
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
