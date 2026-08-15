import { Image, type ImageSource } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { DAMAGE_GRADE_TO_INTENSITY_INDEX } from "../damage";
import type { BuildingDamageGrade, DamageTypology } from "../types";

interface DamageTileProps {
  typology: DamageTypology;
  grade: BuildingDamageGrade;
  /** Short damage-state label for this grade, already localized for this
   * typology (e.g. "Hairline cracks") — the row header above the grid
   * carries the typology label, so the tile itself doesn't repeat it
   * visually, only in its accessibility label (see below). */
  label: string;
  /** Full "<typology>. <damage state>." accessibility label — combines both
   * pieces of context per the wave brief ("LevelTile-style: typology label
   * + damage-state label"), since a screen-reader user tabbing through two
   * back-to-back rows needs the typology restated on every tile, not just
   * the row header. */
  accessibilityLabel: string;
  locale: string;
  onPress: (typology: DamageTypology, grade: BuildingDamageGrade) => void;
  /** AI-generated damage-tile artwork slot (cartoon-artwork-brief.md
   * "Damage tiles" section) — mirrors `LevelTile`'s own `imageSource` prop:
   * still undefined every wave until the 10-image commission lands and gets
   * wired through from `app/felt-report/damage.tsx` (brief §6.5). See
   * `LevelTile`'s doc comment for the `expo-image`/`jest-expo` compatibility
   * note this component shares (resolved via a test-only mock, not a real
   * version fix — `jest.setup.js`). */
  imageSource?: ImageSource;
}

function DamageTileImpl({
  typology,
  grade,
  label,
  accessibilityLabel,
  locale,
  onPress,
  imageSource,
}: DamageTileProps) {
  const { colors, typography, spacing } = useTheme();
  const intensityIndex = DAMAGE_GRADE_TO_INTENSITY_INDEX[grade];
  const accentColor = colors.intensity[intensityIndex];
  const onAccentColor = colors.intensityOnFill[intensityIndex];
  const numeralText = localizeDigits(String(grade), locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(typology, grade)}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[2],
          gap: spacing[1],
          minHeight: 48,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.swatch, { backgroundColor: accentColor }]}>
        {imageSource != null ? (
          <Image
            testID="damage-tile-artwork"
            source={imageSource}
            contentFit="cover"
            style={styles.artwork}
            // Decorative reinforcement only — the Pressable's own
            // accessibilityLabel (typology + damage-state label) already
            // carries the tile's full meaning (cartoon-artwork-brief.md §5).
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
        <Text
          allowFontScaling
          style={{
            color: onAccentColor,
            fontSize: typography.h3.fontSize,
            fontWeight: "800",
            fontVariant: ["tabular-nums"],
          }}
        >
          {numeralText}
        </Text>
      </View>
      <Text
        allowFontScaling
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

export const DamageTile = memo(DamageTileImpl);

const styles = StyleSheet.create({
  tile: {
    flexBasis: "18%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
  },
  swatch: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  artwork: {
    position: "absolute",
    width: "100%",
    height: "100%",
  },
});
