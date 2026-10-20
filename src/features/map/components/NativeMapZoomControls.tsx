import Ionicons from "@expo/vector-icons/Ionicons";
import { I18nManager, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

interface NativeMapZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const BUTTON_PT = 44;

/**
 * Zoom in/out for the small embedded maps (SHAKEmap, pin map, coordinate
 * picker): the web gives them MapLibre's zoom buttons, 44 px since review
 * A-9. Pinch works too; the buttons are for one hand and for VoiceOver.
 * Top right on every language, like the web's control: it belongs to the
 * map, which never mirrors.
 */
export function NativeMapZoomControls({
  onZoomIn,
  onZoomOut,
}: NativeMapZoomControlsProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const button = (icon: "add" | "remove", label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.button}
    >
      <Ionicons name={icon} size={22} color={colors.text.primary} />
    </Pressable>
  );
  return (
    <View
      style={[
        styles.group,
        // Physical right in every language: React Native swaps left/right
        // and start/end under a right-to-left layout, so "start" is the
        // right edge there.
        I18nManager.isRTL ? styles.physicalRightRtl : styles.physicalRightLtr,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      {button("add", t("map.controls.zoomIn"), onZoomIn)}
      <View style={[styles.divider, { backgroundColor: colors.border.default }]} />
      {button("remove", t("map.controls.zoomOut"), onZoomOut)}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    position: "absolute",
    top: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  physicalRightLtr: { end: 8 },
  physicalRightRtl: { start: 8 },
  button: {
    width: BUTTON_PT,
    height: BUTTON_PT,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
