import type { ImageSource } from "expo-image";

import type { BuildingDamageGrade, CartoonLevel, DamageTypology } from "./types";

/**
 * Owner-commissioned artwork, bundled from `assets/artwork/felt/`. That
 * folder holds only the files the app actually ships; the full commissioned
 * package (character sheets, source exports, previews, checksums) is
 * internal design material kept outside this repository, in the project's
 * working folder. See `assets/artwork/README.md` for where, and for how to
 * add or replace a file.
 *
 * Format: WebP-512 (not PNG-512) — the package's own WebP-512 set is
 * ~3.8 MB total for all 22 tiles vs. ~5.5 MB for PNG-512 at the same
 * resolution (lossless either way), and `expo-image` decodes WebP natively
 * on both iOS and Android, so there is no quality tradeoff for the ~30%
 * bundle-size saving — worth taking given the "low-end Android is the
 * baseline device" priority even though PNG-512 alone would have stayed
 * under the rough 6 MB budget.
 *
 * Every path below is a full literal string, not a template/interpolated
 * one: Metro's static bundler only recognizes `require()` calls whose sole
 * argument is a plain string literal (its dependency collector walks the
 * AST looking for exactly that shape), so building the path from a shared
 * constant would silently fail to bundle at runtime. This also means both
 * maps have to be written out by hand rather than generated in a loop.
 */

/**
 * Window 1 (`app/felt-report/index.tsx`) — one artwork file per EMS-98
 * cartoon level, `level-01.webp`..`level-12.webp` in the package matching
 * `CartoonLevel` 1..12 exactly (both already 1-indexed, no shift needed).
 */
export const LEVEL_ARTWORK: Record<CartoonLevel, ImageSource> = {
  1: require("../../../assets/artwork/felt/level-01.webp"),
  2: require("../../../assets/artwork/felt/level-02.webp"),
  3: require("../../../assets/artwork/felt/level-03.webp"),
  4: require("../../../assets/artwork/felt/level-04.webp"),
  5: require("../../../assets/artwork/felt/level-05.webp"),
  6: require("../../../assets/artwork/felt/level-06.webp"),
  7: require("../../../assets/artwork/felt/level-07.webp"),
  8: require("../../../assets/artwork/felt/level-08.webp"),
  9: require("../../../assets/artwork/felt/level-09.webp"),
  10: require("../../../assets/artwork/felt/level-10.webp"),
  11: require("../../../assets/artwork/felt/level-11.webp"),
  12: require("../../../assets/artwork/felt/level-12.webp"),
};

/**
 * Window 2 (`app/felt-report/damage.tsx`) — building-damage artwork.
 *
 * Direct 1:1 mapping: the package numbers its damage files 01-05 as DG1 ("no
 * visible damage") through DG5 ("partial collapse"), and our own
 * `BuildingDamageGrade` is now the same DG1-DG5 numbering (2026-08-17
 * renumber, see `types.ts`) — so package file NN = our grade N with no shift.
 * Before the renumber this file carried an explicit N -> N-1 shift at every
 * entry to bridge the package's 1-indexed files to the app's old 0-indexed
 * type; that bridging is gone, this is now a plain lookup. The package files
 * themselves are unchanged (verbatim archive, checksummed in
 * `SHA256SUMS.txt`). Regression-locked by `__tests__/artwork.test.ts`.
 */
export const DAMAGE_ARTWORK: Record<DamageTypology, Record<BuildingDamageGrade, ImageSource>> = {
  highrise: {
    1: require("../../../assets/artwork/felt/damage-highrise-01.webp"),
    2: require("../../../assets/artwork/felt/damage-highrise-02.webp"),
    3: require("../../../assets/artwork/felt/damage-highrise-03.webp"),
    4: require("../../../assets/artwork/felt/damage-highrise-04.webp"),
    5: require("../../../assets/artwork/felt/damage-highrise-05.webp"),
  },
  lowrise: {
    1: require("../../../assets/artwork/felt/damage-lowrise-01.webp"),
    2: require("../../../assets/artwork/felt/damage-lowrise-02.webp"),
    3: require("../../../assets/artwork/felt/damage-lowrise-03.webp"),
    4: require("../../../assets/artwork/felt/damage-lowrise-04.webp"),
    5: require("../../../assets/artwork/felt/damage-lowrise-05.webp"),
  },
};
