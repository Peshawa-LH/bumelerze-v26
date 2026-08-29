import type { SeismicDesignCategory } from "./types";

/**
 * ISC-2017 Table 3-2/1 — design coefficients for seismic-force-resisting
 * systems: `R`, `Ω0`, `Cd`, and the height limit per seismic design
 * category.
 *
 * WHY THIS SHIPS NOW, HAVING PREVIOUSLY BEEN WITHHELD
 * ---------------------------------------------------
 * `config.ts` used to record that this table "could not be extracted
 * reliably" and shipped only `R = 4`. That premise was wrong. The 2017 PDF
 * has a broken digit map: its TEXT LAYER decodes a printed `50` as `21`,
 * `4.5` as `4.2` and `2.5` as `2.2`. Every earlier attempt read that layer,
 * got nonsense, and concluded the table was unreadable. The rendered glyphs
 * are correct — only the ToUnicode mapping is broken.
 *
 * HOW THESE VALUES WERE READ
 * --------------------------
 * Two independent channels, neither of them the text layer:
 *
 * 1. The page rendered at 210 dpi and read directly; anything ambiguous
 *    re-rendered at 700-900 dpi for that one cell. AUTHORITATIVE.
 * 2. Tesseract OCR of the rendered pixels, as a disagreement flag only. It
 *    drops decimal points at this font size (`2.5` → `25`) and misread
 *    `6.5` as `5.5` once, so it never sources a value.
 *
 * The two disagreed on exactly one cell — special reinforced concrete
 * moment frames — settled at 900 dpi as `R = 6.5`, OCR wrong. That case is
 * why the render is authoritative here.
 *
 * ASCE 7 IS NOT A CROSS-CHECK FOR THIS TABLE. Unlike `Fa`/`Fv` (which are
 * ASCE 7-05/7-10 unchanged, see `tables.ts`), ISC-2017's `R` values differ:
 * steel eccentrically braced frames are 7 and 6 here where ASCE 7-10 has 8
 * and 7. Do not "correct" a value toward ASCE.
 *
 * WHY A SUBSET
 * ------------
 * The full table runs past 60 systems, including composite, cantilever-
 * column and steel-plate-wall systems that are vanishingly rare in
 * Kurdistan. Each extra row is another chance to put a wrong number into
 * someone's design, so this ships the 16 that cover real construction here
 * and leaves `R` free entry for anything else, labelled as unverified.
 * Adding a system means reading it at high dpi and adding a test — not
 * copying from ASCE.
 *
 * Source pages: 34 (bearing wall), 34-35 (building frame), 36 (moment
 * frame) of the full code PDF in the vault.
 */

/** Height limit for a system in a given seismic design category.
 * `"NL"` = not limited. `"NP"` = **not permitted** — the system may not be
 * used at all in that category, which is a compliance answer, not a number.
 * A numeric value is a limit in metres. */
export type HeightLimit = "NL" | "NP" | number;

export type StructuralSystemCategory = "bearingWall" | "buildingFrame" | "momentFrame";

export interface StructuralSystem {
  id: string;
  category: StructuralSystemCategory;
  /** Response modification coefficient. */
  r: number;
  /** System overstrength factor, needed by the load combinations for
   * collectors and discontinuous elements. */
  omega0: number;
  /** Deflection amplification factor, which turns elastic drift into
   * design drift. */
  cd: number;
  /** Keyed by design category. A and B share a column in the code. */
  heightLimits: Record<"AB" | "C" | "D", HeightLimit>;
}

export const STRUCTURAL_SYSTEMS: readonly StructuralSystem[] = [
  // --- Bearing wall systems (أنظمة الجدران الحاملة), p34 ---
  { id: "bw.rcShearWallSpecial", category: "bearingWall", r: 4, omega0: 2.5, cd: 5,
    heightLimits: { AB: "NL", C: "NL", D: 50 } },
  { id: "bw.rcShearWallOrdinary", category: "bearingWall", r: 3, omega0: 2.5, cd: 4,
    heightLimits: { AB: "NL", C: "NL", D: "NP" } },
  { id: "bw.masonryShearWallSpecial", category: "bearingWall", r: 4, omega0: 2.5, cd: 3.5,
    heightLimits: { AB: "NL", C: "NL", D: 50 } },
  { id: "bw.masonryShearWallIntermediate", category: "bearingWall", r: 2.5, omega0: 2.5, cd: 2.25,
    heightLimits: { AB: "NL", C: "NL", D: "NP" } },
  { id: "bw.masonryShearWallOrdinary", category: "bearingWall", r: 1.5, omega0: 2.5, cd: 1.75,
    heightLimits: { AB: "NL", C: 50, D: "NP" } },

  // --- Building frame systems (أنظمة البناء الهيكلي), p34-35 ---
  { id: "bf.steelEbfMomentConnections", category: "buildingFrame", r: 7, omega0: 2, cd: 4,
    heightLimits: { AB: "NL", C: "NL", D: 50 } },
  { id: "bf.steelEbfNonMomentConnections", category: "buildingFrame", r: 6, omega0: 2, cd: 4,
    heightLimits: { AB: "NL", C: "NL", D: 50 } },
  { id: "bf.steelCbfSpecial", category: "buildingFrame", r: 5, omega0: 2, cd: 5,
    heightLimits: { AB: "NL", C: "NL", D: 50 } },
  { id: "bf.steelCbfOrdinary", category: "buildingFrame", r: 4, omega0: 2, cd: 4.5,
    heightLimits: { AB: "NL", C: "NL", D: 10 } },
  { id: "bf.rcShearWallSpecial", category: "buildingFrame", r: 5, omega0: 2.5, cd: 5,
    heightLimits: { AB: "NL", C: "NL", D: 50 } },
  { id: "bf.rcShearWallOrdinary", category: "buildingFrame", r: 4, omega0: 2.5, cd: 4.5,
    heightLimits: { AB: "NL", C: "NL", D: "NP" } },

  // --- Moment-resisting frame systems (أنظمة الهياكل المقاومة للعزوم), p36 ---
  { id: "mf.steelSpecial", category: "momentFrame", r: 7, omega0: 3, cd: 5.5,
    heightLimits: { AB: "NL", C: "NL", D: "NL" } },
  { id: "mf.steelIntermediate", category: "momentFrame", r: 4, omega0: 3, cd: 4,
    heightLimits: { AB: "NL", C: "NL", D: 10 } },
  { id: "mf.steelOrdinary", category: "momentFrame", r: 3, omega0: 3, cd: 3,
    heightLimits: { AB: "NL", C: "NL", D: "NP" } },
  // The one cell where OCR and the render disagreed; 900 dpi settled it.
  { id: "mf.rcSpecial", category: "momentFrame", r: 6.5, omega0: 3, cd: 5.5,
    heightLimits: { AB: "NL", C: "NL", D: "NL" } },
  { id: "mf.rcIntermediate", category: "momentFrame", r: 4, omega0: 3, cd: 4.5,
    heightLimits: { AB: "NL", C: "NL", D: "NP" } },
];

export function findStructuralSystem(id: string): StructuralSystem | null {
  return STRUCTURAL_SYSTEMS.find((s) => s.id === id) ?? null;
}

/** The code groups categories A and B in one column. */
export function heightLimitFor(
  system: StructuralSystem,
  sdc: SeismicDesignCategory,
): HeightLimit {
  if (sdc === "A" || sdc === "B") {
    return system.heightLimits.AB;
  }
  return sdc === "C" ? system.heightLimits.C : system.heightLimits.D;
}

export type HeightCheck =
  | { status: "notPermitted" }
  | { status: "unlimited" }
  | { status: "withinLimit"; limitM: number }
  | { status: "overLimit"; limitM: number };

/**
 * Checks a building height against the system's limit for this site's
 * design category. `heightM` may be null — the engineer has not said how
 * tall it is — in which case a numeric limit is still worth reporting, but
 * no pass/fail is claimed.
 */
export function checkHeight(
  system: StructuralSystem,
  sdc: SeismicDesignCategory,
  heightM: number | null,
): HeightCheck {
  const limit = heightLimitFor(system, sdc);
  if (limit === "NP") {
    return { status: "notPermitted" };
  }
  if (limit === "NL") {
    return { status: "unlimited" };
  }
  if (heightM === null || heightM <= limit) {
    return { status: "withinLimit", limitM: limit };
  }
  return { status: "overLimit", limitM: limit };
}
