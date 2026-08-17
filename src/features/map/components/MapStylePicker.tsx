import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import {
  DEFAULT_MAP_STYLE_CATALOG_ID,
  MAP_STYLE_CATALOG_IDS,
  MAP_STYLE_LABEL_KEYS,
  type MapStyleCatalogId,
} from "../style-catalog";
import { MapControlIconButton } from "./MapControlIconButton";

interface MapStylePickerProps {
  value: MapStyleCatalogId;
  onChange: (styleId: MapStyleCatalogId) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** See `MapFilterPanel`'s identically-named prop — same compact-icon/
   * floating-popover treatment for the phone-width default. */
  compact?: boolean;
}

/**
 * Collapsible basemap style picker (update-plan-2026-08.md §4.3/Part 3) —
 * shipped VISIBLE to every user (not dev-gated). Same collapsible-header
 * shape as `safety/components/AccessibilityDisclosure.tsx` (chevron toggle,
 * collapsed by default so it never competes with the map for space), body
 * is a `radiogroup` of style chips rather than a dropdown/native `<select>`
 * — chips keep every option one tap away (panic-time/one-handed
 * discoverability) and stay fully themeable/RTL-correct, unlike a native
 * select element.
 */
export function MapStylePicker({
  value,
  onChange,
  expanded,
  onToggleExpanded,
  compact = false,
}: MapStylePickerProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const isNonDefaultStyle = value !== DEFAULT_MAP_STYLE_CATALOG_ID;
  // Same base-hint-plus-current-value composition as `MapFilterPanel`'s
  // `collapsedIconA11yLabel` — see that component's doc comment.
  const collapsedIconA11yLabel = isNonDefaultStyle
    ? [t("map.style.expandA11yHint"), t(MAP_STYLE_LABEL_KEYS[value])].join(". ")
    : t("map.style.expandA11yHint");

  if (compact && !expanded) {
    return (
      <MapControlIconButton
        icon="layers-outline"
        isActive={isNonDefaultStyle}
        accessibilityLabel={collapsedIconA11yLabel}
        onPress={onToggleExpanded}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
        compact && [styles.popover, { marginTop: spacing[2] }],
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(
          expanded ? "map.style.collapseA11yHint" : "map.style.expandA11yHint",
        )}
        onPress={onToggleExpanded}
        hitSlop={6}
        style={[styles.header, { padding: spacing[2], gap: spacing[2] }]}
      >
        <Ionicons name="layers-outline" size={16} color={colors.text.primary} />
        <Text
          allowFontScaling
          style={{
            flexShrink: 1,
            color: colors.text.primary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
            fontWeight: "600",
          }}
        >
          {t(MAP_STYLE_LABEL_KEYS[value])}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.text.secondary}
        />
      </Pressable>

      {expanded ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("map.style.title")}
          style={[styles.chipRow, { padding: spacing[2], gap: spacing[2] }]}
        >
          {MAP_STYLE_CATALOG_IDS.map((styleId) => {
            const isActive = styleId === value;
            return (
              <Pressable
                key={styleId}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive, checked: isActive }}
                onPress={() => onChange(styleId)}
                hitSlop={6}
                style={[
                  styles.chip,
                  {
                    borderColor: isActive ? colors.brand.primary : colors.border.default,
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
                    fontSize: typography.labelCaption.fontSize,
                    lineHeight: typography.labelCaption.lineHeight,
                    fontWeight: isActive ? "700" : "500",
                  }}
                >
                  {t(MAP_STYLE_LABEL_KEYS[styleId])}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    maxWidth: 260,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    minHeight: 36,
    justifyContent: "center",
  },
  // See `MapFilterPanel.tsx`'s identically-named/-reasoned style.
  popover: {
    position: "absolute",
    top: "100%",
    end: 0,
    zIndex: 30,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
