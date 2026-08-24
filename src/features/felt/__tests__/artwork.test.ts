/**
 * Regression-locks `artwork.ts`'s two static require() maps against the
 * commissioned artwork package (owner artwork wave, 2026-08-16).
 *
 * `jest-expo`'s asset transform collapses every image `require()` to the
 * same value (`module.exports = 1`, see `assetFileTransformer.js`), so
 * comparing resolved values directly can't tell `level-03.webp` apart from
 * `level-04.webp`. Instead each of the 22 package files is individually
 * mocked below with its own literal `jest.mock(...)` call and a unique
 * marker string — this both proves the maps resolve (no missing/mis-typed
 * file crashes the require) and proves each map key points at the RIGHT
 * file. Since the 2026-08-17 DG0-DG4 -> DG1-DG5 renumber, our own
 * `BuildingDamageGrade` and the package's DG1..DG5 / file 01..05 numbering
 * are the SAME numbers — no shift to regression-lock anymore, this now just
 * proves the direct 1:1 mapping holds.
 *
 * Every call below must use a literal module-path string and a factory
 * with no outer-variable references (babel-plugin-jest-hoist forbids
 * closures in `jest.mock` factories) — that's why this isn't a loop.
 */

// prettier-ignore
jest.mock("../../../../assets/artwork/felt/level-01.webp", () => "asset:level-01.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-02.webp", () => "asset:level-02.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-03.webp", () => "asset:level-03.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-04.webp", () => "asset:level-04.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-05.webp", () => "asset:level-05.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-06.webp", () => "asset:level-06.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-07.webp", () => "asset:level-07.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-08.webp", () => "asset:level-08.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-09.webp", () => "asset:level-09.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-10.webp", () => "asset:level-10.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-11.webp", () => "asset:level-11.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/level-12.webp", () => "asset:level-12.webp", { virtual: true });

jest.mock("../../../../assets/artwork/felt/damage-highrise-01.webp", () => "asset:damage-highrise-01.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-highrise-02.webp", () => "asset:damage-highrise-02.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-highrise-03.webp", () => "asset:damage-highrise-03.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-highrise-04.webp", () => "asset:damage-highrise-04.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-highrise-05.webp", () => "asset:damage-highrise-05.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-lowrise-01.webp", () => "asset:damage-lowrise-01.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-lowrise-02.webp", () => "asset:damage-lowrise-02.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-lowrise-03.webp", () => "asset:damage-lowrise-03.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-lowrise-04.webp", () => "asset:damage-lowrise-04.webp", { virtual: true });
jest.mock("../../../../assets/artwork/felt/damage-lowrise-05.webp", () => "asset:damage-lowrise-05.webp", { virtual: true });

// Imported after the jest.mock calls above so the mocked module graph is
// in place before this loads.
// eslint-disable-next-line import/first -- see comment above
import { DAMAGE_ARTWORK, LEVEL_ARTWORK } from "../artwork";

describe("LEVEL_ARTWORK", () => {
  it("has exactly the 12 EMS-98 cartoon levels, each resolving to its own numbered file", () => {
    expect(Object.keys(LEVEL_ARTWORK)).toHaveLength(12);

    expect(LEVEL_ARTWORK[1]).toBe("asset:level-01.webp");
    expect(LEVEL_ARTWORK[2]).toBe("asset:level-02.webp");
    expect(LEVEL_ARTWORK[3]).toBe("asset:level-03.webp");
    expect(LEVEL_ARTWORK[4]).toBe("asset:level-04.webp");
    expect(LEVEL_ARTWORK[5]).toBe("asset:level-05.webp");
    expect(LEVEL_ARTWORK[6]).toBe("asset:level-06.webp");
    expect(LEVEL_ARTWORK[7]).toBe("asset:level-07.webp");
    expect(LEVEL_ARTWORK[8]).toBe("asset:level-08.webp");
    expect(LEVEL_ARTWORK[9]).toBe("asset:level-09.webp");
    expect(LEVEL_ARTWORK[10]).toBe("asset:level-10.webp");
    expect(LEVEL_ARTWORK[11]).toBe("asset:level-11.webp");
    expect(LEVEL_ARTWORK[12]).toBe("asset:level-12.webp");
  });
});

describe("DAMAGE_ARTWORK", () => {
  it("has exactly 2 typologies x 5 grades (10 entries total)", () => {
    expect(Object.keys(DAMAGE_ARTWORK).sort()).toEqual(["highrise", "lowrise"]);
    expect(Object.keys(DAMAGE_ARTWORK.highrise)).toHaveLength(5);
    expect(Object.keys(DAMAGE_ARTWORK.lowrise)).toHaveLength(5);
  });

  it("maps our DG1-DG5 grade directly to the package's same-numbered file (highrise)", () => {
    // Our grade 1 ("no visible damage") -> package file 01 (DG1), direct.
    expect(DAMAGE_ARTWORK.highrise[1]).toBe("asset:damage-highrise-01.webp");
    expect(DAMAGE_ARTWORK.highrise[2]).toBe("asset:damage-highrise-02.webp");
    expect(DAMAGE_ARTWORK.highrise[3]).toBe("asset:damage-highrise-03.webp");
    expect(DAMAGE_ARTWORK.highrise[4]).toBe("asset:damage-highrise-04.webp");
    // Our grade 5 ("partial collapse") -> package file 05 (DG5), direct.
    expect(DAMAGE_ARTWORK.highrise[5]).toBe("asset:damage-highrise-05.webp");
  });

  it("maps our DG1-DG5 grade directly to the package's same-numbered file (lowrise)", () => {
    expect(DAMAGE_ARTWORK.lowrise[1]).toBe("asset:damage-lowrise-01.webp");
    expect(DAMAGE_ARTWORK.lowrise[2]).toBe("asset:damage-lowrise-02.webp");
    expect(DAMAGE_ARTWORK.lowrise[3]).toBe("asset:damage-lowrise-03.webp");
    expect(DAMAGE_ARTWORK.lowrise[4]).toBe("asset:damage-lowrise-04.webp");
    expect(DAMAGE_ARTWORK.lowrise[5]).toBe("asset:damage-lowrise-05.webp");
  });
});
