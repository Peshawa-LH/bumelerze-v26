-- 0050: text posts on public profiles (owner, 2026-10-08: "add to the public
-- account the ability to post something inside your public account, for now
-- only text").
--
-- Who sees a post (one function, `can_view_posts_of`, used by the read policy):
--   * the author always sees their own posts (also a removed one, as a notice);
--   * everyone, signed in or not, sees the visible posts of a public account;
--   * only accepted followers see the visible posts of a private account;
--   * a block hides posts in BOTH directions (the blocker and the blocked
--     person never read each other's posts);
--   * moderators read reported posts through post_queue(), not through the
--     table, so a private account stays private even from them until reported.
--
-- Who writes: a real account (not an anonymous install) with a @username, for
-- themselves only, at most 10 posts an hour. The server decides status, time
-- and trimming whatever the client sends. The author may edit the text or
-- delete the post (a real delete: it is their own data). Moderation is a soft
-- remove (status 'removed', text cleared) by the new permission `posts.delete`,
-- which only the official rank holds, mirroring `comments.delete`.
--
-- Needs 0043 (is_real_account, has_permission, moderation_log, role_permissions),
-- 0045 (usernames) and 0047 (follows, blocks, public_profile).
-- Idempotent: safe to run twice.

-- 1. Permission --------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('official', 'posts.delete')
on conflict do nothing;

-- 2. Moderation log learns about posts ----------------------------------------------
-- Dropped by shape, not by name, so a differently named constraint cannot linger.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%comment_approve%'
  loop
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.moderation_log drop constraint if exists moderation_log_action_check;
alter table public.moderation_log
  add constraint moderation_log_action_check
  check (action in (
    'comment_approve', 'comment_hide', 'comment_remove',
    'role_grant', 'role_revoke', 'profile_reports_resolve',
    'post_remove', 'post_reports_dismiss'
  ));

-- 3. Posts ---------------------------------------------------------------------------
create table if not exists public.profile_posts (
  post_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  status text not null default 'visible' check (status in ('visible', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null,
  removed_reason text check (removed_reason is null or char_length(removed_reason) <= 200),
  constraint profile_posts_body_check
    check (char_length(body) <= 500 and (status = 'removed' or char_length(btrim(body)) >= 1))
);
create index if not exists profile_posts_author_idx
  on public.profile_posts (user_id, created_at desc);
alter table public.profile_posts enable row level security;

-- moderation_log can point at a post (set null if the author deletes it)
alter table public.moderation_log
  add column if not exists post_id uuid references public.profile_posts (post_id) on delete set null;

-- The one place that decides "may the signed-in (or anonymous) viewer read the
-- visible posts of this person". SECURITY DEFINER because the reverse block
-- (the author blocked the viewer) is not readable by the viewer.
create or replace function public.can_view_posts_of(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_author is not null
     and (
       p_author = auth.uid()
       or (
         not exists (
           select 1 from public.blocks b
            where (b.blocker_id = auth.uid() and b.blocked_id = p_author)
               or (b.blocker_id = p_author and b.blocked_id = auth.uid())
         )
         and exists (
           select 1 from public.profiles pr
            where pr.user_id = p_author
              and (
                not pr.is_private
                or exists (
                  select 1 from public.follows f
                   where f.follower_id = auth.uid()
                     and f.followee_id = p_author
                     and f.status = 'accepted'
                )
              )
         )
       )
     )
$$;

-- Grants: a client may read; insert only the text (and itself as the author);
-- update only the text; delete its own rows. Nothing else is writable.
revoke all on public.profile_posts from anon, authenticated;
grant select on public.profile_posts to anon, authenticated;
grant insert (user_id, body) on public.profile_posts to authenticated;
grant update (body) on public.profile_posts to authenticated;
grant delete on public.profile_posts to authenticated;

drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts
  for select to anon, authenticated
  using (
    user_id = auth.uid()
    or (status = 'visible' and public.can_view_posts_of(user_id))
  );

drop policy if exists profile_posts_insert on public.profile_posts;
create policy profile_posts_insert on public.profile_posts
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_real_account()
    and exists (
      select 1 from public.profiles p
       where p.user_id = auth.uid() and p.username is not null
    )
  );

drop policy if exists profile_posts_update on public.profile_posts;
create policy profile_posts_update on public.profile_posts
  for update to authenticated
  using (user_id = auth.uid() and status = 'visible')
  with check (user_id = auth.uid() and status = 'visible');

drop policy if exists profile_posts_delete on public.profile_posts;
create policy profile_posts_delete on public.profile_posts
  for delete to authenticated
  using (user_id = auth.uid());

-- The server decides status, time, trimming and pace.
create or replace function public.profile_posts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent integer;
begin
  new.body := btrim(new.body);
  new.status := 'visible';
  new.created_at := now();
  new.updated_at := now();
  new.removed_by := null;
  new.removed_reason := null;
  select count(*) into v_recent
    from public.profile_posts p
   where p.user_id = new.user_id and p.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'profile_posts: rate_limited' using errcode = '54000';
  end if;
  return new;
end
$$;
drop trigger if exists profile_posts_before_insert on public.profile_posts;
create trigger profile_posts_before_insert before insert on public.profile_posts
  for each row execute function public.profile_posts_before_insert();

create or replace function public.profile_posts_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists profile_posts_before_update on public.profile_posts;
create trigger profile_posts_before_update before update on public.profile_posts
  for each row execute function public.profile_posts_before_update();

-- 4. Reporting a post ---------------------------------------------------------------
create table if not exists public.post_reports (
  report_id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.profile_posts (post_id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'false', 'private', 'other')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (post_id, reporter_id)
);
create index if not exists post_reports_open_idx
  on public.post_reports (post_id) where resolved_at is null;
alter table public.post_reports enable row level security;
drop policy if exists post_reports_read on public.post_reports;
create policy post_reports_read on public.post_reports
  for select to authenticated
  using (public.has_permission(auth.uid(), 'comments.moderate'));
revoke insert, update, delete on public.post_reports from anon, authenticated;

-- Error messages carry a short token the app maps to its own words:
-- not_account, not_found, rate_limited.
create or replace function public.report_post(p_post uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
begin
  if v_uid is null then
    raise exception 'report_post: not_account' using errcode = '42501';
  end if;
  if p_post is null
     or p_reason is null
     or p_reason not in ('spam', 'abuse', 'false', 'private', 'other') then
    raise exception 'report_post: not_found' using errcode = '22023';
  end if;
  select po.user_id into v_author
    from public.profile_posts po
   where po.post_id = p_post and po.status = 'visible';
  -- only a post the reporter could read; never one of their own
  if not found or v_author = v_uid or not public.can_view_posts_of(v_author) then
    raise exception 'report_post: not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.post_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'report_post: rate_limited' using errcode = '54000';
  end if;
  insert into public.post_reports (post_id, reporter_id, reason)
  values (p_post, v_uid, p_reason)
  on conflict (post_id, reporter_id) do update
    set reason = excluded.reason, created_at = now(), resolved_at = null;
end
$$;

-- Moderators: visible posts with open reports, most reported first.
create or replace function public.post_queue(p_limit integer default 50)
returns table (
  post_id uuid,
  author_id uuid,
  username text,
  display_name text,
  body text,
  report_count integer,
  last_reason text,
  last_reported_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'post_queue: moderators only' using errcode = '42501';
  end if;
  return query
    select po.post_id, po.user_id, pr.username, pr.display_name, po.body,
           count(*)::integer,
           (array_agg(r.reason order by r.created_at desc))[1],
           max(r.created_at),
           po.created_at
      from public.post_reports r
      join public.profile_posts po on po.post_id = r.post_id
      left join public.profiles pr on pr.user_id = po.user_id
     where r.resolved_at is null
       and po.status = 'visible'
     group by po.post_id, po.user_id, pr.username, pr.display_name, po.body, po.created_at
     order by count(*) desc, max(r.created_at) desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

create or replace function public.dismiss_post_reports(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'dismiss_post_reports: moderators only' using errcode = '42501';
  end if;
  select po.user_id into v_author from public.profile_posts po where po.post_id = p_post_id;
  update public.post_reports
     set resolved_at = now()
   where post_id = p_post_id and resolved_at is null;
  if found then
    insert into public.moderation_log (actor_id, action, post_id, target_user_id)
    values (auth.uid(), 'post_reports_dismiss', p_post_id, v_author);
  end if;
end
$$;

-- 5. Removal by an admin --------------------------------------------------------------
-- Soft delete: status 'removed', text cleared, open reports closed, one
-- moderation_log row (who, when, why). The author still sees the post as
-- "Removed by moderators"; nobody else sees it at all.
create or replace function public.admin_remove_post(p_post_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'removed_by_admin');
  v_author uuid;
  v_status text;
begin
  if not public.has_permission(v_uid, 'posts.delete') then
    raise exception 'admin_remove_post: not allowed' using errcode = '42501';
  end if;
  select po.user_id, po.status into v_author, v_status
    from public.profile_posts po
   where po.post_id = p_post_id
   for update;
  if not found then
    raise exception 'admin_remove_post: post not found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' then
    return;
  end if;
  update public.profile_posts
     set status = 'removed',
         body = '',
         removed_by = v_uid,
         removed_reason = v_reason,
         updated_at = now()
   where post_id = p_post_id;
  update public.post_reports
     set resolved_at = now()
   where post_id = p_post_id and resolved_at is null;
  insert into public.moderation_log (actor_id, action, post_id, target_user_id, reason)
  values (v_uid, 'post_remove', p_post_id, v_author, v_reason);
end
$$;

-- 6. The public profile page learns the post count ----------------------------------------
-- Same function as 0047 plus (a) one key, 'posts_count', inside the part only a
-- viewer who may see the full profile receives, and (b) a FIX: in 0047 a
-- non-follower with no follow row at all got a private account's full profile
-- (see the coalesce below). A private account's count is
-- therefore as hidden from non-followers as its followers and comments are.
-- Counts visible posts only.
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
  -- coalesce: a viewer with NO follow row has v_status null, and
  -- "null = 'accepted'" is null, which let a private account's full profile
  -- through in 0047. Null now means "not an accepted follower".
  v_full := not v_blocked
    and (not v_private or v_self or coalesce(v_status, '') = 'accepted');
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
    'posts_count', (select count(*) from public.profile_posts po where po.user_id = v_id and po.status = 'visible'),
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

-- Grants -------------------------------------------------------------------------------------
revoke all on function public.can_view_posts_of(uuid) from public;
revoke all on function public.profile_posts_before_insert() from public, anon, authenticated;
revoke all on function public.profile_posts_before_update() from public, anon, authenticated;
revoke all on function public.report_post(uuid, text) from public, anon;
revoke all on function public.post_queue(integer) from public, anon;
revoke all on function public.dismiss_post_reports(uuid) from public, anon;
revoke all on function public.admin_remove_post(uuid, text) from public, anon;
revoke all on function public.public_profile(text) from public;

grant execute on function public.can_view_posts_of(uuid) to anon, authenticated;
grant execute on function public.report_post(uuid, text) to authenticated;
grant execute on function public.post_queue(integer) to authenticated;
grant execute on function public.dismiss_post_reports(uuid) to authenticated;
grant execute on function public.admin_remove_post(uuid, text) to authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
