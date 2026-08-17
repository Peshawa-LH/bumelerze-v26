import { Image, type ImageSource } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
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
  /** Exact tile width in px, from the parent grid's `useTileGridLayout`
   * (`../grid-layout.ts`) — every tile in a row gets the SAME value, sized
   * from the grid container's real measured width, so a short trailing row
   * never stretches. Undefined only for the single frame before the grid's
   * `onLayout` has fired yet; the tile falls back to the old percentage
   * basis for that one frame (still `flexGrow: 0`, so no stretch even
   * then) rather than rendering at zero width. */
  width?: number | undefined;
}

function DamageTileImpl({
  typology,
  grade,
  label,
  accessibilityLabel,
  locale,
  onPress,
  imageSource,
  width,
}: DamageTileProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  // Own 5-color damage palette (2026-08-17 update wave, §2.2b) — no longer
  // sampled from the EMS intensity ramp, see `theme/palette.ts`'s
  // `damageGradePalette` doc comment.
  const accentColor = colors.damageGrade[grade];
  const onAccentColor = colors.damageGradeOnFill[grade];
  const numeralText = localizeDigits(String(grade), locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(typology, grade)}
      style={({ pressed }) => [
        // `width` (measured) wins outright; the bare `styles.tile` basis is
        // only ever seen for the one frame before the grid's `onLayout`
        // fires — see the `width` prop's doc comment above.
        width != null ? styles.tileMeasured : styles.tile,
        width != null ? { width } : null,
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
        ) : (
          // Numeral-on-swatch fallback ONLY when there is no artwork
          // (owner directive, 2026-08-16 — same "N - Label" move as
          // `LevelTile`, kept visually consistent across windows 1 and 2).
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
        )}
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
        {t("felt.numberedLabel", { number: numeralText, label })}
      </Text>
    </Pressable>
  );
}

export const DamageTile = memo(DamageTileImpl);

const styles = StyleSheet.create({
  // Pre-measurement fallback only (see the `width` prop's doc comment) —
  // deliberately `flexGrow: 0` even here, so this never stretches either.
  tile: {
    flexBasis: "18%",
    flexGrow: 0,
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
  },
  // Once the grid has measured itself, every tile gets an exact pixel
  // `width` (set inline above) instead of a percentage basis — no
  // `flexGrow`/`flexBasis` at all, so row-to-row tile counts can never
  // change any tile's size (the bug this replaces).
  tileMeasured: {
    flexGrow: 0,
    flexShrink: 0,
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
