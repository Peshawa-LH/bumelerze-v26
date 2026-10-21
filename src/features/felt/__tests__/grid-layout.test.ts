import { columnsForWholeWords, computeTileWidth } from "../grid-layout";

/**
 * Damage-tile sizing bug (Wave A, 2026-08-17): `DamageTile`/`LevelTile`
 * used to size themselves with `flexBasis: "N%"` + `flexGrow: 1`, which
 * stretches whichever row of the wrap has fewer tiles than a full row —
 * inconsistent tile sizes across devices/rows. `computeTileWidth` replaces
 * that with an exact, container-width-derived pixel width shared by every
 * tile regardless of which row it lands in. These tests check the pure
 * math at exactly the viewport widths the brief calls out (320/375/
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

describe("columnsForWholeWords (parity re-check N2: no word broken mid-word at large text)", () => {
  const LOCALES = ["en", "ckb", "kmr", "ar"] as const;
  const levelLabels = (locale: (typeof LOCALES)[number]): string[] => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the locale files as JSON
    const file = require(`@/i18n/locales/${locale}.json`) as {
      felt: { tier1: { levels: Record<string, { label: string }> } };
    };
    return Object.values(file.felt.tier1.levels).map((level) => level.label);
  };
  const columns = (
    locale: (typeof LOCALES)[number],
    fontScale: number,
    containerWidth = 362,
  ) =>
    columnsForWholeWords({
      containerWidth,
      maxColumns: 3,
      gap: 10,
      tilePadding: 8,
      labels: levelLabels(locale),
      textSize: 12,
      fontScale,
    });

  it.each(LOCALES)(
    "keeps three cards per row at the ordinary text sizes (%s), also on a 320 pt phone",
    (locale) => {
      expect(columns(locale, 1)).toBe(3);
      expect(columns(locale, 1, 280)).toBe(3);
      // XXXL, the largest ordinary size, on an iPhone 17.
      expect(columns(locale, 1.353)).toBe(3);
    },
  );

  it("[regression] gives the English cards room for 'shaking' and 'Destructive' at Accessibility XL", () => {
    // Three columns there read "3 - Weak shakin" / "g".
    expect(columns("en", 2.643)).toBe(1);
    expect(columns("en", 1.786)).toBe(2);
  });

  it("keeps two Sorani cards per row at Accessibility XL, one at the largest size", () => {
    expect(columns("ckb", 2.643)).toBe(2);
    expect(columns("ckb", 3.571)).toBe(1);
  });

  it("never goes below one column, and treats a smaller-than-default text as the default", () => {
    expect(
      columnsForWholeWords({
        containerWidth: 100,
        maxColumns: 3,
        gap: 10,
        tilePadding: 8,
        labels: ["Supercalifragilistic"],
        textSize: 40,
        fontScale: 4,
      }),
    ).toBe(1);
    expect(columns("en", 0.8)).toBe(3);
  });
});
