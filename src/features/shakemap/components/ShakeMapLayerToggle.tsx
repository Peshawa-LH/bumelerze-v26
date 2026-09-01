import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import type { Theme } from "@/theme";
import type { ShakeMapLayer } from "./ShakeMapLegend";

export interface ShakeMapLayerToggleProps {
  /** Only rendered at all when `true` — no real damage product means
   * there is nothing to toggle to (`ShakeMapView`/`.web`'s own
   * `hasDamageLayer` doc comment). */
  hasDamageLayer: boolean;
  activeLayer: ShakeMapLayer;
  onChange: (layer: ShakeMapLayer) => void;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/**
 * The Intensity/Damage segmented toggle shown above the map — factored out
 * of `ShakeMapViewSvg.tsx` (web-map wave) so `ShakeMapView.web.tsx` gets
 * the identical control (same copy, same `testID`s, same a11y roles)
 * without a second hand-maintained copy. Purely presentational: the
 * caller owns the actual `layer` state and decides what switching it does
 * to the map underneath (an SVG re-render for the native/SVG view, a
 * MapLibre `setLayoutProperty("visibility", ...)` pair for the web view).
 */
export function ShakeMapLayerToggle({
  hasDamageLayer,
  activeLayer,
  onChange,
  t,
  colors,
  typography,
  spacing,
}: ShakeMapLayerToggleProps) {
  if (!hasDamageLayer) {
    return null;
  }

  return (
    <View style={[styles.layerToggleRow, { gap: spacing[1] }]} accessibilityRole="tablist">
      {(["intensity", "damage"] as const).map((option) => {
        const selected = activeLayer === option;
        return (
          <Pressable
            key={option}
            testID={`shakemap-layer-toggle-${option}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            hitSlop={8}
            style={[
              styles.layerToggleOption,
              {
                backgroundColor: selected ? colors.brand.primary : colors.surface.sunken,
                borderRadius: 8,
                paddingVertical: spacing[1],
                paddingHorizontal: spacing[3],
              },
            ]}
          >
            <Text
              style={{
                color: selected ? colors.brand.onPrimary : colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                lineHeight: typography.labelCaption.lineHeight,
                fontWeight: "600",
              }}
            >
              {t(`eventDetail.shakemap.layer.${option}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layerToggleRow: {
    flexDirection: "row",
    alignSelf: "flex-start",
  },
  layerToggleOption: {
    alignItems: "center",
  },
});
