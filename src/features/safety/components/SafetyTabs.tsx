import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import {
  SAFETY_SECTION_IDS,
  safetySectionTabKey,
  type SafetySectionId,
} from "../content";

interface SafetyTabsProps {
  activeSection: SafetySectionId;
  onSelectSection: (section: SafetySectionId) => void;
}

/**
 * PREPARE / SURVIVE / RECOVER top tab bar (spec-v1.md §4.9, MyShake
 * pattern). A boring hand-rolled segmented control (three `Pressable`s in a
 * row) rather than a native segmented-control library, per PROJECT.md's
 * "prefer boring, well-documented... the owner can't debug exotic native
 * modules". `flexDirection: "row"` mirrors automatically under
 * `I18nManager.forceRTL` (same mechanism every other row layout in this app
 * relies on — see `Tier2ScreenShell`'s top row), so no manual RTL branching
 * is needed here.
 */
export function SafetyTabs({ activeSection, onSelectSection }: SafetyTabsProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.sunken,
          borderColor: colors.border.default,
          padding: spacing[1],
          gap: spacing[1],
        },
      ]}
    >
      {SAFETY_SECTION_IDS.map((sectionId) => {
        const isActive = sectionId === activeSection;
        return (
          <Pressable
            key={sectionId}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelectSection(sectionId)}
            style={[
              styles.tab,
              {
                backgroundColor: isActive ? colors.surface.raised : "transparent",
                // spacing[3] (12), not spacing[2] (8) — the previous padding
                // measured under the 48dp touch-target floor for this
                // labelButton-sized text (design-language.md §8); these tabs
                // gate the whole PREPARE/SURVIVE/RECOVER safety content, so
                // they get the same floor as every other primary control.
                paddingVertical: spacing[3],
              },
            ]}
          >
            <Text
              style={{
                textAlign: "center",
                color: isActive ? colors.text.primary : colors.text.secondary,
                fontSize: typography.labelButton.fontSize,
                fontWeight: isActive ? "700" : "500",
              }}
            >
              {t(safetySectionTabKey(sectionId))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: "center",
  },
});
