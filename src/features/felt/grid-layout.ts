import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

/**
 * Pure math for an evenly-spaced, fixed-column tile grid: given the actual
 * rendered width of the wrapping row container, returns the width every
 * tile in that row must be to fit exactly `columns` per row with `gap`
 * between them, edge to edge, with none left over.
 *
 * This exists because CSS/Yoga flexbox `gap` is added ON TOP OF percentage
 * `flexBasis` values, not subtracted from them — `columns` tiles at
 * `flexBasis: (100/columns)%` plus `(columns - 1)` gaps of `gap` px WILL
 * overflow the container by the total gap width, and the overflowing tile
 * wraps onto its own row. A trailing row with fewer tiles than `columns`
 * then has more leftover main-axis space per tile than a full row, so any
 * `flexGrow` on the tiles stretches that short row's tiles bigger than the
 * rest — this was the felt-report damage/level grids' "some tiles render
 * larger than others" bug (`DamageTile`'s 5-per-row split more visibly than
 * `LevelTile`'s 3-per-row, purely because 3 happens to divide its current
 * tile counts evenly with no trailing row — same underlying flaw either
 * way). Computing an exact pixel width up front and rendering tiles with
 * `flexGrow: 0` sidesteps the whole class of bug: every tile gets the
 * identical, container-width-derived size regardless of which row (full or
 * trailing) it lands in.
 */
export function computeTileWidth(
  containerWidth: number,
  columns: number,
  gap: number,
): number {
  if (columns <= 0) {
    return containerWidth;
  }
  const totalGap = gap * (columns - 1);
  return Math.max(0, (containerWidth - totalGap) / columns);
}

export interface TileGridLayout {
  /** Undefined until the grid container's first `onLayout` fires — callers
   * fall back to their own pre-measurement sizing for that first frame
   * (see `DamageTile`/`LevelTile`'s `width` prop doc). */
  tileWidth: number | undefined;
  /** Attach to the wrapping `<View style={{flexDirection:"row",
   * flexWrap:"wrap"}}>` so its real rendered width (after safe-area/
   * padding is applied by its own ancestors) drives the tile math above,
   * instead of guessing from screen width and hardcoding this grid's
   * surrounding padding here. */
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Measures a tile-grid container's actual width and derives the uniform
 * per-tile pixel width for a fixed `columns`-per-row, `gap`-px-apart
 * layout (see `computeTileWidth`). Multiple grids at the same padding
 * level (e.g. `DamageTile`'s two typology rows, `LevelTile`'s two severity
 * groups) can share one call — every `onLayout` measurement recomputes the
 * same value, so pointing more than one grid's `onLayout` at it is safe
 * and just re-confirms the width rather than conflicting.
 */
export function useTileGridLayout(columns: number, gap: number): TileGridLayout {
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setContainerWidth((previous) => (previous === width ? previous : width));
  }, []);

  return {
    tileWidth:
      containerWidth != null ? computeTileWidth(containerWidth, columns, gap) : undefined,
    onLayout,
  };
}

/** iOS's accessibility text sizes (Settings > Accessibility > Larger Text)
 * start at a font scale of about 1.79 (AX-M); XXXL, the largest ordinary
 * size, is about 1.35. The web is always 1. */
export const ACCESSIBILITY_FONT_SCALE = 1.7;

/** A word's width per character, in em: a little over the average of a
 * Latin or Arabic-script letter, so the estimate errs towards fewer
 * columns. */
const WORD_CHARACTER_EM = 0.5;

/**
 * The most columns, up to `maxColumns`, at which the longest word of every
 * label still fits on one line inside a tile. iOS breaks a word in the
 * middle only when it is wider than its line: at the accessibility text
 * sizes the felt report's three-column cards read "3 - Weak shakin" / "g"
 * (parity re-check N2). At the ordinary sizes, XXXL included, and always on
 * the web (font scale 1), every language keeps `maxColumns`.
 */
export function columnsForWholeWords({
  containerWidth,
  maxColumns,
  gap,
  tilePadding,
  labels,
  textSize,
  fontScale,
}: {
  containerWidth: number;
  maxColumns: number;
  gap: number;
  /** Horizontal padding inside a tile, on each side. */
  tilePadding: number;
  labels: readonly string[];
  /** The labels' font size before the system text size applies. */
  textSize: number;
  fontScale: number;
}): number {
  const longestWord = Math.max(
    0,
    ...labels
      .flatMap((label) => label.split(/\s+/))
      .map((word) => Array.from(word).length),
  );
  const wordWidth = longestWord * WORD_CHARACTER_EM * textSize * Math.max(1, fontScale);
  for (let columns = maxColumns; columns > 1; columns -= 1) {
    if (wordWidth <= computeTileWidth(containerWidth, columns, gap) - 2 * tilePadding) {
      return columns;
    }
  }
  return 1;
}
