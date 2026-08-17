import type { BuildingDamageGrade, DamageTypology } from "./types";

/**
 * Window-2 damage-picker constants (2026-08-15 flow restructure, owner
 * directive). Two typology rows, each with the same 5 grades (DG1 = no
 * visible damage, DG5 = partial/full collapse) — see
 * `docs/research/felt-report-science-v1.md`'s 2026-08-15 addendum for the
 * per-grade damage descriptions this label set is drawn from, and
 * `docs/research/cartoon-artwork-brief.md`'s "Damage tiles" section for
 * the matching artwork prompts.
 *
 * Renumbered DG0-DG4 -> DG1-DG5 in the 2026-08-17 update wave (owner
 * directive: "we redefine damage grade always as DG1 to DG5, no more DG0",
 * aligning with the official EMS-98/Grünthal damage grades 1-5) — see
 * `types.ts`'s `BuildingDamageGrade` for the full rationale.
 */

export const DAMAGE_TYPOLOGIES: readonly DamageTypology[] = ["highrise", "lowrise"];

export const BUILDING_DAMAGE_GRADES: readonly BuildingDamageGrade[] = [1, 2, 3, 4, 5];
