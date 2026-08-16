import type { ImageSource } from "expo-image";

import type { BuildingDamageGrade, CartoonLevel, DamageTypology } from "./types";

/**
 * Owner-commissioned artwork wired in from
 * `assets/Bumelerze-App-Visual-Assets/` — the committed, canonical handoff
 * package; see its own `README.md` and `asset-manifest.json`. Required
 * directly from that package rather than copied file-by-file elsewhere: the
 * package is already the single source of truth (checksummed,
 * `SHA256SUMS.txt`), and Metro bundles any asset it can `require()`
 * regardless of which folder it lives in.
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
  1: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-01.webp"),
  2: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-02.webp"),
  3: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-03.webp"),
  4: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-04.webp"),
  5: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-05.webp"),
  6: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-06.webp"),
  7: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-07.webp"),
  8: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-08.webp"),
  9: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-09.webp"),
  10: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-10.webp"),
  11: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-11.webp"),
  12: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/level-12.webp"),
};

/**
 * Window 2 (`app/felt-report/damage.tsx`) — building-damage artwork.
 *
 * CRITICAL OFF-BY-ONE, encoded once here: the package numbers its damage
 * files 01-05 as DG1 ("no visible damage") through DG5 ("partial
 * collapse"), but our own `BuildingDamageGrade` is 0-indexed (0..4, see
 * `types.ts`). So package file N (01..05) = our grade (N-1) (0..4) —
 * i.e. `damage-*-01.webp` -> grade 0, `damage-*-05.webp` -> grade 4. The
 * package files themselves are NOT renamed (verbatim archive, checksummed
 * in `SHA256SUMS.txt`); the shift lives only in which key points at which
 * require() below. Regression-locked by `__tests__/artwork.test.ts`.
 */
export const DAMAGE_ARTWORK: Record<DamageTypology, Record<BuildingDamageGrade, ImageSource>> = {
  highrise: {
    // damage-highrise-01.webp = package DG1 "no visible damage" -> our grade 0
    0: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-highrise-01.webp"),
    // damage-highrise-02.webp = package DG2 "hairline cracks" -> our grade 1
    1: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-highrise-02.webp"),
    // damage-highrise-03.webp = package DG3 -> our grade 2
    2: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-highrise-03.webp"),
    // damage-highrise-04.webp = package DG4 -> our grade 3
    3: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-highrise-04.webp"),
    // damage-highrise-05.webp = package DG5 "partial collapse" -> our grade 4
    4: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-highrise-05.webp"),
  },
  lowrise: {
    // damage-lowrise-01.webp = package DG1 "no visible damage" -> our grade 0
    0: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-lowrise-01.webp"),
    // damage-lowrise-02.webp = package DG2 "hairline cracks" -> our grade 1
    1: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-lowrise-02.webp"),
    // damage-lowrise-03.webp = package DG3 -> our grade 2
    2: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-lowrise-03.webp"),
    // damage-lowrise-04.webp = package DG4 -> our grade 3
    3: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-lowrise-04.webp"),
    // damage-lowrise-05.webp = package DG5 "partial roof/wall collapse" -> our grade 4
    4: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/damage-lowrise-05.webp"),
  },
};
