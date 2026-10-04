-- 0039: which of my reports still exist (owner, 2026-10-04: "I can still see
-- past felt reports from my devices"). My Data lists the reports this phone
-- sent from its own local record and never asked the server, so rows removed
-- server-side (a cleanup, moderation) lived on in the list. The phone now
-- asks which of its report ids are still there and forgets the rest.
--
-- Not a select policy: felt_reports_select_own only matches the current
-- auth.uid(), and a phone's older reports can sit under a previous anonymous
-- identity or, after "delete my account", under none (user_id null). The
-- report ids are client-generated random UUIDs held only by that phone, and
-- the device id must match too, so the answer reveals nothing beyond "still
-- there" to anyone else.
create or replace function public.existing_report_ids(p_report_ids uuid[], p_device_id text)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select report_id from public.felt_reports
  where report_id = any(p_report_ids[1:500]) and device_id = p_device_id
$$;

revoke all on function public.existing_report_ids(uuid[], text) from public;
grant execute on function public.existing_report_ids(uuid[], text) to anon, authenticated;
