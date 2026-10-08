-- 0054: social + admin P1, batch 3 (restrict and suspend with expiry).
-- Review: social-admin-review-2026-10-08 (section 4d, P1-8), decisions D78, D79.
--
-- Three levels, one table, one helper:
--   * warning  a notice with the reason, no functional change
--   * restrict cannot comment, mark helpful, report a comment, post, follow,
--              report a profile or post, or edit the public profile
--   * suspend  as restrict, plus: the public profile reads "suspended" and
--              their comments and posts are hidden from everybody else
--              (status kept, they come back by themselves when the suspension
--              is lifted or ends)
-- Felt reports, alerts and notifications, home tags (family, private),
-- account deletion, data export, feedback and appeals, blocking and sign-in
-- are NEVER blocked: safety first, and a person must always be able to leave
-- and to ask.
--
--   1. permissions accounts.restrict (moderator, official) and
--      accounts.suspend (official)
--   2. account_restrictions: the table (a person reads only their own active
--      rows, and not the private note or who acted), is_restricted(),
--      is_suspended(), my_is_restricted(), assert_not_restricted()
--   3. enforcement in every social write path (see the list in section 3)
--   4. suspension hides: event_comments_read, profile_posts_read,
--      public_profile(), follow_list(), event_hub_summary()
--   5. RPCs: admin_restrict_account(), admin_lift_restriction(),
--      admin_account_restrictions(), my_restriction(),
--      request_restriction_review() (feedback category 'appeal')
--   6. audit: restrict, suspend and lift rows (snapshot carries the
--      restriction id) and admin_undo_action() lifts on Undo
--
-- Who may do what:
--   * restrict / warning: accounts.restrict. A moderator (who lacks
--     accounts.suspend) needs an end date at most 7 days away (one hour of
--     clock tolerance); the official rank may pick any end date up to 10 years
--     (restrict needs one; an official's warning without one runs 7 days).
--   * suspend: accounts.suspend (official), end date optional (indefinite).
--   * lift: accounts.restrict for warning and restrict, accounts.suspend for
--     a suspension. Undo in Activity is a lift.
--   * nobody can restrict an account that holds any admin permission (they
--     must lose the rank first), and nobody can restrict themselves.
--   * a guest identity can be restricted too. Weak by nature: a reinstall
--     gives a new identity, and guest comments are pre-moderated anyway.
--
-- Expiry is computed from the clock (ends_at), no job needed: an ended or
-- lifted row simply stops counting. lifted_at/lifted_by are set only by an
-- explicit lift. Deleting the account removes its restriction rows (sign-in
-- is not blocked in this batch, banning sign-in is P3).
--
-- Error tokens (message text, the app maps them): account_restricted
-- (enforcement, SQLSTATE 42501), not_allowed, not_found, invalid_level,
-- reason_required, ends_required, ends_invalid, ends_too_long, self_restriction,
-- protected_account, not_restorable.
--
-- Needs 0035, 0036, 0043, 0044, 0045, 0046, 0047, 0050, 0051, 0052 and 0053
-- (and 0048 for the feedback table's category rule).
-- Idempotent: safe to run twice. Written for the SQL editor as one line: no
-- transaction statements, only full-line comments, ASCII only.

-- 1. Permissions -------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('moderator', 'accounts.restrict'),
  ('official', 'accounts.restrict'),
  ('official', 'accounts.suspend')
on conflict do nothing;

-- 2. The table and its helpers --------------------------------------------------------
create table if not exists public.account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  level text not null check (level in ('warning', 'restrict', 'suspend')),
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  note text check (note is null or char_length(note) <= 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_by uuid references auth.users (id) on delete set null,
  lifted_at timestamptz,
  appeal_requested_at timestamptz,
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists account_restrictions_user_idx
  on public.account_restrictions (user_id, created_at desc);
create index if not exists account_restrictions_open_idx
  on public.account_restrictions (user_id, level) where lifted_at is null;
alter table public.account_restrictions enable row level security;

-- A person reads their OWN active rows, and only these columns: not the
-- private note, not who acted. Everything an admin sees goes through the RPCs.
drop policy if exists account_restrictions_read_own on public.account_restrictions;
create policy account_restrictions_read_own on public.account_restrictions
  for select to authenticated
  using (
    user_id = auth.uid()
    and lifted_at is null
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  );
revoke all on public.account_restrictions from anon, authenticated;
grant select (id, user_id, level, reason, starts_at, ends_at, created_at, lifted_at, appeal_requested_at)
  on public.account_restrictions to authenticated;

-- Restricted = a restrict or a suspend is in force (a warning changes nothing).
-- Internal: clients never ask about other people (see S7 in 0052).
create or replace function public.is_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and exists (
       select 1
         from public.account_restrictions r
        where r.user_id = p_user
          and r.level in ('restrict', 'suspend')
          and r.lifted_at is null
          and r.starts_at <= now()
          and (r.ends_at is null or r.ends_at > now())
     )
$$;

-- Suspended. Clients may ask: the public profile of a suspended account says so
-- anyway, and the read policies below need to call it.
create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and exists (
       select 1
         from public.account_restrictions r
        where r.user_id = p_user
          and r.level = 'suspend'
          and r.lifted_at is null
          and r.starts_at <= now()
          and (r.ends_at is null or r.ends_at > now())
     )
$$;

-- Am I restricted (for storage policies, which run as the caller).
create or replace function public.my_is_restricted()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_restricted(auth.uid())
$$;

-- The one guard every social write path calls.
create or replace function public.assert_not_restricted(p_user uuid, p_where text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_restricted(p_user) then
    raise exception '%: account_restricted', p_where using errcode = '42501';
  end if;
end
$$;

-- Does this person hold any admin permission (through any rank)?
create or replace function public.holds_admin_permission(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and exists (
       select 1
         from public.user_roles r
         join public.role_permissions rp on rp.role = r.role
        where r.user_id = p_user
     )
$$;

-- 3. Enforcement in every social write path ----------------------------------------------
-- Event hub comment (0052's insert trigger plus the guard).
create or replace function public.event_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymous boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true);
  v_recent integer;
  v_parent record;
begin
  perform public.assert_not_restricted(new.user_id, 'event_comments');
  new.created_at := now();
  new.updated_at := now();
  new.helpful_count := 0;
  new.reply_count := 0;
  new.flag_count := 0;
  new.hidden_reason := null;
  new.author_deleted_at := null;
  new.status := case when v_anonymous then 'pending' else 'visible' end;
  new.body := btrim(new.body);

  if new.parent_id is not null then
    select parent_id, event_id into v_parent from public.event_comments where comment_id = new.parent_id;
    if not found or v_parent.event_id <> new.event_id then
      raise exception 'event_comments: reply target not found' using errcode = '22023';
    end if;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;
    end if;
  end if;

  select count(*) into v_recent from public.event_comments
  where user_id = new.user_id and created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'event_comments: too many comments, try again in a few minutes' using errcode = '54000';
  end if;

  select fr.geohash_p5 into new.area_geohash
  from public.felt_reports fr
  where fr.user_id = new.user_id and fr.event_id = new.event_id
  order by fr.created_at desc
  limit 1;

  return new;
end
$$;

-- Helpful mark (a new trigger; taking a mark back stays allowed).
create or replace function public.comment_reactions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_not_restricted(new.user_id, 'comment_reactions');
  return new;
end
$$;
drop trigger if exists comment_reactions_before_insert on public.comment_reactions;
create trigger comment_reactions_before_insert before insert on public.comment_reactions
  for each row execute function public.comment_reactions_before_insert();

-- Reporting a comment (0052's trigger plus the guard; withdrawing stays allowed).
create or replace function public.comment_flags_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymous boolean;
  v_recent integer;
begin
  perform public.assert_not_restricted(new.user_id, 'comment_flags');
  new.created_at := now();
  new.settled := false;
  new.withdrawn_at := null;
  select coalesce(u.is_anonymous, true) into v_anonymous
    from auth.users u where u.id = new.user_id;
  new.counts := not coalesce(v_anonymous, true);
  select count(*) into v_recent
    from public.comment_flags f
   where f.user_id = new.user_id and f.created_at > now() - interval '24 hours';
  if v_recent >= 30 then
    raise exception 'comment_flags: flag_limit' using errcode = '54000';
  end if;
  return new;
end
$$;

-- A profile post: create (0050's trigger plus the guard).
create or replace function public.profile_posts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent integer;
begin
  perform public.assert_not_restricted(new.user_id, 'profile_posts');
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

-- A profile post: edit. Only the author's own text edit of a visible post is
-- guarded; an admin's remove or restore, the author's delete and restore of
-- their own cleanup are not text edits.
create or replace function public.profile_posts_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.body is distinct from old.body
     and old.status = 'visible'
     and new.status = 'visible'
     and auth.uid() is not distinct from new.user_id then
    perform public.assert_not_restricted(new.user_id, 'profile_posts');
  end if;
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end
$$;

-- Follow (0047 plus the guard). Unfollow, accept, decline and block stay allowed.
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
  perform public.assert_not_restricted(v_uid, 'follow_user');
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

-- Undo of an unfollow puts a follow back, which is creating a follow (0053 plus the guard).
create or replace function public.undo_unfollow_user(p_followee uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  u record;
  v_status text;
  v_private boolean;
begin
  if v_uid is null then
    raise exception 'undo_unfollow_user: not_account' using errcode = '42501';
  end if;
  perform public.assert_not_restricted(v_uid, 'undo_unfollow_user');
  select f.status into v_status
    from public.follows f
   where f.follower_id = v_uid and f.followee_id = p_followee;
  if found then
    return v_status;
  end if;
  select fu.status as status, fu.follow_created_at as follow_created_at,
         fu.created_at as created_at
    into u
    from public.follow_undo fu
   where fu.follower_id = v_uid and fu.followee_id = p_followee and fu.kind = 'unfollow'
   for update;
  if not found then
    raise exception 'undo_unfollow_user: not_found' using errcode = 'P0002';
  end if;
  if u.created_at < now() - interval '60 seconds' then
    raise exception 'undo_unfollow_user: expired' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = v_uid and b.blocked_id = p_followee)
        or (b.blocker_id = p_followee and b.blocked_id = v_uid)
  ) then
    raise exception 'undo_unfollow_user: blocked' using errcode = '42501';
  end if;
  select p.is_private into v_private from public.profiles p where p.user_id = p_followee;
  if not found then
    raise exception 'undo_unfollow_user: not_found' using errcode = 'P0002';
  end if;
  v_status := case when u.status = 'pending' and not v_private then 'accepted' else u.status end;
  insert into public.follows (follower_id, followee_id, status, created_at)
  values (v_uid, p_followee, v_status, u.follow_created_at)
  on conflict do nothing;
  delete from public.follow_undo
   where follower_id = v_uid and followee_id = p_followee;
  return v_status;
end
$$;

-- Report a profile (0047 plus the guard).
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
  perform public.assert_not_restricted(v_uid, 'report_profile');
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

-- Report a post (0050 plus the guard).
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
  perform public.assert_not_restricted(v_uid, 'report_post');
  if p_post is null
     or p_reason is null
     or p_reason not in ('spam', 'abuse', 'false', 'private', 'other') then
    raise exception 'report_post: not_found' using errcode = '22023';
  end if;
  select po.user_id into v_author
    from public.profile_posts po
   where po.post_id = p_post and po.status = 'visible';
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

-- The public profile row (0052's guard plus: the owner cannot change name,
-- photo, @username or privacy while restricted. Creating the profile in the
-- first place is not blocked: it is part of making an account. An admin who
-- edits somebody else's profile (auth.uid() is not the owner) is not guarded.)
create or replace function public.profiles_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if auth.uid() is not distinct from new.user_id
       and (
         new.display_name is distinct from old.display_name
         or new.avatar_path is distinct from old.avatar_path
         or new.username is distinct from old.username
         or new.is_private is distinct from old.is_private
       ) then
      perform public.assert_not_restricted(new.user_id, 'profiles');
    end if;
  end if;

  if new.avatar_path is not null
     and (tg_op = 'INSERT' or new.avatar_path is distinct from old.avatar_path)
     and (
       position('..' in new.avatar_path) > 0
       or left(new.avatar_path, char_length(new.user_id::text) + 1) <> new.user_id::text || '/'
     ) then
    raise exception 'profiles: avatar_path_invalid' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.display_name is not distinct from old.display_name then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.profiles p
     where p.user_id = new.user_id and p.display_name = new.display_name
  ) then
    return new;
  end if;
  if public.display_name_reserved(new.display_name)
     and not exists (
       select 1 from public.user_roles ur
        where ur.user_id = new.user_id and ur.role = 'official'
     ) then
    raise exception 'profiles: display_name_reserved' using errcode = '23514';
  end if;
  return new;
end
$$;

-- The avatar bucket is public: a restricted person cannot upload a new picture
-- either (0035's policies plus the guard; deleting their own file stays allowed).
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and not public.my_is_restricted()
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.my_is_restricted()
  );

-- 4. A suspension hides --------------------------------------------------------------------
-- Comments (0052's read policy plus: a suspended author's comments are not
-- read by others; the author and moderators still read them).
drop policy if exists event_comments_read on public.event_comments;
create policy event_comments_read on public.event_comments
  for select to anon, authenticated
  using (
    user_id = auth.uid()
    or (public.my_has_permission('comments.moderate') and author_deleted_at is null)
    or (
      status in ('visible', 'removed')
      and not exists (
        select 1 from public.blocks b
         where b.blocker_id = auth.uid()
           and b.blocked_id = event_comments.user_id
      )
      and not public.is_suspended(event_comments.user_id)
    )
  );

-- Posts (0053's read policy plus the same rule).
drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts
  for select to anon, authenticated
  using (
    (user_id = auth.uid() and status <> 'deleted')
    or (
      status = 'visible'
      and public.can_view_posts_of(user_id)
      and not public.is_suspended(user_id)
    )
  );

-- The felt summary counts only the comments a reader can see (0038 plus the rule).
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
    'comments', (select count(*) from public.event_comments c
                  where c.event_id = p_event_id and c.status = 'visible'
                    and not public.is_suspended(c.user_id)),
    'featured', coalesce((select hub_featured from public.events where event_id = p_event_id), false)
  )
$$;

-- Follower and following lists (0047): a suspended account has no list, and
-- suspended people are not listed in anybody else's.
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
  if v_viewer is not null and exists (
    select 1 from public.blocks b
     where (b.blocker_id = v_viewer and b.blocked_id = v_target)
        or (b.blocker_id = v_target and b.blocked_id = v_viewer)
  ) then
    return;
  end if;
  if public.is_suspended(v_target) and v_viewer is distinct from v_target then
    return;
  end if;
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
       and not public.is_suspended(p.user_id)
     order by f.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end
$$;

-- The public profile page (0050 plus 'suspended'). A suspended account shows
-- only its @username and the flag to everybody except the person themself; the
-- person sees their own page as always (the app adds the banner). The flag is
-- in the answer for every profile.
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
  v_suspended boolean;
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
  v_suspended := public.is_suspended(v_id);
  select f.status into v_status
    from public.follows f
   where f.follower_id = v_viewer and f.followee_id = v_id;
  v_blocked := v_viewer is not null and exists (
    select 1 from public.blocks b where b.blocker_id = v_viewer and b.blocked_id = v_id
  );
  if v_suspended and not v_self then
    return jsonb_build_object(
      'user_id', v_id,
      'username', v_username,
      'display_name', null::text,
      'avatar_path', null::text,
      'is_private', v_private,
      'roles', '[]'::jsonb,
      'is_self', false,
      'follow_status', 'none',
      'is_blocked', v_blocked,
      'can_view_full', false,
      'suspended', true
    );
  end if;
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
    'can_view_full', v_full,
    'suspended', v_suspended
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

-- 5. Feedback learns the appeal category ------------------------------------------------------
-- Dropped by shape, not by name (as 0048). A client still cannot tag its own
-- message 'appeal': only request_restriction_review() sets it, after the
-- insert.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.feedback'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table public.feedback drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.feedback drop constraint if exists feedback_category_check;
alter table public.feedback
  add constraint feedback_category_check
  check (category is null or category in (
    'bug', 'improvement', 'suggestion', 'question', 'other', 'badge_request', 'appeal'
  ));

-- 6. Audit: restrict, suspend and lift are content-style actions a moderator may read ---------
create or replace function public.is_content_audit_action(p_action text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_action ~ '^(comment|post|report)_'
      or p_action in ('profile_reports_resolve', 'restrict', 'suspend', 'lift')
$$;

-- 7. The RPCs --------------------------------------------------------------------------------------
-- Restrict, suspend or warn. Returns the restriction id (the app's Undo lifts
-- it). The same level already in force for at least as long (give or take 5
-- minutes, because a replay computes its end date again) returns that row and
-- writes nothing, so a double tap or a replay changes nothing.
create or replace function public.admin_restrict_account(
  p_user_id uuid,
  p_level text,
  p_reason text,
  p_note text default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := left(btrim(coalesce(p_reason, '')), 200);
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_ends timestamptz := p_ends_at;
  v_limited boolean;
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null or not public.has_permission(v_uid, 'accounts.restrict') then
    raise exception 'admin_restrict_account: not_allowed' using errcode = '42501';
  end if;
  if p_level is null or p_level not in ('warning', 'restrict', 'suspend') then
    raise exception 'admin_restrict_account: invalid_level' using errcode = '22023';
  end if;
  if p_level = 'suspend' and not public.has_permission(v_uid, 'accounts.suspend') then
    raise exception 'admin_restrict_account: not_allowed' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'admin_restrict_account: reason_required' using errcode = '22023';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'admin_restrict_account: not_found' using errcode = 'P0002';
  end if;
  if p_user_id = v_uid then
    raise exception 'admin_restrict_account: self_restriction' using errcode = '42501';
  end if;
  if public.holds_admin_permission(p_user_id) then
    raise exception 'admin_restrict_account: protected_account' using errcode = '42501';
  end if;

  v_limited := not public.has_permission(v_uid, 'accounts.suspend');
  if v_ends is null and p_level = 'warning' and not v_limited then
    v_ends := now() + interval '7 days';
  end if;
  if v_ends is null and (p_level = 'restrict' or v_limited) then
    raise exception 'admin_restrict_account: ends_required' using errcode = '22023';
  end if;
  if v_ends is not null then
    if v_ends <= now() + interval '1 minute' then
      raise exception 'admin_restrict_account: ends_invalid' using errcode = '22023';
    end if;
    if v_ends > now() + interval '3650 days'
       or (v_limited and v_ends > now() + interval '7 days 1 hour') then
      raise exception 'admin_restrict_account: ends_too_long' using errcode = '22023';
    end if;
  end if;

  select r.id into v_existing
    from public.account_restrictions r
   where r.user_id = p_user_id
     and r.level = p_level
     and r.lifted_at is null
     and r.starts_at <= now()
     and (r.ends_at is null or (v_ends is not null and r.ends_at >= v_ends - interval '5 minutes'))
   order by r.created_at desc
   limit 1;
  if found then
    return v_existing;
  end if;

  insert into public.account_restrictions (user_id, level, reason, note, starts_at, ends_at, created_by)
  values (p_user_id, p_level, v_reason, v_note, now(), v_ends, v_uid)
  returning id into v_id;
  perform public.write_audit(
    v_uid, case when p_level = 'suspend' then 'suspend' else 'restrict' end,
    'account', p_user_id::text,
    p_user_id, null, null, v_reason, v_note,
    jsonb_build_object('restriction_id', v_id, 'level', p_level, 'ends_at', v_ends)
  );
  return v_id;
end
$$;

-- Lift. Warning and restrict need accounts.restrict, a suspension needs
-- accounts.suspend. A restriction that is already lifted or already over is a
-- quiet no-op. The restrict or suspend log row is marked as undone.
create or replace function public.admin_lift_restriction(p_restriction_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_log uuid;
begin
  if v_uid is null or not public.has_permission(v_uid, 'accounts.restrict') then
    raise exception 'admin_lift_restriction: not_allowed' using errcode = '42501';
  end if;
  select x.id as id, x.user_id as user_id, x.level as level,
         x.lifted_at as lifted_at, x.ends_at as ends_at
    into r
    from public.account_restrictions x
   where x.id = p_restriction_id
   for update;
  if not found then
    raise exception 'admin_lift_restriction: not_found' using errcode = 'P0002';
  end if;
  if r.level = 'suspend' and not public.has_permission(v_uid, 'accounts.suspend') then
    raise exception 'admin_lift_restriction: not_allowed' using errcode = '42501';
  end if;
  if r.lifted_at is not null or (r.ends_at is not null and r.ends_at <= now()) then
    return;
  end if;
  update public.account_restrictions
     set lifted_by = v_uid, lifted_at = now()
   where id = r.id;
  v_log := public.write_audit(
    v_uid, 'lift', 'account', r.user_id::text,
    r.user_id, null, null, null, p_note,
    jsonb_build_object('restriction_id', r.id, 'level', r.level)
  );
  update public.moderation_log
     set reverted_by = v_log
   where action in ('restrict', 'suspend')
     and snapshot ->> 'restriction_id' = r.id::text
     and reverted_by is null
     and log_id <> v_log;
end
$$;

-- The admin lists. One person: their whole history. No person: the limits in
-- force plus those made in the last 30 days, in force first. The private note
-- and who acted are visible here (accounts.restrict) and nowhere else.
create or replace function public.admin_account_restrictions(
  p_user_id uuid default null,
  p_limit integer default 100
)
returns table (
  restriction_id uuid,
  user_id uuid,
  user_name text,
  user_username text,
  is_guest boolean,
  level text,
  reason text,
  note text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  created_by_name text,
  lifted_at timestamptz,
  lifted_by_name text,
  appeal_requested_at timestamptz,
  active boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.my_has_permission('accounts.restrict') then
    raise exception 'admin_account_restrictions: not_allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.user_id, up.display_name, up.username,
           coalesce(u.is_anonymous, true),
           r.level, r.reason, r.note, r.starts_at, r.ends_at, r.created_at,
           cp.display_name, r.lifted_at, lp.display_name, r.appeal_requested_at,
           (r.lifted_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()))
      from public.account_restrictions r
      left join auth.users u on u.id = r.user_id
      left join public.profiles up on up.user_id = r.user_id
      left join public.profiles cp on cp.user_id = r.created_by
      left join public.profiles lp on lp.user_id = r.lifted_by
     where (p_user_id is not null and r.user_id = p_user_id)
        or (p_user_id is null and (
             (r.lifted_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()))
             or r.created_at > now() - interval '30 days'))
     order by (r.lifted_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())) desc,
              r.created_at desc, r.id
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end
$$;

-- My own limit, for the banner: the strongest one in force, or no row.
create or replace function public.my_restriction()
returns table (
  restriction_id uuid,
  level text,
  reason text,
  starts_at timestamptz,
  ends_at timestamptz,
  appeal_requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    return;
  end if;
  return query
    select r.id, r.level, r.reason, r.starts_at, r.ends_at, r.appeal_requested_at
      from public.account_restrictions r
     where r.user_id = auth.uid()
       and r.lifted_at is null
       and r.starts_at <= now()
       and (r.ends_at is null or r.ends_at > now())
     order by case r.level when 'suspend' then 0 when 'restrict' then 1 else 2 end,
              r.ends_at desc nulls first
     limit 1;
end
$$;

-- "Ask for review": one feedback message in the new 'appeal' category, once per
-- restriction (a repeat is a quiet no-op, so a retry after a bad network is
-- safe). Only the person it concerns, only while it is in force. The private
-- note is never copied into the message.
create or replace function public.request_restriction_review(p_restriction_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_msg text := left(btrim(coalesce(p_message, '')), 1000);
  v_fid uuid;
begin
  if v_uid is null then
    raise exception 'request_restriction_review: not_account' using errcode = '42501';
  end if;
  select x.id as id, x.level as level, x.reason as reason,
         x.appeal_requested_at as appeal_requested_at
    into r
    from public.account_restrictions x
   where x.id = p_restriction_id
     and x.user_id = v_uid
     and x.lifted_at is null
     and x.starts_at <= now()
     and (x.ends_at is null or x.ends_at > now())
   for update;
  if not found then
    raise exception 'request_restriction_review: not_found' using errcode = 'P0002';
  end if;
  if r.appeal_requested_at is not null then
    return;
  end if;
  insert into public.feedback (device_id, user_id, message, screen)
  values (
    'appeal-' || r.id::text,
    v_uid,
    'Review request for restriction ' || r.id::text || ' (' || r.level || '): ' || r.reason
      || case when v_msg <> '' then E'\n\n' || v_msg else '' end,
    'restriction-banner'
  )
  returning feedback_id into v_fid;
  update public.feedback set category = 'appeal' where feedback_id = v_fid;
  update public.account_restrictions set appeal_requested_at = now() where id = r.id;
end
$$;

-- 8. Undo in Activity: a restrict or suspend row is undone by lifting ---------------------------------
-- 0053's dispatcher plus the restrict / suspend branch. The restriction must
-- still be in force; the lift itself checks the permission for its level.
create or replace function public.admin_undo_action(p_log_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  l record;
  v_latest uuid;
  v_expected text;
  v_current text;
  v_role text;
  v_granted_by uuid;
  v_new uuid;
  v_rid uuid;
begin
  if v_uid is null then
    raise exception 'admin_undo_action: not allowed' using errcode = '42501';
  end if;
  select x.log_id as log_id, x.action as action, x.reverted_by as reverted_by,
         x.comment_id as comment_id, x.post_id as post_id,
         x.target_user_id as target_user_id, x.snapshot as snapshot
    into l
    from public.moderation_log x
   where x.log_id = p_log_id
   for update;
  if not found then
    raise exception 'admin_undo_action: not_found' using errcode = 'P0002';
  end if;
  if l.reverted_by is not null then
    return;
  end if;

  if l.action in ('comment_hide', 'comment_remove') then
    if l.comment_id is null then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    select x.log_id into v_latest
      from public.moderation_log x
     where x.comment_id = l.comment_id and x.action = l.action and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    v_expected := case when l.action = 'comment_hide' then 'hidden' else 'removed' end;
    select cm.status into v_current
      from public.event_comments cm
     where cm.comment_id = l.comment_id;
    if v_latest is distinct from l.log_id or v_current is distinct from v_expected then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_restore_comment(l.comment_id, p_note);
  elsif l.action = 'post_remove' then
    if l.post_id is null then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    select x.log_id into v_latest
      from public.moderation_log x
     where x.post_id = l.post_id and x.action = 'post_remove' and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    if v_latest is distinct from l.log_id then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_restore_post(l.post_id, p_note);
  elsif l.action in ('profile_reports_resolve', 'post_reports_dismiss') then
    perform public.admin_reopen_reports(l.log_id, p_note);
  elsif l.action in ('restrict', 'suspend') then
    v_rid := nullif(l.snapshot ->> 'restriction_id', '')::uuid;
    if v_rid is null or not exists (
      select 1 from public.account_restrictions x
       where x.id = v_rid
         and x.lifted_at is null
         and (x.ends_at is null or x.ends_at > now())
    ) then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_lift_restriction(v_rid, p_note);
  elsif l.action = 'role_revoke' then
    if not public.has_permission(v_uid, 'badges.grant') then
      raise exception 'admin_undo_action: not allowed' using errcode = '42501';
    end if;
    v_role := l.snapshot ->> 'role';
    if l.target_user_id is null
       or v_role is null
       or v_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner')
       or not exists (select 1 from auth.users u where u.id = l.target_user_id)
       or exists (
         select 1 from public.user_roles r
          where r.user_id = l.target_user_id and r.role = v_role
       ) then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    v_granted_by := nullif(l.snapshot ->> 'granted_by', '')::uuid;
    if v_granted_by is null or not exists (select 1 from auth.users u where u.id = v_granted_by) then
      v_granted_by := v_uid;
    end if;
    insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note)
    values (
      l.target_user_id, v_role, l.snapshot ->> 'org_name', v_granted_by,
      coalesce((l.snapshot ->> 'granted_at')::timestamptz, now()), l.snapshot ->> 'note'
    );
    v_new := public.write_audit(
      v_uid, 'role_restore', 'rank', l.target_user_id::text,
      l.target_user_id, null, null, v_role, p_note,
      jsonb_build_object('role', v_role, 'undid', l.log_id)
    );
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  else
    raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
  end if;
end
$$;

-- Grants -----------------------------------------------------------------------------------------------------
revoke all on function public.is_restricted(uuid) from public, anon, authenticated;
revoke all on function public.is_suspended(uuid) from public;
revoke all on function public.my_is_restricted() from public, anon;
revoke all on function public.assert_not_restricted(uuid, text) from public, anon, authenticated;
revoke all on function public.holds_admin_permission(uuid) from public, anon, authenticated;
revoke all on function public.comment_reactions_before_insert() from public, anon, authenticated;
revoke all on function public.event_comments_before_insert() from public, anon, authenticated;
revoke all on function public.comment_flags_before_insert() from public, anon, authenticated;
revoke all on function public.profile_posts_before_insert() from public, anon, authenticated;
revoke all on function public.profile_posts_before_update() from public, anon, authenticated;
revoke all on function public.profiles_integrity_guard() from public, anon, authenticated;
revoke all on function public.follow_user(uuid) from public, anon;
revoke all on function public.undo_unfollow_user(uuid) from public, anon;
revoke all on function public.report_profile(uuid, text) from public, anon;
revoke all on function public.report_post(uuid, text) from public, anon;
revoke all on function public.follow_list(text, text, integer) from public;
revoke all on function public.public_profile(text) from public;
revoke all on function public.event_hub_summary(uuid) from public;
revoke all on function public.admin_restrict_account(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.admin_lift_restriction(uuid, text) from public, anon;
revoke all on function public.admin_account_restrictions(uuid, integer) from public, anon;
revoke all on function public.my_restriction() from public, anon;
revoke all on function public.request_restriction_review(uuid, text) from public, anon;
revoke all on function public.admin_undo_action(uuid, text) from public, anon;
revoke all on function public.is_content_audit_action(text) from public, anon;

grant execute on function public.is_suspended(uuid) to anon, authenticated;
grant execute on function public.my_is_restricted() to authenticated;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.undo_unfollow_user(uuid) to authenticated;
grant execute on function public.report_profile(uuid, text) to authenticated;
grant execute on function public.report_post(uuid, text) to authenticated;
grant execute on function public.follow_list(text, text, integer) to anon, authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.event_hub_summary(uuid) to anon, authenticated;
grant execute on function public.admin_restrict_account(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.admin_lift_restriction(uuid, text) to authenticated;
grant execute on function public.admin_account_restrictions(uuid, integer) to authenticated;
grant execute on function public.my_restriction() to authenticated;
grant execute on function public.request_restriction_review(uuid, text) to authenticated;
grant execute on function public.admin_undo_action(uuid, text) to authenticated;
grant execute on function public.is_content_audit_action(text) to authenticated;
