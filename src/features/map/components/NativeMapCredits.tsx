import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { MapStyleProviderId } from "../style-provider";
import { MapTilerAttributionLogo } from "./MapTilerAttributionLogo";

/** Inset of the credits button and the logo from the map's corners. */
export const NATIVE_MAP_ORNAMENT_INSET_PT = 8;
/** The credits button: a full 44 pt touch target. */
const CREDITS_BUTTON_PT = 44;

interface NativeMapCreditsProps {
  provider: MapStyleProviderId;
  /** Opens MapLibre's credits panel (`MapRef.showAttribution`). */
  onShowCredits: () => void;
  /** Extra room under both ornaments (a footer drawn over the map). */
  bottomInset?: number;
}

/**
 * The credits every native map shows, as on the web: a 44 pt (i) at the
 * reading start that opens MapLibre's credits panel (OpenStreetMap,
 * MapTiler, the hillshade and label sources), and MapTiler's logo at the
 * reading end while a MapTiler style is on screen (their terms; never for
 * OpenFreeMap). MapLibre's own 26 pt (i) is turned off by the caller: it
 * follows the PHONE's direction, so in Sorani picked on an English phone
 * it sat under the logo.
 */
export function NativeMapCredits({
  provider,
  onShowCredits,
  bottomInset = 0,
}: NativeMapCreditsProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bottom = NATIVE_MAP_ORNAMENT_INSET_PT + bottomInset;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("map.attribution.creditsA11yLabel")}
        onPress={onShowCredits}
        style={[
          styles.creditsButton,
          {
            bottom,
            backgroundColor: colors.surface.base,
            borderColor: colors.border.default,
          },
        ]}
      >
        <Ionicons
          name="information-circle-outline"
          size={24}
          color={colors.text.secondary}
        />
      </Pressable>
      {provider === "maptiler" ? (
        <View style={[styles.logo, { bottom }]} pointerEvents="box-none">
          <MapTilerAttributionLogo />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  creditsButton: {
    position: "absolute",
    start: NATIVE_MAP_ORNAMENT_INSET_PT,
    width: CREDITS_BUTTON_PT,
    height: CREDITS_BUTTON_PT,
    borderRadius: CREDITS_BUTTON_PT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    position: "absolute",
    end: NATIVE_MAP_ORNAMENT_INSET_PT,
  },
});
