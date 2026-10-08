-- 0057: "I'm safe" check-in v1, and an owner can remove a home member.
-- Design note: im-safe-design-2026-10-08 in the project brain (D78 answer 4,
-- D79, D80). One state only ("safe"). A check-in is a statement about an
-- EARTHQUAKE and a TIME, never about a place:
--
--   * safety_checkins has no coordinate, geohash, accuracy, device id or free
--     text column. The phone decides on its own whether to ask (it never sends
--     its location for that); the server only stores who, which event, when.
--   * Nobody reads the table directly (RLS on, no policy, privileges revoked).
--     Reads go through two fixed functions:
--       my_checkins()        the caller's own rows (30 days)
--       family_checkins(tag) approved members of that ACTIVE home only. A
--                            member's rows are shown when (a) they share
--                            check-ins with this home (home_members
--                            .share_checkins, default on, each member's own
--                            switch), (b) the row was made after the reader
--                            was approved into the home, and (c) there is no
--                            block between the two, in either direction.
--                            Returns the event's public fields only.
--   * Writes go through check_in() and retract_checkin() only. Accounts only:
--     a guest has no family to show it to, so a guest gets the share sheet and
--     no server row (design note Q5).
--   * check_in() is idempotent on the phone's client_id (unique). Undo calls
--     retract_checkin(); if Undo reaches the server before the check-in does,
--     a "retracted" tombstone is written so the late check-in cannot revive.
--   * Rows are deleted 30 days after they were made (nightly job below), and
--     with the account (foreign key on delete cascade).
--
-- Prerequisite from the design note: remove_home_member() for owners, with a
-- 10-minute undo memory (home_member_undo, same idea as 0053 follow_undo)
-- used only by restore_home_member(). The memory is purged after a day.
--
-- No admin function reads any of this; nothing here writes audit rows.
-- Safe to run twice. Written for the SQL Editor as one line: no line
-- comments after code, no transaction statements.

-- 1. Each member's switch: show my check-ins to this home ----------------------------------
alter table public.home_members add column if not exists share_checkins boolean not null default true;

-- 2. The check-ins -------------------------------------------------------------------------
create table if not exists public.safety_checkins (
  checkin_id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid references public.events (event_id) on delete cascade,
  status text not null default 'safe' check (status in ('safe', 'retracted')),
  checked_in_at timestamptz not null,
  created_at timestamptz not null default now(),
  retracted_at timestamptz,
  check (status = 'retracted' or event_id is not null)
);
create index if not exists safety_checkins_user_idx on public.safety_checkins (user_id, created_at desc);
create index if not exists safety_checkins_created_idx on public.safety_checkins (created_at);
alter table public.safety_checkins enable row level security;
revoke all on public.safety_checkins from public, anon, authenticated;

-- 3. Undo memory for a removed member (owner only, 10 minutes) ------------------------------
create table if not exists public.home_member_undo (
  tag_id uuid not null references public.home_tags (tag_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  removed_by uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  status text not null check (status in ('pending', 'approved')),
  requested_at timestamptz not null,
  decided_at timestamptz,
  share_checkins boolean not null default true,
  removed_at timestamptz not null default now(),
  primary key (tag_id, user_id)
);
alter table public.home_member_undo enable row level security;
revoke all on public.home_member_undo from public, anon, authenticated;

-- 4. Check in ------------------------------------------------------------------------------
-- Errors (message prefix "check_in: "): not_account (42501), event_not_found
-- (22023), event_too_old (22023), rate_limited (54000), conflict (22023).
-- The phone's own time is kept but clamped: never in the future, never before
-- the earthquake, never older than 72 hours.
create or replace function public.check_in(p_client_id uuid, p_event_id uuid, p_checked_in_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_origin timestamptz;
  v_at timestamptz;
  v_recent integer;
  v_row public.safety_checkins%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'check_in: not_account' using errcode = '42501';
  end if;
  if p_client_id is null or p_event_id is null then
    raise exception 'check_in: event_not_found' using errcode = '22023';
  end if;

  select * into v_row from public.safety_checkins where client_id = p_client_id;
  if found then
    if v_row.user_id <> v_uid then
      raise exception 'check_in: conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'client_id', v_row.client_id, 'status', v_row.status,
      'event_id', v_row.event_id, 'checked_in_at', v_row.checked_in_at
    );
  end if;

  select e.origin_time into v_origin
    from public.events e
   where e.event_id = p_event_id and e.review_status <> 'deleted';
  if v_origin is null then
    raise exception 'check_in: event_not_found' using errcode = '22023';
  end if;
  if v_origin < now() - interval '72 hours' or v_origin > now() + interval '10 minutes' then
    raise exception 'check_in: event_too_old' using errcode = '22023';
  end if;

  select count(*) into v_recent
    from public.safety_checkins c
   where c.user_id = v_uid and c.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'check_in: rate_limited' using errcode = '54000';
  end if;

  v_at := least(coalesce(p_checked_in_at, now()), now());
  v_at := greatest(v_at, v_origin, now() - interval '72 hours');

  insert into public.safety_checkins (client_id, user_id, event_id, status, checked_in_at)
  values (p_client_id, v_uid, p_event_id, 'safe', v_at)
  on conflict (client_id) do nothing;

  select * into v_row from public.safety_checkins where client_id = p_client_id;
  if v_row.user_id <> v_uid then
    raise exception 'check_in: conflict' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'client_id', v_row.client_id, 'status', v_row.status,
    'event_id', v_row.event_id, 'checked_in_at', v_row.checked_in_at
  );
end
$$;

-- 5. Undo / take back a check-in -----------------------------------------------------------
-- Works on the caller's own row only. When the row is not there yet (Undo
-- overtook the check-in on a slow network), a tombstone keeps the client_id,
-- so the late check_in() returns "retracted" instead of creating a row.
-- A client_id that belongs to somebody else is left alone, silently.
create or replace function public.retract_checkin(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'retract_checkin: not_account' using errcode = '42501';
  end if;
  if p_client_id is null then
    return;
  end if;
  update public.safety_checkins
     set status = 'retracted', retracted_at = coalesce(retracted_at, now())
   where client_id = p_client_id and user_id = v_uid;
  if not found then
    insert into public.safety_checkins (client_id, user_id, event_id, status, checked_in_at, retracted_at)
    values (p_client_id, v_uid, null, 'retracted', now(), now())
    on conflict (client_id) do nothing;
  end if;
end
$$;

-- 6. My own check-ins (last 30 days) -------------------------------------------------------
create or replace function public.my_checkins()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'client_id', c.client_id,
           'event_id', c.event_id,
           'status', c.status,
           'checked_in_at', c.checked_in_at
         ) order by c.created_at desc), '[]'::jsonb)
    from public.safety_checkins c
   where c.user_id = auth.uid()
     and c.created_at > now() - interval '30 days'
$$;

-- 7. Family status of one home -------------------------------------------------------------
-- { "my_share": the caller's own switch for this home,
--   "sharing": [user ids whose status this reader may see, self included],
--   "checkins": [{ user_id, checked_in_at, event_id, bumelerze_id, magnitude,
--                  place, origin_time }] }  newest first, last 7 days, at most
-- 5 per person. The event is the surviving one when it was merged. No
-- coordinates of any kind.
create or replace function public.family_checkins(p_tag uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
begin
  if v_uid is null
     or not public.is_home_member(p_tag)
     or not exists (select 1 from public.home_tags t where t.tag_id = p_tag and t.status = 'active') then
    raise exception 'family_checkins: members only' using errcode = '42501';
  end if;
  select coalesce(m.decided_at, m.requested_at) into v_since
    from public.home_members m
   where m.tag_id = p_tag and m.user_id = v_uid;

  return jsonb_build_object(
    'my_share', (
      select m.share_checkins from public.home_members m
       where m.tag_id = p_tag and m.user_id = v_uid
    ),
    'sharing', coalesce((
      select jsonb_agg(m.user_id order by m.requested_at)
        from public.home_members m
       where m.tag_id = p_tag
         and m.status = 'approved'
         and (
           m.user_id = v_uid
           or (
             m.share_checkins
             and not exists (
               select 1 from public.blocks b
                where (b.blocker_id = v_uid and b.blocked_id = m.user_id)
                   or (b.blocker_id = m.user_id and b.blocked_id = v_uid)
             )
           )
         )
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', x.user_id,
               'checked_in_at', x.checked_in_at,
               'event_id', x.event_id,
               'bumelerze_id', x.bumelerze_id,
               'magnitude', x.magnitude,
               'place', x.place,
               'origin_time', x.origin_time
             ) order by x.checked_in_at desc)
        from (
          select c.user_id, c.checked_in_at, e.event_id, e.bumelerze_id, e.magnitude, e.place, e.origin_time,
                 row_number() over (partition by c.user_id order by c.checked_in_at desc) as n
            from public.safety_checkins c
            join public.home_members m
              on m.tag_id = p_tag and m.user_id = c.user_id and m.status = 'approved'
            join public.events e0 on e0.event_id = c.event_id
            join public.events e on e.event_id = coalesce(e0.merged_into, e0.event_id)
           where c.status = 'safe'
             and c.created_at > now() - interval '7 days'
             and (
               c.user_id = v_uid
               or (
                 m.share_checkins
                 and c.created_at >= v_since
                 and not exists (
                   select 1 from public.blocks b
                    where (b.blocker_id = v_uid and b.blocked_id = c.user_id)
                       or (b.blocker_id = c.user_id and b.blocked_id = v_uid)
                 )
               )
             )
        ) x
       where x.n <= 5
    ), '[]'::jsonb)
  );
end
$$;

-- 8. My switch for one home ----------------------------------------------------------------
create or replace function public.set_checkin_sharing(p_tag uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_on is null then
    raise exception 'set_checkin_sharing: members only' using errcode = '42501';
  end if;
  update public.home_members
     set share_checkins = p_on
   where tag_id = p_tag and user_id = auth.uid() and status = 'approved';
  if not found then
    raise exception 'set_checkin_sharing: members only' using errcode = '42501';
  end if;
end
$$;

-- 9. Owner removes a member, and can undo it for 10 minutes -------------------------------
-- Errors: owners only (42501), cannot_remove_owner (22023), not_found (22023),
-- undo_expired (22023).
create or replace function public.remove_home_member(p_tag uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.home_members%rowtype;
begin
  if not public.is_home_owner(p_tag) then
    raise exception 'remove_home_member: owners only' using errcode = '42501';
  end if;
  select * into v_m from public.home_members where tag_id = p_tag and user_id = p_user;
  if not found then
    raise exception 'remove_home_member: not_found' using errcode = '22023';
  end if;
  if v_m.role = 'owner' or p_user = auth.uid() then
    raise exception 'remove_home_member: cannot_remove_owner' using errcode = '22023';
  end if;
  insert into public.home_member_undo (tag_id, user_id, removed_by, role, status, requested_at, decided_at, share_checkins, removed_at)
  values (v_m.tag_id, v_m.user_id, auth.uid(), v_m.role, v_m.status, v_m.requested_at, v_m.decided_at, v_m.share_checkins, now())
  on conflict (tag_id, user_id) do update
    set removed_by = excluded.removed_by,
        role = excluded.role,
        status = excluded.status,
        requested_at = excluded.requested_at,
        decided_at = excluded.decided_at,
        share_checkins = excluded.share_checkins,
        removed_at = excluded.removed_at;
  delete from public.home_members where tag_id = p_tag and user_id = p_user;
end
$$;

create or replace function public.restore_home_member(p_tag uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_u public.home_member_undo%rowtype;
begin
  if not public.is_home_owner(p_tag) then
    raise exception 'restore_home_member: owners only' using errcode = '42501';
  end if;
  select * into v_u
    from public.home_member_undo
   where tag_id = p_tag and user_id = p_user
     and removed_by = auth.uid()
     and removed_at > now() - interval '10 minutes';
  if not found then
    raise exception 'restore_home_member: undo_expired' using errcode = '22023';
  end if;
  insert into public.home_members (tag_id, user_id, role, status, requested_at, decided_at, share_checkins)
  values (v_u.tag_id, v_u.user_id, v_u.role, v_u.status, v_u.requested_at, v_u.decided_at, v_u.share_checkins)
  on conflict (tag_id, user_id) do nothing;
  delete from public.home_member_undo where tag_id = p_tag and user_id = p_user;
end
$$;

-- 10. Nightly purge: check-ins after 30 days, undo memory after a day ----------------------
create or replace function public.purge_safety_checkins()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_checkins integer;
  n_undo integer;
begin
  delete from public.safety_checkins where created_at < now() - interval '30 days';
  get diagnostics n_checkins = row_count;
  delete from public.home_member_undo where removed_at < now() - interval '1 day';
  get diagnostics n_undo = row_count;
  return jsonb_build_object('checkins', n_checkins, 'member_undo', n_undo);
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_safety_checkins') then
    perform cron.unschedule('purge_safety_checkins');
  end if;
  perform cron.schedule('purge_safety_checkins', '35 3 * * *', $cron$select public.purge_safety_checkins();$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule purge_safety_checkins by hand: select cron.schedule(''purge_safety_checkins'', ''35 3 * * *'', ''select public.purge_safety_checkins();'');', sqlerrm;
end
$$;

-- 11. Who may call what --------------------------------------------------------------------
revoke all on function public.check_in(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.retract_checkin(uuid) from public, anon;
revoke all on function public.my_checkins() from public, anon;
revoke all on function public.family_checkins(uuid) from public, anon;
revoke all on function public.set_checkin_sharing(uuid, boolean) from public, anon;
revoke all on function public.remove_home_member(uuid, uuid) from public, anon;
revoke all on function public.restore_home_member(uuid, uuid) from public, anon;
revoke all on function public.purge_safety_checkins() from public, anon, authenticated;
grant execute on function public.check_in(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.retract_checkin(uuid) to authenticated;
grant execute on function public.my_checkins() to authenticated;
grant execute on function public.family_checkins(uuid) to authenticated;
grant execute on function public.set_checkin_sharing(uuid, boolean) to authenticated;
grant execute on function public.remove_home_member(uuid, uuid) to authenticated;
grant execute on function public.restore_home_member(uuid, uuid) to authenticated;
grant execute on function public.purge_safety_checkins() to service_role;
