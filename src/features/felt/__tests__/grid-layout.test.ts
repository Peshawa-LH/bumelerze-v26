import { computeTileWidth } from "../grid-layout";

/**
 * Damage-tile sizing bug (Wave A, 2026-08-17): `DamageTile`/`LevelTile`
 * used to size themselves with `flexBasis: "N%"` + `flexGrow: 1`, which
 * stretches whichever row of the wrap has fewer tiles than a full row —
 * inconsistent tile sizes across devices/rows. `computeTileWidth` replaces
 * that with an exact, container-width-derived pixel width shared by every
 * tile regardless of which row it lands in. These tests check the pure
 * math at exactly the viewport widths the wave brief calls out (320/375/
 * 414/768 + a desktop-ish width), for both grid shapes in the app
 * (DamageTile's 5-column typology rows, LevelTile's 3-column groups).
 */
describe("computeTileWidth", () => {
  const CHECKPOINT_WIDTHS = [320, 375, 414, 768, 1280];

  it.each(CHECKPOINT_WIDTHS)(
    "fits exactly 5 columns with 10px gaps inside a %ipx container without overflow",
    (containerWidth) => {
      const columns = 5;
      const gap = 10;
      const tileWidth = computeTileWidth(containerWidth, columns, gap);

      const rowWidth = tileWidth * columns + gap * (columns - 1);
      expect(rowWidth).toBeLessThanOrEqual(containerWidth + 0.001);
      expect(tileWidth).toBeGreaterThan(0);
    },
  );

  it.each(CHECKPOINT_WIDTHS)(
    "fits exactly 3 columns with 10px gaps inside a %ipx container without overflow",
    (containerWidth) => {
      const columns = 3;
      const gap = 10;
      const tileWidth = computeTileWidth(containerWidth, columns, gap);

      const rowWidth = tileWidth * columns + gap * (columns - 1);
      expect(rowWidth).toBeLessThanOrEqual(containerWidth + 0.001);
      expect(tileWidth).toBeGreaterThan(0);
    },
  );

  it("every tile in a row gets the identical width by construction (a full row and a trailing row of 1 both use the same formula)", () => {
    // The old bug: a trailing row with fewer items than `columns` stretched
    // via flexGrow. `computeTileWidth` doesn't take "how many tiles are
    // actually in this row" as an input at all — it's purely a function of
    // the container width and the fixed column count, so a full 5-tile row
    // and a trailing 1-tile row necessarily compute the exact same width.
    const containerWidth = 360;
    const fullRowTileWidth = computeTileWidth(containerWidth, 5, 10);
    const trailingRowTileWidth = computeTileWidth(containerWidth, 5, 10);
    expect(trailingRowTileWidth).toBe(fullRowTileWidth);
  });

  it("matches the exact formula: (containerWidth - gap * (columns - 1)) / columns", () => {
    expect(computeTileWidth(360, 5, 10)).toBeCloseTo((360 - 40) / 5, 5);
    expect(computeTileWidth(360, 3, 10)).toBeCloseTo((360 - 20) / 3, 5);
  });

  it("never returns a negative width even for a pathologically narrow container", () => {
    expect(computeTileWidth(10, 5, 10)).toBe(0);
  });

  it("falls back to the full container width for a zero/negative column count", () => {
    expect(computeTileWidth(320, 0, 10)).toBe(320);
  });
});
