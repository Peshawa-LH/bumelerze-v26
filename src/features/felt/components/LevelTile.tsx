import { Image, type ImageSource } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

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
   * Still undefined every wave until the 22-image commission
   * (`cartoon-artwork-brief.md`) lands and `app/felt-report/index.tsx` wires
   * a per-level `require()` map through this prop (brief §5) — until then
   * the tile renders the plain intensity-ramp color swatch alone.
   *
   * Typed against `expo-image`'s real `ImageSource`. Resolution note for the
   * blocker that held this back: `expo-image@57.0.2` crashed on bare import
   * under this project's `jest-expo@57.0.3` (`observe.getIntegrations is
   * not a function` — an optional `expo-observe` native module jest-expo's
   * `expo-modules-core` mock can't resolve). Bumping to the newest available
   * SDK 57 pair (`expo-image@57.0.3`, `jest-expo@57.0.4`) did NOT fix it, so
   * `jest.setup.js` carries a small `jest.mock("expo-image", ...)` standing
   * in a plain `react-native` `Image` for tests — see that file for the
   * full trail. Production code (this file) uses the real `expo-image`.
   */
  imageSource?: ImageSource;
  /** Science pack §1.2: levels 10-12 render in the "severe destruction"
   * sub-group, slightly more compact than 1-9 — still fully selectable. */
  compact?: boolean;
}

function LevelTileImpl({
  level,
  label,
  locale,
  onPress,
  imageSource,
  compact = false,
}: LevelTileProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const accentColor = colors.intensity[level];
  const onAccentColor = colors.intensityOnFill[level];
  const numeralText = localizeDigits(String(level), locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${numeralText}. ${label}`}
      // A blind/low-vision user during a real earthquake needs to know a
      // single tap both selects AND submits this level immediately (no
      // separate confirm step) — the label alone (numeral + level name)
      // doesn't convey that "submits now" behavior (design-language.md §8).
      accessibilityHint={t("felt.tier1.levelA11yHint")}
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
        {imageSource != null ? (
          <Image
            testID="level-tile-artwork"
            source={imageSource}
            contentFit="cover"
            style={styles.artwork}
            // Decorative reinforcement only — the Pressable's own
            // accessibilityLabel (numeral + translated level name) already
            // carries the tile's full meaning (cartoon-artwork-brief.md §5).
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
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
        // No numberOfLines cap: some locale labels (e.g. Sorani/Kurmanji
        // levels 4/5) run 4-5 words and would truncate a real EMS-98 level
        // meaning at 200% font scale if capped at 2 lines — the tile has no
        // fixed height (flexBasis/flexGrow only), so letting the label wrap
        // freely just grows the tile instead of losing safety-critical text
        // (design-language.md §8 "never truncate ... at any scale").
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
  artwork: {
    position: "absolute",
    width: "100%",
    height: "100%",
  },
});
