import { Image } from "expo-image";
import { Linking, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import {
  MAPTILER_LOGO_HEIGHT_PX,
  MAPTILER_LOGO_LINK_URL,
  MAPTILER_LOGO_URL,
  MAPTILER_LOGO_WIDTH_PX,
} from "../attribution";

/**
 * MapTiler's required logo-attribution mark (update-plan-2026-08.md Part 4)
 * — rendered ONLY while a MapTiler style is the active basemap (the caller,
 * `map.web.tsx`, gates this on the tracked active provider; OpenFreeMap
 * carries no such requirement and must never show this). See
 * `attribution.ts`'s doc comment for where the logo asset URL/link target
 * come from — MapTiler's own published SDK, not a fabricated asset.
 *
 * Positioned by the caller (absolute overlay, opposite corner from
 * MapLibre's own `AttributionControl` text so the two never overlap) —
 * this component only owns the tappable logo mark itself.
 */
export function MapTilerAttributionLogo() {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("map.attribution.maptilerLogoA11yLabel")}
      onPress={() => {
        Linking.openURL(MAPTILER_LOGO_LINK_URL).catch(() => {
          // Swallowed: a failed `Linking.openURL` (no browser handler
          // available, offline) shouldn't crash the map — the attribution
          // mark itself still renders correctly either way.
        });
      }}
      style={styles.pressable}
    >
      <Image
        source={{ uri: MAPTILER_LOGO_URL }}
        contentFit="contain"
        style={styles.logo}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: MAPTILER_LOGO_WIDTH_PX,
    height: MAPTILER_LOGO_HEIGHT_PX,
  },
  logo: {
    width: MAPTILER_LOGO_WIDTH_PX,
    height: MAPTILER_LOGO_HEIGHT_PX,
  },
});
