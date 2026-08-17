import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { SAFETY_ARTWORK, type SafetyImageId } from "../artwork";

interface SafetyImageRowProps {
  images: readonly SafetyImageId[];
}

/**
 * Card-level illustration row (owner-artwork wave, 2026-08-17): renders a
 * card's `images` (0-3 today, see `SafetyCard.images`) as small side-by-side
 * thumbnails above the body text. Sized to support the reading, not compete
 * with it — capped at 120 logical px per tile even when there's only one,
 * which keeps a single-image card (e.g. `safeSpots`) from turning into a
 * hero banner.
 *
 * Decorative only: the card's title/body text already carries the full
 * meaning (research brief: "show the thing a sentence cannot show", not
 * duplicate what it already says), so every tile is hidden from screen
 * readers exactly like `LevelTile`/`DamageTile` already do for the felt-
 * report artwork.
 *
 * Never mirrored under RTL — no `transform` is applied anywhere in this
 * component. The row's left-to-right order can flip with the rest of the
 * layout (ordinary `flexDirection: "row"` + `I18nManager`), but each
 * image's own content stays exactly as drawn, per the commission's
 * direction-neutral requirement.
 */
export function SafetyImageRow({ images }: SafetyImageRowProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <View style={styles.row}>
      {images.map((imageId) => (
        <Image
          key={imageId}
          testID="safety-card-artwork"
          source={SAFETY_ARTWORK[imageId]}
          contentFit="contain"
          style={styles.image}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  image: {
    width: 96,
    height: 96,
    maxWidth: 120,
    maxHeight: 120,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 96,
  },
});
