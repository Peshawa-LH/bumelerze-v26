import type { StructuralSystem } from "./structural-systems";
import type { OccupancyCategory } from "./types";

/**
 * ISC-2017 Table 3-12/1 — allowable storey drift `Δa`, p70.
 *
 * Every entry is a fraction of `hsx`, the storey height below the level
 * being checked, so the table is stored as ratios and the app reports a
 * ratio. It deliberately does not ask for a storey height: drift is checked
 * per storey against that storey's own height, and inventing one number for
 * a whole building would be wrong.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `Cd` (from `structural-systems.ts`) amplifies the elastic storey drift a
 * frame analysis reports into the design drift; `Δa` here is what that
 * result must come in under. The pair is why both now ship: `Cd` alone
 * cannot be checked against anything.
 */

export type DriftStructureType =
  | "masonryCantileverShearWall"
  | "otherMasonryShearWall"
  | "masonryWallFrame"
  | "allOther";

/** Ratios of `hsx`, keyed by occupancy category. Categories I and II share
 * a column in the code, matching `OccupancyCategory`'s own `I_II`. */
const DRIFT_LIMITS: Record<DriftStructureType, Record<OccupancyCategory, number>> = {
  masonryCantileverShearWall: { I_II: 0.01, III: 0.01, IV: 0.01 },
  otherMasonryShearWall: { I_II: 0.007, III: 0.007, IV: 0.007 },
  masonryWallFrame: { I_II: 0.013, III: 0.013, IV: 0.01 },
  allOther: { I_II: 0.02, III: 0.015, IV: 0.01 },
};

/**
 * The table's FIRST row — 0.025/0.020/0.015 for "structures other than
 * masonry, four storeys or less, with interior walls, partitions, ceilings
 * and exterior wall systems designed to accommodate the storey drift" — is
 * deliberately NOT reachable here. It is conditional on a design intent the
 * app cannot know (were the partitions detailed to accept drift?) and on a
 * storey count. Claiming it would hand an engineer a 25% looser limit on an
 * assumption the app invented. `allOther` is the correct default, and an
 * engineer who meets that row's conditions knows to read it themselves.
 */
export function driftStructureTypeFor(
  system: StructuralSystem | null,
): DriftStructureType {
  // No system chosen falls to the table's own "all other structures" row,
  // the same catch-all the code provides.
  if (!system) {
    return "allOther";
  }
  // Our masonry systems are all bearing-wall shear walls, not the
  // cantilever form (which the code footnotes as walls acting as vertical
  // cantilevers from the base with negligible moment transfer between
  // them) and not wall frames.
  if (system.id.startsWith("bw.masonryShearWall")) {
    return "otherMasonryShearWall";
  }
  return "allOther";
}

export interface AllowableDrift {
  /** Fraction of the storey height `hsx`. */
  ratio: number;
  structureType: DriftStructureType;
}

export function allowableDrift(
  system: StructuralSystem | null,
  occupancy: OccupancyCategory,
): AllowableDrift {
  const structureType = driftStructureTypeFor(system);
  return { ratio: DRIFT_LIMITS[structureType][occupancy], structureType };
}

/** The allowable drift in millimetres for a given storey height, for
 * engineers who want the number rather than the ratio. */
export function allowableDriftMm(ratio: number, storeyHeightM: number): number {
  return ratio * storeyHeightM * 1000;
}
