-- 0047: following, private accounts, blocking, reporting a profile, and the
-- public-safe profile page (owner note N4, owner answers of 2026-10-07).
--
-- Privacy rules, in one place:
--   * public_profile(username) is the ONLY way the app reads a profile page.
--     It is SECURITY DEFINER and returns a fixed list of public-safe fields.
--     It never touches felt-report locations, home tags, profession, email,
--     consent records or device ids.
--   * A private account shows name, @username, photo and rank badge to anyone
--     who is not an accepted follower; the rest needs an accepted follow.
--   * Following needs a real account (not an anonymous install) with a profile.
--     Following a private account creates a pending request the owner decides.
--   * Blocking hides the person's comments from the blocker, removes follows in
--     both directions and stops new ones; a blocked person sees "not found".
-- Needs 0043 (is_real_account, has_permission) and 0045 (usernames).

-- 1. Tables ----------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, status);
alter table public.follows enable row level security;
drop policy if exists follows_read_own on public.follows;
create policy follows_read_own on public.follows
  for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());
-- no insert / update / delete policy: only the functions below write.
revoke insert, update, delete on public.follows from anon, authenticated;

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
drop policy if exists blocks_read_own on public.blocks;
create policy blocks_read_own on public.blocks
  for select to authenticated
  using (blocker_id = auth.uid());
revoke insert, update, delete on public.blocks from anon, authenticated;

create table if not exists public.profile_reports (
  report_id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'impersonation', 'private', 'other')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reporter_id, reported_id),
  check (reporter_id <> reported_id)
);
create index if not exists profile_reports_open_idx
  on public.profile_reports (reported_id) where resolved_at is null;
alter table public.profile_reports enable row level security;
drop policy if exists profile_reports_read on public.profile_reports;
create policy profile_reports_read on public.profile_reports
  for select to authenticated
  using (public.has_permission(auth.uid(), 'comments.moderate'));
revoke insert, update, delete on public.profile_reports from anon, authenticated;

-- 2. A blocked person's comments disappear for the blocker ---------------------------
-- (moderators still see everything; authors always see their own)
drop policy if exists event_comments_read on public.event_comments;
create policy event_comments_read on public.event_comments
  for select to anon, authenticated
  using (
    user_id = auth.uid()
    or public.is_moderator(auth.uid())
    or (
      status in ('visible', 'removed')
      and not exists (
        select 1 from public.blocks b
         where b.blocker_id = auth.uid()
           and b.blocked_id = event_comments.user_id
      )
    )
  );

-- 3. Going public again accepts waiting requests ---------------------------------------
create or replace function public.profiles_privacy_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_private and not new.is_private then
    update public.follows
       set status = 'accepted'
     where followee_id = new.user_id and status = 'pending';
  end if;
  return new;
end
$$;
drop trigger if exists profiles_privacy_changed on public.profiles;
create trigger profiles_privacy_changed
  after update of is_private on public.profiles
  for each row execute function public.profiles_privacy_changed();

-- 4. Follow, unfollow, decide a request -------------------------------------------------
-- Error messages carry a short token the app maps to its own words:
-- not_account, profile_required, blocked, not_found, rate_limited.
create or replace function public.follow_user(p_followee uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_private boolean;
  v_status text;
  v_recent integer;
begin
  if not public.is_real_account() then
    raise exception 'follow_user: not_account' using errcode = '42501';
  end if;
  if p_followee is null or p_followee = v_uid then
    raise exception 'follow_user: not_found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = v_uid) then
    raise exception 'follow_user: profile_required' using errcode = '42501';
  end if;
  select p.is_private into v_private from public.profiles p where p.user_id = p_followee;
  if not found then
    raise exception 'follow_user: not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = v_uid and b.blocked_id = p_followee)
        or (b.blocker_id = p_followee and b.blocked_id = v_uid)
  ) then
    raise exception 'follow_user: blocked' using errcode = '42501';
  end if;
  select f.status into v_status
    from public.follows f
   where f.follower_id = v_uid and f.followee_id = p_followee;
  if found then
    return v_status;
  end if;
  select count(*) into v_recent
    from public.follows f
   where f.follower_id = v_uid and f.created_at > now() - interval '1 hour';
  if v_recent >= 60 then
    raise exception 'follow_user: rate_limited' using errcode = '54000';
  end if;
  v_status := case when v_private then 'pending' else 'accepted' end;
  insert into public.follows (follower_id, followee_id, status)
  values (v_uid, p_followee, v_status);
  return v_status;
end
$$;

create or replace function public.unfollow_user(p_followee uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.follows
   where follower_id = auth.uid() and followee_id = p_followee
$$;

create or replace function public.accept_follow_request(p_follower uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.follows
     set status = 'accepted'
   where followee_id = auth.uid() and follower_id = p_follower and status = 'pending'
$$;

create or replace function public.decline_follow_request(p_follower uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.follows
   where followee_id = auth.uid() and follower_id = p_follower and status = 'pending'
$$;

-- 5. Block, unblock, report a profile ----------------------------------------------------
create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'block_user: not_account' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'block_user: not_found' using errcode = '22023';
  end if;
  if (select count(*) from public.blocks b where b.blocker_id = v_uid) >= 500 then
    raise exception 'block_user: rate_limited' using errcode = '54000';
  end if;
  insert into public.blocks (blocker_id, blocked_id)
  values (v_uid, p_user)
  on conflict do nothing;
  delete from public.follows
   where (follower_id = v_uid and followee_id = p_user)
      or (follower_id = p_user and followee_id = v_uid);
end
$$;

create or replace function public.unblock_user(p_user uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user
$$;

create or replace function public.report_profile(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'report_profile: not_account' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_uid
     or p_reason is null
     or p_reason not in ('spam', 'abuse', 'impersonation', 'private', 'other') then
    raise exception 'report_profile: not_found' using errcode = '22023';
  end if;
  if (select count(*) from public.profile_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'report_profile: rate_limited' using errcode = '54000';
  end if;
  insert into public.profile_reports (reporter_id, reported_id, reason)
  values (v_uid, p_user, p_reason)
  on conflict (reporter_id, reported_id) do update
    set reason = excluded.reason, created_at = now(), resolved_at = null;
end
$$;

-- Moderators: open profile reports grouped by person; and closing them.
create or replace function public.moderation_profile_reports()
returns table (
  reported_id uuid,
  username text,
  display_name text,
  report_count integer,
  last_reason text,
  last_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'moderation_profile_reports: moderators only' using errcode = '42501';
  end if;
  return query
    select r.reported_id, p.username, p.display_name, count(*)::integer,
           (array_agg(r.reason order by r.created_at desc))[1],
           max(r.created_at)
      from public.profile_reports r
      left join public.profiles p on p.user_id = r.reported_id
     where r.resolved_at is null
     group by r.reported_id, p.username, p.display_name
     order by count(*) desc, max(r.created_at) desc
     limit 100;
end
$$;

create or replace function public.resolve_profile_reports(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'resolve_profile_reports: moderators only' using errcode = '42501';
  end if;
  update public.profile_reports
     set resolved_at = now()
   where reported_id = p_user and resolved_at is null;
  insert into public.moderation_log (actor_id, action, target_user_id)
  values (auth.uid(), 'profile_reports_resolve', p_user);
end
$$;

-- 6. The viewer's own lists -------------------------------------------------------------
create or replace function public.my_following_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(f.followee_id), '{}'::uuid[])
    from public.follows f
   where f.follower_id = auth.uid() and f.status = 'accepted'
$$;

create or replace function public.my_follow_requests()
returns table (
  person_id uuid,
  username text,
  display_name text,
  avatar_path text,
  roles jsonb,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
    select p.user_id, p.username, p.display_name, p.avatar_path,
           coalesce((select jsonb_agg(jsonb_build_object('role', ur.role, 'org_name', ur.org_name))
                       from public.user_roles ur where ur.user_id = p.user_id), '[]'::jsonb),
           f.created_at
      from public.follows f
      join public.profiles p on p.user_id = f.follower_id
     where f.followee_id = auth.uid()
       and f.status = 'pending'
       and not exists (select 1 from public.blocks b
                        where b.blocker_id = auth.uid() and b.blocked_id = f.follower_id)
     order by f.created_at desc
     limit 100;
end
$$;

create or replace function public.my_blocks()
returns table (
  person_id uuid,
  username text,
  display_name text,
  avatar_path text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
    select b.blocked_id, p.username, p.display_name, p.avatar_path
      from public.blocks b
      left join public.profiles p on p.user_id = b.blocked_id
     where b.blocker_id = auth.uid()
     order by b.created_at desc
     limit 200;
end
$$;

-- 7. Follower / following lists, respecting privacy -------------------------------------
create or replace function public.follow_list(p_username text, p_kind text, p_limit integer default 100)
returns table (
  person_id uuid,
  username text,
  display_name text,
  avatar_path text,
  roles jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_private boolean;
begin
  if p_kind not in ('followers', 'following') then
    raise exception 'follow_list: kind must be followers or following' using errcode = '22023';
  end if;
  select p.user_id, p.is_private into v_target, v_private
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    return;
  end if;
  -- blocked either way: nothing
  if v_viewer is not null and exists (
    select 1 from public.blocks b
     where (b.blocker_id = v_viewer and b.blocked_id = v_target)
        or (b.blocker_id = v_target and b.blocked_id = v_viewer)
  ) then
    return;
  end if;
  -- private: only the person and accepted followers
  if v_private and v_viewer is distinct from v_target and not exists (
    select 1 from public.follows f
     where f.follower_id = v_viewer and f.followee_id = v_target and f.status = 'accepted'
  ) then
    return;
  end if;
  return query
    select p.user_id, p.username, p.display_name, p.avatar_path,
           coalesce((select jsonb_agg(jsonb_build_object('role', ur.role, 'org_name', ur.org_name))
                       from public.user_roles ur where ur.user_id = p.user_id), '[]'::jsonb)
      from public.follows f
      join public.profiles p
        on p.user_id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
     where f.status = 'accepted'
       and case when p_kind = 'followers' then f.followee_id else f.follower_id end = v_target
       and not exists (
         select 1 from public.blocks b
          where (b.blocker_id = v_viewer and b.blocked_id = p.user_id)
             or (b.blocker_id = p.user_id and b.blocked_id = v_viewer)
       )
     order by f.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end
$$;

-- 8. The public profile page --------------------------------------------------------------
-- The fixed answer of public_profile(). Public-safe fields only. NEVER here:
-- felt-report locations, home tags or household links, profession, email,
-- consent records, device ids. Returns null when the person does not exist or
-- has blocked the viewer (so a block leaks nothing).
create or replace function public.public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer uuid := auth.uid();
  v_name text := lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  v_id uuid;
  v_username text;
  v_display text;
  v_avatar text;
  v_private boolean;
  v_since timestamptz;
  v_self boolean;
  v_status text;
  v_blocked boolean;
  v_full boolean;
  v_hide boolean;
  v_roles jsonb;
  v_base jsonb;
begin
  select p.user_id, p.username, p.display_name, p.avatar_path, p.is_private, p.created_at
    into v_id, v_username, v_display, v_avatar, v_private, v_since
    from public.profiles p
   where lower(p.username) = v_name;
  if not found then
    return null;
  end if;
  if v_viewer is not null and exists (
    select 1 from public.blocks b where b.blocker_id = v_id and b.blocked_id = v_viewer
  ) then
    return null;
  end if;

  v_self := v_viewer is not null and v_viewer = v_id;
  select f.status into v_status
    from public.follows f
   where f.follower_id = v_viewer and f.followee_id = v_id;
  v_blocked := v_viewer is not null and exists (
    select 1 from public.blocks b where b.blocker_id = v_viewer and b.blocked_id = v_id
  );
  v_full := not v_blocked and (not v_private or v_self or v_status = 'accepted');
  v_roles := coalesce((
    select jsonb_agg(jsonb_build_object('role', ur.role, 'org_name', ur.org_name))
      from public.user_roles ur where ur.user_id = v_id
  ), '[]'::jsonb);

  v_base := jsonb_build_object(
    'user_id', v_id,
    'username', v_username,
    'display_name', v_display,
    'avatar_path', v_avatar,
    'is_private', v_private,
    'roles', v_roles,
    'is_self', v_self,
    'follow_status', coalesce(v_status, 'none'),
    'is_blocked', v_blocked,
    'can_view_full', v_full
  );
  if not v_full then
    return v_base;
  end if;

  select coalesce(pp.hide_badges, false) into v_hide
    from (select 1) one
    left join public.profile_private pp on pp.user_id = v_id;

  return v_base || jsonb_build_object(
    'member_since', v_since,
    'followers', (select count(*) from public.follows f where f.followee_id = v_id and f.status = 'accepted'),
    'following', (select count(*) from public.follows f where f.follower_id = v_id and f.status = 'accepted'),
    'comments', (select count(*) from public.event_comments c where c.user_id = v_id and c.status = 'visible'),
    'helpful_received', (select coalesce(sum(c.helpful_count), 0) from public.event_comments c where c.user_id = v_id and c.status = 'visible'),
    'badges_hidden', v_hide,
    'milestones', case when v_hide then null else jsonb_build_object(
      'reports', (select count(*) from public.felt_reports r where r.user_id = v_id),
      'detailed_reports', (select count(*) from public.felt_reports r
         where r.user_id = v_id
           and exists (select 1 from public.felt_report_details d where d.felt_report_id = r.report_id)),
      'photo_reports', (select count(*) from public.felt_reports r
         where r.user_id = v_id
           and exists (select 1 from public.felt_photos ph where ph.report_id = r.report_id))
    ) end,
    'recent_comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'comment_id', rc.comment_id,
               'body', left(rc.body, 280),
               'created_at', rc.created_at,
               'helpful_count', rc.helpful_count,
               'hub_id', e.bumelerze_id,
               'place', e.place,
               'magnitude', e.magnitude
             ) order by rc.created_at desc)
        from (
          select cc.comment_id, cc.event_id, cc.body, cc.created_at, cc.helpful_count
            from public.event_comments cc
           where cc.user_id = v_id and cc.status = 'visible'
           order by cc.created_at desc
           limit 10
        ) rc
        join public.events e on e.event_id = rc.event_id
    ), '[]'::jsonb)
  );
end
$$;

-- Grants ------------------------------------------------------------------------------------
revoke all on function public.profiles_privacy_changed() from public, anon, authenticated;
revoke all on function public.follow_user(uuid) from public, anon;
revoke all on function public.unfollow_user(uuid) from public, anon;
revoke all on function public.accept_follow_request(uuid) from public, anon;
revoke all on function public.decline_follow_request(uuid) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.report_profile(uuid, text) from public, anon;
revoke all on function public.moderation_profile_reports() from public, anon;
revoke all on function public.resolve_profile_reports(uuid) from public, anon;
revoke all on function public.my_following_ids() from public, anon;
revoke all on function public.my_follow_requests() from public, anon;
revoke all on function public.my_blocks() from public, anon;
revoke all on function public.follow_list(text, text, integer) from public;
revoke all on function public.public_profile(text) from public;

grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.accept_follow_request(uuid) to authenticated;
grant execute on function public.decline_follow_request(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.report_profile(uuid, text) to authenticated;
grant execute on function public.moderation_profile_reports() to authenticated;
grant execute on function public.resolve_profile_reports(uuid) to authenticated;
grant execute on function public.my_following_ids() to authenticated;
grant execute on function public.my_follow_requests() to authenticated;
grant execute on function public.my_blocks() to authenticated;
grant execute on function public.follow_list(text, text, integer) to anon, authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
