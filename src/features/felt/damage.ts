import type { BuildingDamageGrade, DamageTypology } from "./types";

/**
 * Window-2 damage-picker constants (2026-08-15 flow restructure, owner
 * directive). Two typology rows, each with the same 5 grades (0 = no
 * visible damage, 4 = partial/full collapse) — see
 * `docs/research/felt-report-science-v1.md`'s 2026-08-15 addendum for
 * the per-grade damage descriptions this label set is drawn from, and
 * `docs/research/cartoon-artwork-brief.md`'s "Damage tiles" section for
 * the matching artwork prompts.
 */

export const DAMAGE_TYPOLOGIES: readonly DamageTypology[] = ["highrise", "lowrise"];

export const BUILDING_DAMAGE_GRADES: readonly BuildingDamageGrade[] = [0, 1, 2, 3, 4];

/**
 * Severity accent color per damage grade, reusing the app's existing
 * EMS-98 intensity ramp (`theme/semantic.ts`'s `colors.intensity`, indexed
 * I..XII) rather than inventing a second 5-step palette — a damage grade
 * isn't literally an EMS intensity, but sampling 5 points across the same
 * calm→severe ramp keeps the visual language (and the accessibility
 * contrast work already done for that ramp) consistent with the tier-1
 * cartoon grid. Chosen points: 1 (calmest), 4, 6, 9, 12 (most severe).
 */
export const DAMAGE_GRADE_TO_INTENSITY_INDEX: Record<BuildingDamageGrade, number> = {
  0: 1,
  1: 4,
  2: 6,
  3: 9,
  4: 12,
};
