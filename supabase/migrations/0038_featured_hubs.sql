-- 0038: featured Event hubs (owner, 2026-10-04). A featured hub is always
-- open, whatever its age or report count — first the 12 November 2017
-- Halabja–Sarpol-e Zahab M7.3 (bml20170001), the shared memory of the
-- region and the showcase/reference hub people can talk about their own
-- experience in. Switch more on or off here, without an app release.
alter table public.events add column if not exists hub_featured boolean not null default false;

update public.events set hub_featured = true where bumelerze_id = 'bml20170001';

create or replace function public.event_hub_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.felt_reports where event_id = p_event_id),
    'people', (select count(distinct coalesce(user_id::text, device_id)) from public.felt_reports where event_id = p_event_id),
    'levels', coalesce((
      select jsonb_object_agg(cartoon_level::text, n) from (
        select cartoon_level, count(*) as n from public.felt_reports
        where event_id = p_event_id group by cartoon_level
      ) l
    ), '{}'::jsonb),
    'first_report_at', (select min(created_at) from public.felt_reports where event_id = p_event_id),
    'comments', (select count(*) from public.event_comments where event_id = p_event_id and status = 'visible'),
    'featured', coalesce((select hub_featured from public.events where event_id = p_event_id), false)
  )
$$;
