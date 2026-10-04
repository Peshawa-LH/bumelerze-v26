-- 0040: my_stats() — the numbers on the "My account" page in one round trip
-- (account page redesign, owner 2026-10-04): reports sent, how many carried
-- the detailed answers or a photo, visible comments, helpful marks received,
-- whether the household is linked, and when the profile was made.
--
-- One call instead of four counts, which matters on weak networks. It also
-- works for anonymous-auth installs (they hold the `authenticated` role), so
-- the Reports figure and the first badges follow a device that never signed
-- up. Everything is filtered by auth.uid(); the function returns exactly one
-- row (zeros / null when there is nothing or no session), and never anything
-- about another person.
--
-- Columns checked against the real schema:
--   felt_reports.user_id                      (0003)
--   felt_report_details.felt_report_id        (0003, one-to-one, no user_id)
--   felt_photos.report_id                     (0003)
--   event_comments.user_id / status / helpful_count   (0036)
--   home_members.tag_id / user_id / status    (0037)
--   profiles.user_id / created_at             (0035)
create or replace function public.my_stats()
returns table (
  member_since timestamptz,
  reports integer,
  detailed_reports integer,
  photo_reports integer,
  comments integer,
  helpful_received integer,
  family_linked boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select p.created_at
       from public.profiles p
      where p.user_id = auth.uid()),
    (select count(*)::integer
       from public.felt_reports r
      where r.user_id = auth.uid()),
    (select count(*)::integer
       from public.felt_reports r
      where r.user_id = auth.uid()
        and exists (select 1 from public.felt_report_details d
                     where d.felt_report_id = r.report_id)),
    (select count(*)::integer
       from public.felt_reports r
      where r.user_id = auth.uid()
        and exists (select 1 from public.felt_photos ph
                     where ph.report_id = r.report_id)),
    (select count(*)::integer
       from public.event_comments c
      where c.user_id = auth.uid()
        and c.status = 'visible'),
    (select coalesce(sum(c.helpful_count), 0)::integer
       from public.event_comments c
      where c.user_id = auth.uid()
        and c.status = 'visible'),
    exists (
      select 1
        from public.home_members m
       where m.user_id = auth.uid()
         and m.status = 'approved'
         and (select count(*)
                from public.home_members o
               where o.tag_id = m.tag_id
                 and o.status = 'approved') >= 2
    )
$$;

revoke all on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;

comment on function public.my_stats() is
  'Own-account counters for the My account page: reports, detailed, photo, visible comments, helpful received, household linked, member since. One row, auth.uid() only.';
