-- 0082: safeguards for the officials' view (security checklist A2.1, audit
-- findings DB-04, DB-15, PRIV-01; owner decisions D104 and 2026-11-23).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- The Government official rank (authority, permission authority.view)
-- opens the Officials page: aggregates by area, and a list of account
-- holders with their name, the town of each home, its building class and
-- their latest I'm safe (0069). Owner decision: keep it, with safeguards.
--
-- 1. Who may give it. A trigger on user_roles (so it holds for every path
--    that writes the table: admin_grant_role in its 0066 or 0076 form,
--    admin_feedback_grant_badge, admin_undo_action) refuses an authority row
--    unless, in a session: the caller is the official account, the session
--    passed two-step sign-in (aal2), and the row is not for the caller.
--    The official account never holds the rank. Calls without a session
--    (SQL editor, pg_cron) may write it, but every row must still carry a
--    reason (note) and an end date (expires_at) at most 12 months after the
--    grant, and belong to a real account, never a guest.
-- 2. user_roles.expires_at: when a rank ends. Only authority uses it. A job
--    every 10 minutes removes authority rows whose end date has passed and
--    writes a role_revoke row (reason authority, note expired) to the
--    activity log; authority_people also checks the date itself.
-- 3. admin_grant_authority(username, reason, ends): the one way the app
--    gives the rank. Same checks with clear error tokens (not_allowed,
--    reason_required, ends_required, ends_invalid, ends_too_long, not_found,
--    not_account); a second call renews the reason and the end date. The
--    activity log records the reason and the end date.
-- 4. authority_people(limit, offset) replaces authority_people(limit):
--    private accounts and accounts without a profile are left out, at most
--    100 people per page (more says whether another page exists), at most
--    20 pages per official in 24 hours (rate_limited after that; views_left
--    says how many remain). The caller must hold an unexpired authority row.
--    Everything shown is as in 0069; every page writes its log row.
-- 5. The dead switch goes: my_authority_sharing(), set_authority_sharing()
--    and the authority_sharing table (nothing read it since 0069). Download
--    my data reports the real state instead: officials_view.shown is true
--    for an account whose profile is public.
-- 6. admin_role_holders() also returns expires_at, so the official sees
--    when a grant ends.
-- 7. A last block checks the result and fails the paste if a part is
--    missing.
--
-- Not touched on purpose: has_permission, admin_grant_role and
-- admin_revoke_role (0076, not yet applied, redefines them; the trigger
-- makes the rules independent of which version is live), and the
-- aggregates authority_overview and authority_event_safety (counts only,
-- groups under 5 hidden). Live on 2026-11-23 nobody holds the rank.
--
-- Needs 0066, 0069, 0077 and 0080 as applied live.

-- 1. The end date ---------------------------------------------------------------------------------
alter table public.user_roles add column if not exists expires_at timestamptz;

-- 2. Who may give the rank (every path) -----------------------------------------------------------
create or replace function public.user_roles_authority_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_official uuid := public.official_account_id();
begin
  if new.role is distinct from 'authority' then
    return new;
  end if;
  if v_uid is not null then
    if v_official is null
       or v_uid <> v_official
       or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
       or new.user_id = v_uid then
      raise exception 'user_roles: not_allowed' using errcode = '42501';
    end if;
  end if;
  if v_official is not null and new.user_id = v_official then
    raise exception 'user_roles: not_allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u
     where u.id = new.user_id and coalesce(u.is_anonymous, false) = false
  ) then
    raise exception 'user_roles: not_account' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(new.note, ''))) < 5 then
    raise exception 'user_roles: reason_required' using errcode = '22023';
  end if;
  if new.expires_at is null then
    raise exception 'user_roles: ends_required' using errcode = '22023';
  end if;
  if new.expires_at > coalesce(new.granted_at, now()) + interval '12 months 1 day' then
    raise exception 'user_roles: ends_too_long' using errcode = '22023';
  end if;
  if new.expires_at <= now() then
    if tg_op = 'INSERT' then
      raise exception 'user_roles: ends_invalid' using errcode = '22023';
    end if;
    if new.expires_at is distinct from old.expires_at then
      raise exception 'user_roles: ends_invalid' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists user_roles_authority_guard on public.user_roles;
create trigger user_roles_authority_guard
  before insert or update on public.user_roles
  for each row execute function public.user_roles_authority_guard();

-- 3. Giving the rank -------------------------------------------------------------------------------
create or replace function public.admin_grant_authority(
  p_username text,
  p_reason text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_official uuid := public.official_account_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_target uuid;
  v_anonymous boolean;
  v_previous jsonb;
begin
  if v_uid is null
     or v_official is null
     or v_uid <> v_official
     or not public.has_permission(v_uid, 'badges.grant')
     or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'admin_grant_authority: not_allowed' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'admin_grant_authority: reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'admin_grant_authority: too_long' using errcode = '22023';
  end if;
  if p_expires_at is null then
    raise exception 'admin_grant_authority: ends_required' using errcode = '22023';
  end if;
  if p_expires_at <= now() then
    raise exception 'admin_grant_authority: ends_invalid' using errcode = '22023';
  end if;
  if p_expires_at > now() + interval '12 months 1 day' then
    raise exception 'admin_grant_authority: ends_too_long' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_grant_authority: not_found' using errcode = 'P0002';
  end if;
  if v_target = v_uid then
    raise exception 'admin_grant_authority: not_allowed' using errcode = '42501';
  end if;
  select coalesce(u.is_anonymous, false) into v_anonymous from auth.users u where u.id = v_target;
  if v_anonymous is null or v_anonymous then
    raise exception 'admin_grant_authority: not_account' using errcode = '22023';
  end if;
  select jsonb_build_object(
           'note', r.note, 'expires_at', r.expires_at,
           'granted_by', r.granted_by, 'granted_at', r.granted_at)
    into v_previous
    from public.user_roles r
   where r.user_id = v_target and r.role = 'authority';
  insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note, expires_at)
  values (v_target, 'authority', null, v_uid, now(), v_reason, p_expires_at)
  on conflict (user_id, role) do update
    set org_name = null,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        note = excluded.note,
        expires_at = excluded.expires_at;
  perform public.write_audit(
    v_uid, 'role_grant', 'rank', v_target::text,
    v_target, null, null, 'authority', v_reason,
    jsonb_build_object('role', 'authority', 'note', v_reason, 'expires_at', p_expires_at, 'previous', v_previous)
  );
  return jsonb_build_object('expires_at', p_expires_at);
end
$$;

-- 4. Ending it on its date -------------------------------------------------------------------------
create or replace function public.expire_authority_ranks()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    delete from public.user_roles u
     where u.role = 'authority'
       and (u.expires_at is null or u.expires_at <= now())
    returning u.user_id, u.role, u.org_name, u.note, u.granted_by, u.granted_at, u.expires_at
  loop
    perform public.write_audit(
      null, 'role_revoke', 'rank', r.user_id::text,
      r.user_id, null, null, 'authority', 'expired',
      jsonb_build_object(
        'role', r.role, 'org_name', r.org_name, 'note', r.note,
        'granted_by', r.granted_by, 'granted_at', r.granted_at, 'expires_at', r.expires_at)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

select cron.schedule('expire_authority_ranks', '*/10 * * * *', $cron$select public.expire_authority_ranks();$cron$);
-- Rows from before this migration have no end date: they end now (none live).
select public.expire_authority_ranks();

-- 5. The list of account holders -------------------------------------------------------------------
drop function if exists public.authority_people(integer);

create or replace function public.authority_people(p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_used integer;
  v_rows jsonb;
  v_ids jsonb;
  v_found integer;
begin
  if v_uid is null
     or not public.has_permission(v_uid, 'authority.view')
     or not exists (
       select 1 from public.user_roles r
        where r.user_id = v_uid and r.role = 'authority' and r.expires_at > now()
     ) then
    raise exception 'authority_people: not_allowed' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority_people:' || v_uid::text, 0));
  select count(*) into v_used
    from public.moderation_log l
   where l.actor_id = v_uid
     and l.action = 'authority_people_view'
     and l.created_at > now() - interval '24 hours';
  if v_used >= 20 then
    raise exception 'authority_people: rate_limited' using errcode = 'P0001';
  end if;

  with candidates as (
    select u.id as user_id, p.username, p.display_name,
           lower(coalesce(p.display_name, p.username, '')) as sort_key
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where coalesce(u.is_anonymous, false) = false
       and p.is_private = false
     order by sort_key, u.id
     limit v_limit + 1 offset v_offset
  ),
  chosen as (
    select c.* from candidates c order by c.sort_key, c.user_id limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', ch.user_id,
           'username', ch.username,
           'display_name', ch.display_name,
           'homes', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'area', public.area_town(h.lat, h.lon),
                      'kind', h.kind,
                      'vc', l.vc_most_likely,
                      'vc_range', l.vc_range)
                    order by h.created_at)
               from public.home_members m
               join public.home_tags h on h.tag_id = m.tag_id and h.status = 'active'
               left join lateral (
                 select a.vc_most_likely, a.vc_range
                   from public.home_assessments a
                  where a.tag_id = h.tag_id
                  order by a.created_at desc
                  limit 1
               ) l on true
              where m.user_id = ch.user_id and m.status = 'approved'
           ), '[]'::jsonb),
           'safe', (
             select jsonb_build_object(
                      'checked_in_at', c.checked_in_at,
                      'event_id', e.event_id,
                      'bumelerze_id', e.bumelerze_id,
                      'magnitude', e.magnitude,
                      'place', e.place,
                      'origin_time', e.origin_time)
               from public.safety_checkins c
               join public.events e on e.event_id = c.event_id
              where c.user_id = ch.user_id and c.status = 'safe'
              order by c.checked_in_at desc
              limit 1
           )) order by ch.sort_key, ch.user_id), '[]'::jsonb),
         coalesce(jsonb_agg(ch.user_id order by ch.sort_key, ch.user_id), '[]'::jsonb),
         (select count(*) from candidates)
    into v_rows, v_ids, v_found
    from chosen ch;

  perform public.write_audit(
    v_uid, 'authority_people_view', 'system', null, null, null, null, null, null,
    jsonb_build_object('count', jsonb_array_length(v_rows), 'offset', v_offset, 'user_ids', v_ids)
  );
  return jsonb_build_object(
    'people', v_rows,
    'more', coalesce(v_found, 0) > v_limit,
    'offset', v_offset,
    'views_left', greatest(20 - v_used - 1, 0)
  );
end
$$;

-- 6. The dead switch and the export ----------------------------------------------------------------
drop function if exists public.set_authority_sharing(boolean);
drop function if exists public.my_authority_sharing();

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  return public.export_my_data_0065()
    || jsonb_build_object(
      'officials_view', jsonb_build_object(
        'shown', coalesce((
          select p.is_private = false
            from public.profiles p
            join auth.users u on u.id = p.user_id
           where p.user_id = v_uid and coalesce(u.is_anonymous, false) = false
        ), false)
      )
    );
end
$$;

drop table if exists public.authority_sharing;

-- 7. Rank holders with their end date --------------------------------------------------------------
drop function if exists public.admin_role_holders();

create or replace function public.admin_role_holders()
returns table (
  holder_id uuid,
  username text,
  display_name text,
  role text,
  org_name text,
  granted_at timestamptz,
  granted_by_name text,
  note text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'badges.grant') then
    raise exception 'admin_role_holders: not allowed' using errcode = '42501';
  end if;
  return query
    select r.user_id, p.username, p.display_name, r.role, r.org_name, r.granted_at,
           g.display_name, r.note, r.expires_at
      from public.user_roles r
      left join public.profiles p on p.user_id = r.user_id
      left join public.profiles g on g.user_id = r.granted_by
     order by r.granted_at desc
     limit 500;
end
$$;

-- 8. Who may call what -----------------------------------------------------------------------------
revoke all on function public.user_roles_authority_guard() from public, anon, authenticated;
revoke all on function public.expire_authority_ranks() from public, anon, authenticated;
revoke all on function public.admin_grant_authority(text, text, timestamptz) from public, anon;
revoke all on function public.authority_people(integer, integer) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.admin_role_holders() from public, anon;
grant execute on function public.admin_grant_authority(text, text, timestamptz) to authenticated;
grant execute on function public.authority_people(integer, integer) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.admin_role_holders() to authenticated;

-- 9. Check -----------------------------------------------------------------------------------------
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_roles' and column_name = 'expires_at'
  ) then
    v_missing := v_missing || 'user_roles.expires_at'::text;
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.user_roles'::regclass
       and tgname = 'user_roles_authority_guard' and not tgisinternal
  ) then
    v_missing := v_missing || 'user_roles_authority_guard trigger'::text;
  end if;
  if to_regprocedure('public.admin_grant_authority(text, text, timestamptz)') is null
     or has_function_privilege('anon', 'public.admin_grant_authority(text, text, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_grant_authority(text, text, timestamptz)', 'execute') then
    v_missing := v_missing || 'admin_grant_authority for authenticated only'::text;
  end if;
  if to_regprocedure('public.authority_people(integer, integer)') is null
     or has_function_privilege('anon', 'public.authority_people(integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.authority_people(integer, integer)', 'execute') then
    v_missing := v_missing || 'authority_people(integer, integer) for authenticated only'::text;
  end if;
  if to_regprocedure('public.authority_people(integer)') is not null then
    v_missing := v_missing || 'authority_people(integer) dropped'::text;
  end if;
  if to_regprocedure('public.expire_authority_ranks()') is null
     or has_function_privilege('authenticated', 'public.expire_authority_ranks()', 'execute')
     or has_function_privilege('anon', 'public.expire_authority_ranks()', 'execute') then
    v_missing := v_missing || 'expire_authority_ranks not callable by clients'::text;
  end if;
  if not exists (select 1 from cron.job where jobname = 'expire_authority_ranks') then
    v_missing := v_missing || 'expire_authority_ranks job'::text;
  end if;
  if to_regprocedure('public.set_authority_sharing(boolean)') is not null
     or to_regprocedure('public.my_authority_sharing()') is not null
     or to_regclass('public.authority_sharing') is not null then
    v_missing := v_missing || 'authority sharing switch removed'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'export_my_data' and p.prosrc like '%officials_view%'
  ) then
    v_missing := v_missing || 'export_my_data officials_view'::text;
  end if;
  if exists (select 1 from public.user_roles r where r.role = 'authority' and r.expires_at is null) then
    v_missing := v_missing || 'authority rows without an end date'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0082: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
