// Small, LOCAL (not vendored) helpers for the two `felt_cells` JSONB columns
// the CDI math in `felt-aggregation/` deliberately does not compute:
// `damage_dist` (Q10-successor building-damage answer distribution) and
// `ground_effects` (Q11 road/ground layer) — see
// `src/lib/felt-aggregation/README.md`'s "What is deliberately NOT here"
// for why those two are out of that module's scope ("a separate JSONB
// column the caller populates directly from raw answers, no scoring
// involved"). This IS that caller. Both are plain frequency counts — no
// CDI/EMS weighting, no dedup logic (that already happened upstream, in
// `index.ts`'s per-cell report grouping, before these are called), so they
// don't need to live in the vendored, golden-fixture-tested folder.

import type { Tier2CellReport } from "./types.ts";

export interface DamageDist {
  /** Count of tier-2 reports per `building_damage_level` grade (1-5,
   * migration 0018), among reports that answered it. */
  byGrade: Record<string, number>;
  /** Same counts, split by which of window 2's two typology rows the grade
   * came from (`null` bucket = the generic "no damage" shortcut, or a
   * report that never reached window 2). */
  byTypology: Record<string, Record<string, number>>;
}

export interface GroundEffectsDist {
  /** Count of tier-2 reports per `road_damage_level` answer (0-3), among
   * reports that answered it. Confirmed excluded from CDI/EMS intensity
   * (felt-report-science-v1.md D18 R8) — descriptive only. */
  byLevel: Record<string, number>;
}

export function computeDamageDist(reports: readonly Tier2CellReport[]): DamageDist {
  const byGrade: Record<string, number> = {};
  const byTypology: Record<string, Record<string, number>> = {};

  for (const report of reports) {
    const grade = report.answers.buildingDamageLevel;
    if (grade === null || grade === undefined) {
      continue;
    }
    const gradeKey = String(grade);
    byGrade[gradeKey] = (byGrade[gradeKey] ?? 0) + 1;

    const typologyKey = report.answers.damageTypology ?? "none";
    byTypology[typologyKey] ??= {};
    const typologyBucket = byTypology[typologyKey] as Record<string, number>;
    typologyBucket[gradeKey] = (typologyBucket[gradeKey] ?? 0) + 1;
  }

  return { byGrade, byTypology };
}

export function computeGroundEffectsDist(
  reports: readonly Tier2CellReport[],
): GroundEffectsDist {
  const byLevel: Record<string, number> = {};

  for (const report of reports) {
    const level = report.answers.roadDamageLevel;
    if (level === null || level === undefined) {
      continue;
    }
    const key = String(level);
    byLevel[key] = (byLevel[key] ?? 0) + 1;
  }

  return { byLevel };
}
