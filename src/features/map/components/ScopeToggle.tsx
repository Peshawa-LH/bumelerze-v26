import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { MAP_SCOPES, type MapScope } from "../scope";

interface ScopeToggleProps {
  value: MapScope;
  onChange: (scope: MapScope) => void;
}

const SCOPE_LABEL_KEYS: Record<MapScope, string> = {
  kurdistan: "map.scope.kurdistan",
  world: "map.scope.world",
};

/**
 * Two-option Kurdistan/World segmented control (update-plan-2026-08.md §4.1)
 * — a pill-shaped `radiogroup`, matching `TierSelector`'s established "pick
 * one of N" pattern for touch-target sizing and RTL correctness (no left/
 * right, `flexDirection: "row"` auto-mirrors under RTL — no manual
 * row-reverse needed). Deliberately compact (unlike `TierSelector`'s
 * full-width stacked rows) — only two short options, and this control has
 * to share the map's top overlay with the filter/style toggles, so it stays
 * a single-row pill rather than claiming a full row of its own.
 */
export function ScopeToggle({ value, onChange }: ScopeToggleProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("map.scope.a11yLabel")}
      style={[
        styles.container,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
      ]}
    >
      {MAP_SCOPES.map((scope) => {
        const isActive = scope === value;
        return (
          <Pressable
            key={scope}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive, checked: isActive }}
            onPress={() => onChange(scope)}
            hitSlop={6}
            style={[
              styles.segment,
              {
                backgroundColor: isActive ? colors.brand.primary : "transparent",
                paddingVertical: spacing[2],
                paddingHorizontal: spacing[3],
              },
            ]}
          >
            <Text
              allowFontScaling
              style={{
                color: isActive ? colors.brand.onPrimary : colors.text.primary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                fontWeight: isActive ? "700" : "500",
              }}
            >
              {t(SCOPE_LABEL_KEYS[scope])}
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
    borderWidth: 1,
    borderRadius: 999,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  segment: {
    minHeight: 44,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
});
