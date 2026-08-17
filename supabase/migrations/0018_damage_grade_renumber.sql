-- 0018: damage-grade renumber DG0-DG4 -> DG1-DG5 (2026-08-17 update wave,
-- owner directive: "we redefine damage grade always as DG1 to DG5, no more
-- DG0" — aligns with the official EMS-98/Grünthal damage grades 1-5).
-- `felt_report_details.building_damage_level`'s CHECK widens 0-4 -> 1-5
-- (migration 0009 had already widened it 0-3 -> 0-4). EXISTING ROWS are
-- shifted +1 so the column keeps ONE meaning for its whole life (0 -> 1,
-- 1 -> 2, ..., 4 -> 5) rather than leaving a permanent "before/after" seam
-- where the same stored number means two different grades depending on
-- when the row was written.
--
-- Idempotent/defensive: this whole migration is a no-op if it has already
-- run (or if the constraint is already 1-5 for any other reason) — it
-- inspects the LIVE constraint definition rather than assuming a fixed
-- starting state, so re-running this file against an already-migrated
-- database does not double-shift the data.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.felt_report_details'::regclass
      and conname = 'felt_report_details_building_damage_level_check'
      and pg_get_constraintdef(oid) ilike '%>= 0%'
  ) then
    -- Shift every existing non-null grade up by one BEFORE widening the
    -- constraint, so there is never a moment where a 0-valued row would
    -- violate the new 1-5 range.
    update public.felt_report_details
      set building_damage_level = building_damage_level + 1
      where building_damage_level is not null;

    alter table public.felt_report_details
      drop constraint felt_report_details_building_damage_level_check;

    alter table public.felt_report_details
      add constraint felt_report_details_building_damage_level_check
        check (building_damage_level between 1 and 5);
  end if;
end
$$;

comment on column public.felt_report_details.building_damage_level is
  '2026-08-17 renumber (migration 0018): 1-5 grade from window 2''s damage picker (1 = no visible damage, 5 = partial/full collapse), DG1-DG5 per the official EMS-98/Grünthal scale. Was 0-4 (migration 0009); existing rows shifted +1 by this migration so the column has one consistent meaning. Proposed damage-index mapping in the science pack''s 2026-08-15 addendum, [REVIEW — Peshawa].';

comment on column public.felt_report_details.damage_typology is
  '2026-08-17 renumber (migration 0018): which of window 2''s two rows (highrise = RC-frame high-rise, lowrise = single/low-rise, Iraqi-typical) the building_damage_level grade (now DG1-DG5) came from. NULL for the generic "no damage" shortcut (grade 1) or for reports that never reached window 2. Vulnerability-class hint for the R7 EMS path (science pack), not a CDI/EMS index itself.';
