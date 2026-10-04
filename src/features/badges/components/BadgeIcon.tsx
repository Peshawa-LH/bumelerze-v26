import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

import type { BadgeTone, IconName } from "../catalog";
import { badgePalette } from "../tones";

interface BadgeIconProps {
  /** Glyph drawn when earned (solid) or locked (outline). */
  glyph: IconName;
  /** Round image drawn instead of the glyph when earned (official). */
  image?: number | null;
  tone: BadgeTone;
  earned: boolean;
  size: number;
  testID?: string;
}

/**
 * One badge circle. Earned = tinted fill + 2 px ring + solid glyph; locked =
 * grey fill + outline glyph + a lock dot at the bottom-end corner, so the
 * state never rests on colour alone. Decorative: the surrounding control
 * carries the spoken label.
 */
export function BadgeIcon({
  glyph,
  image = null,
  tone,
  earned,
  size,
  testID,
}: BadgeIconProps) {
  const { colors, scheme } = useTheme();
  const palette = badgePalette(tone, earned, colors, scheme);
  const lockSize = Math.max(18, Math.round(size * 0.34));
  const showImage = earned && image !== null;

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: palette.fill,
            borderColor: palette.ring ?? "transparent",
            borderWidth: palette.ring ? 2 : 0,
          },
        ]}
      >
        {showImage ? (
          <Image
            source={image}
            contentFit="contain"
            style={{ width: size * 0.64, height: size * 0.64 }}
            testID="badge-icon-image"
          />
        ) : (
          <Ionicons name={glyph} size={Math.round(size * 0.5)} color={palette.glyph} />
        )}
      </View>
      {earned ? null : (
        <View
          testID="badge-lock"
          style={[
            styles.lock,
            {
              width: lockSize,
              height: lockSize,
              borderRadius: lockSize / 2,
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
            },
          ]}
        >
          <Ionicons
            name="lock-closed"
            size={Math.round(lockSize * 0.6)}
            color={colors.text.secondary}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  lock: {
    position: "absolute",
    bottom: -2,
    end: -2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
