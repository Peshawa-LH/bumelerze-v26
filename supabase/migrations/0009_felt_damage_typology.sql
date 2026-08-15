-- 0009: felt-report flow redesign (2026-08-15 owner directive) — window 2's
-- two-typology, 5-grade damage picker supersedes the old Q10 questionnaire
-- answer on `felt_report_details.building_damage_level`. Additive-only per
-- this repo's migration convention (0007/0008's own comments): a new
-- numbered file, never a hand-edit of 0003_felt_reports.sql. Like every
-- migration in this repo so far, this has never been applied against a live
-- database (PROJECT.md "Blocked on Peshawa": no Supabase project yet).
--
-- Two changes to `felt_report_details`:
--   1. `damage_typology` (NEW) — which of window 2's two rows ("high-rise
--      building" vs "single/low-rise structure, Iraqi-typical") the grade
--      came from. NULL for the generic "I didn't see damage" shortcut
--      (grade 0, no typology implied) as well as for any report that never
--      reached window 2 at all (tier-1-only, or an older client version).
--      A vulnerability-class hint, not a CDI/EMS index itself — see
--      `docs/research/felt-report-science-v1.md`'s 2026-08-15 addendum,
--      [REVIEW — Peshawa].
--   2. `building_damage_level`'s CHECK widens 0-3 -> 0-4 (5 grades: 0 = no
--      visible damage, 4 = partial/full collapse) to hold window 2's grade
--      instead of the old Q10 4-level answer. The column itself, its type,
--      and its name are all unchanged — only the allowed range grows by one
--      step, so this is additive from the schema's point of view even
--      though it touches an existing constraint.

alter table public.felt_report_details
  drop constraint felt_report_details_building_damage_level_check;

alter table public.felt_report_details
  add constraint felt_report_details_building_damage_level_check
    check (building_damage_level between 0 and 4);

alter table public.felt_report_details
  add column damage_typology text
    check (damage_typology in ('highrise', 'lowrise'));

comment on column public.felt_report_details.building_damage_level is
  '2026-08-15 flow restructure: 0-4 grade from window 2''s damage picker (0 = no visible damage, 4 = partial/full collapse), superseding the old Q10 questionnaire answer (was 0-3). Proposed damage-index mapping in the science pack''s 2026-08-15 addendum, [REVIEW — Peshawa].';

comment on column public.felt_report_details.damage_typology is
  '2026-08-15 flow restructure: which of window 2''s two rows (highrise = RC-frame high-rise, lowrise = single/low-rise, Iraqi-typical) the building_damage_level grade came from. NULL for the generic "no damage" shortcut or for reports that never reached window 2. Vulnerability-class hint for the R7 EMS path (science pack), not a CDI/EMS index itself.';
