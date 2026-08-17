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
export function computeTileWidth(containerWidth: number, columns: number, gap: number): number {
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
    tileWidth: containerWidth != null ? computeTileWidth(containerWidth, columns, gap) : undefined,
    onLayout,
  };
}
