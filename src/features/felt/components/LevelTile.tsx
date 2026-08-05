import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import type { CartoonLevel } from "../types";

interface LevelTileProps {
  level: CartoonLevel;
  label: string;
  locale: string;
  onPress: (level: CartoonLevel) => void;
  /**
   * AI-generated cartoon artwork slot (felt-report-science-v1.md PART 1 —
   * the `visual-asset-generator` pass, per D8's "redrawn for our context").
   * Always undefined this wave — the tile renders a plain intensity-ramp
   * color swatch instead, so the artwork can drop in later with no layout
   * change.
   *
   * Deliberately NOT typed against `expo-image`'s `ImageSource` yet: as of
   * this wave, `expo-image@57.0.2` crashes on import under this project's
   * `jest-expo@57.0.3` (`observe.getIntegrations is not a function`,
   * reproduced with a bare `import { Image } from "expo-image"` in a test
   * file — an expo-observe native-module mismatch, unrelated to this
   * component). Since there is no real artwork to render this wave either,
   * pulling in `expo-image` now would only trade a real feature for a
   * broken test suite. Swap this prop to `expo-image`'s `ImageSource` and
   * render an `<Image>` here once (a) real cartoons exist and (b) that
   * incompatibility is resolved (likely a `jest-expo`/`expo-image` version
   * bump — check the CHANGELOG before assuming it needs a custom mock).
   */
  imageSource?: unknown;
  /** Science pack §1.2: levels 10-12 render in the "severe destruction"
   * sub-group, slightly more compact than 1-9 — still fully selectable. */
  compact?: boolean;
}

function LevelTileImpl({
  level,
  label,
  locale,
  onPress,
  compact = false,
}: LevelTileProps) {
  const { colors, typography, spacing } = useTheme();
  const accentColor = colors.intensity[level];
  const onAccentColor = colors.intensityOnFill[level];
  const numeralText = localizeDigits(String(level), locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${numeralText}. ${label}`}
      onPress={() => onPress(level)}
      style={({ pressed }) => [
        styles.tile,
        compact && styles.tileCompact,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[2],
          gap: spacing[1],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.swatch,
          compact && styles.swatchCompact,
          { backgroundColor: accentColor },
        ]}
      >
        <Text
          allowFontScaling
          style={{
            color: onAccentColor,
            fontSize: compact ? typography.h3.fontSize : typography.h2.fontSize,
            fontWeight: "800",
            fontVariant: ["tabular-nums"],
          }}
        >
          {numeralText}
        </Text>
      </View>
      <Text
        allowFontScaling
        numberOfLines={2}
        style={{
          color: colors.text.primary,
          textAlign: "center",
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const LevelTile = memo(LevelTileImpl);

const styles = StyleSheet.create({
  tile: {
    flexBasis: "31%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
  },
  tileCompact: {
    flexBasis: "31%",
  },
  swatch: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  swatchCompact: {
    aspectRatio: 1.3,
  },
});
