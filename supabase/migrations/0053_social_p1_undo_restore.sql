-- 0053: social + admin P1, batch 2 (undo for people, restore for admins).
-- Review: social-admin-review-2026-10-08 (section 4a, P1-5, P1-6), decisions
-- D78 (retention: author-deleted text 30 days, removal evidence 90 days) and D79.
--
-- Rule of this batch: nothing a person or an admin does from the app is
-- destroyed at once. The server does the delete immediately; "Undo" calls a
-- restore function. A nightly job purges what has passed its retention.
--
--   1. permission content.restore (official only) and the log action
--      role_restore
--   2. people: restore_my_comment() within 24 hours (delete_my_comment() now
--      remembers the status the comment had), posts become a soft delete
--      (status 'deleted', deleted_at) with delete_my_post() / restore_my_post()
--      within 24 hours, my_recently_deleted() for the "Recently deleted" list
--   3. S8 an author can no longer hard-delete a post (an admin-removed post
--      stays as evidence) and can no longer read removed_by (column grants)
--   4. follows: unfollow and declining a request are remembered for 60 seconds
--      (follow_undo) so undo_unfollow_user() / undo_decline_follow_request()
--      give back the exact previous row, accepted state included
--   5. moderation_evidence: a private copy of a comment or post taken just
--      before an admin removal wipes its text (no client policy, no client
--      privilege; read only through admin_hidden_removed() for audit.read_all)
--   6. admin undo: admin_restore_comment(), admin_restore_post(),
--      admin_reopen_reports(), admin_undo_action() (the one dispatcher the
--      Activity screen calls, also for a revoked rank), each writing an audit
--      row and setting reverted_by on the original; admin_hidden_removed() is
--      the list behind Admin > Hidden and removed
--   7. one nightly job purge_expired_social(): author-deleted posts after 30
--      days, removal evidence after 90 days, finished follow undo rows
--
-- Who may undo what (the permission split):
--   * hidden comment (a moderator hid it): comments.moderate (moderator and
--     official). The text is still in the row, so no evidence is needed.
--   * removed comment or post: content.restore (official only), within 30
--     days of the removal, from the evidence copy.
--   * reopening resolved or dismissed reports: comments.moderate.
--   * a revoked rank: badges.grant (official only).
--   A comment the AUTHOR deleted is never restorable by an admin (S2).
--
-- Needs 0035, 0036, 0043, 0044, 0045, 0046, 0047, 0050, 0051 and 0052.
-- Idempotent: safe to run twice. Written for the SQL editor as one line: no
-- transaction statements, only full-line comments, ASCII only.

-- 1. Permission and log action ----------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('official', 'content.restore')
on conflict do nothing;

-- Dropped by shape, not by name, so a differently named constraint cannot
-- linger. The list is 0052's plus role_restore.
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
    'comment_approve', 'comment_hide', 'comment_remove', 'comment_restore',
    'role_grant', 'role_revoke', 'role_restore',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge'
  ));

-- 2. Undo for my own comments ------------------------------------------------------------
-- The status the comment had before the author deleted it, so Undo puts it
-- back exactly (a guest comment that was still waiting for review goes back to
-- waiting, it does not jump to visible).
alter table public.event_comments add column if not exists author_deleted_prev_status text;
alter table public.event_comments add column if not exists author_deleted_prev_reason text;

-- 0052's delete, plus: remember the previous status once (a second delete call
-- does not overwrite it).
create or replace function public.delete_my_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_comments
     set author_deleted_prev_status = case
           when author_deleted_at is null then status else author_deleted_prev_status end,
         author_deleted_prev_reason = case
           when author_deleted_at is null then hidden_reason else author_deleted_prev_reason end,
         status = 'hidden',
         hidden_reason = 'deleted_by_author',
         author_deleted_at = coalesce(author_deleted_at, now()),
         updated_at = now()
   where comment_id = p_comment_id
     and user_id = auth.uid()
     and status <> 'removed';
  if not found then
    if exists (
      select 1 from public.event_comments c
       where c.comment_id = p_comment_id and c.user_id = auth.uid()
    ) then
      return;
    end if;
    raise exception 'delete_my_comment: not your comment' using errcode = '42501';
  end if;
end
$$;

-- Take my deleted comment back: only the author, only within 24 hours of the
-- delete, only if nobody removed it meanwhile and its text is still there.
-- Repeating the call on a comment that is already back is harmless. Tokens the
-- app maps: not_account, not_found, not_restorable, expired.
create or replace function public.restore_my_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_status text;
begin
  if v_uid is null then
    raise exception 'restore_my_comment: not_account' using errcode = '42501';
  end if;
  select cm.status as status, cm.author_deleted_at as deleted_at,
         cm.author_deleted_prev_status as prev_status,
         cm.author_deleted_prev_reason as prev_reason, cm.body as body
    into c
    from public.event_comments cm
   where cm.comment_id = p_comment_id and cm.user_id = v_uid
   for update;
  if not found then
    raise exception 'restore_my_comment: not_found' using errcode = 'P0002';
  end if;
  if c.status = 'removed' then
    raise exception 'restore_my_comment: not_restorable' using errcode = '22023';
  end if;
  if c.deleted_at is null then
    return;
  end if;
  if c.deleted_at < now() - interval '24 hours' then
    raise exception 'restore_my_comment: expired' using errcode = '22023';
  end if;
  if c.body = '' then
    raise exception 'restore_my_comment: not_restorable' using errcode = '22023';
  end if;
  v_status := coalesce(
    c.prev_status,
    case when exists (
      select 1 from auth.users u where u.id = v_uid and not coalesce(u.is_anonymous, true)
    ) then 'visible' else 'pending' end
  );
  update public.event_comments
     set status = v_status,
         hidden_reason = case when c.prev_status is null then null else c.prev_reason end,
         author_deleted_at = null,
         author_deleted_prev_status = null,
         author_deleted_prev_reason = null,
         updated_at = now()
   where comment_id = p_comment_id;
end
$$;

-- 3. Posts: soft delete by the author, S8 -----------------------------------------------------
alter table public.profile_posts add column if not exists deleted_at timestamptz;

-- status gains 'deleted' (the author's own delete). Dropped by shape: the body
-- check mentions 'removed' too, the status check is the one naming 'visible'.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.profile_posts'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%''visible''%'
  loop
    execute format('alter table public.profile_posts drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.profile_posts drop constraint if exists profile_posts_status_check;
alter table public.profile_posts
  add constraint profile_posts_status_check
  check (status in ('visible', 'removed', 'deleted'));

create index if not exists profile_posts_deleted_idx
  on public.profile_posts (deleted_at) where status = 'deleted';

-- Reading: a deleted post is invisible to everybody, its author included (the
-- author sees it through my_recently_deleted() for 24 hours). Everything else
-- is 0050's rule.
drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts
  for select to anon, authenticated
  using (
    (user_id = auth.uid() and status <> 'deleted')
    or (status = 'visible' and public.can_view_posts_of(user_id))
  );

-- S8: no client delete at all (the author deletes through delete_my_post(), a
-- removed post stays as evidence), and removed_by and deleted_at are not
-- readable columns any more.
drop policy if exists profile_posts_delete on public.profile_posts;
revoke delete on public.profile_posts from anon, authenticated;
revoke select on public.profile_posts from anon, authenticated;
grant select (post_id, user_id, body, status, created_at, updated_at, removed_reason)
  on public.profile_posts to anon, authenticated;

-- Delete my post. A removed post cannot be deleted by its author. Repeating
-- the call is harmless. Tokens: not_account, not_found, forbidden (42501).
create or replace function public.delete_my_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'delete_my_post: not_account' using errcode = '42501';
  end if;
  select po.status into v_status
    from public.profile_posts po
   where po.post_id = p_post_id and po.user_id = v_uid
   for update;
  if not found then
    raise exception 'delete_my_post: not_found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' then
    raise exception 'delete_my_post: forbidden' using errcode = '42501';
  end if;
  if v_status = 'deleted' then
    return;
  end if;
  update public.profile_posts
     set status = 'deleted', deleted_at = now()
   where post_id = p_post_id;
end
$$;

-- Take my deleted post back (24 hours). Tokens: not_account, not_found,
-- not_restorable (removed by an admin), expired.
create or replace function public.restore_my_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_deleted timestamptz;
begin
  if v_uid is null then
    raise exception 'restore_my_post: not_account' using errcode = '42501';
  end if;
  select po.status, po.deleted_at into v_status, v_deleted
    from public.profile_posts po
   where po.post_id = p_post_id and po.user_id = v_uid
   for update;
  if not found then
    raise exception 'restore_my_post: not_found' using errcode = 'P0002';
  end if;
  if v_status = 'visible' then
    return;
  end if;
  if v_status <> 'deleted' then
    raise exception 'restore_my_post: not_restorable' using errcode = '22023';
  end if;
  if v_deleted is null or v_deleted < now() - interval '24 hours' then
    raise exception 'restore_my_post: expired' using errcode = '22023';
  end if;
  update public.profile_posts
     set status = 'visible', deleted_at = null
   where post_id = p_post_id;
end
$$;

-- "Recently deleted": my own comments and posts deleted in the last 24 hours,
-- newest first, with the moment Restore stops working.
create or replace function public.my_recently_deleted()
returns table (
  kind text,
  item_id uuid,
  body text,
  deleted_at timestamptz,
  expires_at timestamptz,
  hub_id text,
  place text,
  magnitude numeric
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
    select * from (
      select 'comment'::text, c.comment_id, c.body, c.author_deleted_at,
             c.author_deleted_at + interval '24 hours',
             e.bumelerze_id::text, e.place::text, e.magnitude::numeric
        from public.event_comments c
        left join public.events e on e.event_id = c.event_id
       where c.user_id = auth.uid()
         and c.status = 'hidden'
         and c.body <> ''
         and c.author_deleted_at > now() - interval '24 hours'
      union all
      select 'post'::text, po.post_id, po.body, po.deleted_at,
             po.deleted_at + interval '24 hours',
             null::text, null::text, null::numeric
        from public.profile_posts po
       where po.user_id = auth.uid()
         and po.status = 'deleted'
         and po.deleted_at > now() - interval '24 hours'
    ) r
    order by 4 desc
    limit 50;
end
$$;

-- 4. Follows: 60 seconds of undo ---------------------------------------------------------------
-- What an unfollow or a declined request removed, kept for a minute. One row
-- per pair; a later action on the same pair replaces it. No client reads or
-- writes this table.
create table if not exists public.follow_undo (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('unfollow', 'decline')),
  status text not null check (status in ('pending', 'accepted')),
  follow_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id)
);
alter table public.follow_undo enable row level security;
revoke all on public.follow_undo from anon, authenticated;

create or replace function public.unfollow_user(p_followee uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_created timestamptz;
begin
  if v_uid is null then
    return;
  end if;
  delete from public.follows
   where follower_id = v_uid and followee_id = p_followee
  returning status, created_at into v_status, v_created;
  if found then
    insert into public.follow_undo (follower_id, followee_id, kind, status, follow_created_at)
    values (v_uid, p_followee, 'unfollow', v_status, v_created)
    on conflict (follower_id, followee_id) do update
      set kind = excluded.kind,
          status = excluded.status,
          follow_created_at = excluded.follow_created_at,
          created_at = now();
  end if;
end
$$;

create or replace function public.decline_follow_request(p_follower uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_created timestamptz;
begin
  if v_uid is null then
    return;
  end if;
  delete from public.follows
   where followee_id = v_uid and follower_id = p_follower and status = 'pending'
  returning created_at into v_created;
  if found then
    insert into public.follow_undo (follower_id, followee_id, kind, status, follow_created_at)
    values (p_follower, v_uid, 'decline', 'pending', v_created)
    on conflict (follower_id, followee_id) do update
      set kind = excluded.kind,
          status = excluded.status,
          follow_created_at = excluded.follow_created_at,
          created_at = now();
  end if;
end
$$;

-- Give the follow back. Returns the status that is in force afterwards. A
-- pending request to an account that has gone public meanwhile is accepted
-- (as going public does for every waiting request). Refused after 60 seconds
-- (expired), after a block in either direction (blocked) and when nothing was
-- removed (not_found). Repeating the call is harmless.
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

-- Put a declined request back (as pending, or accepted if I have gone public
-- meanwhile). The same 60 seconds and the same refusals.
create or replace function public.undo_decline_follow_request(p_follower uuid)
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
    raise exception 'undo_decline_follow_request: not_account' using errcode = '42501';
  end if;
  select f.status into v_status
    from public.follows f
   where f.follower_id = p_follower and f.followee_id = v_uid;
  if found then
    return v_status;
  end if;
  select fu.follow_created_at as follow_created_at, fu.created_at as created_at
    into u
    from public.follow_undo fu
   where fu.follower_id = p_follower and fu.followee_id = v_uid and fu.kind = 'decline'
   for update;
  if not found then
    raise exception 'undo_decline_follow_request: not_found' using errcode = 'P0002';
  end if;
  if u.created_at < now() - interval '60 seconds' then
    raise exception 'undo_decline_follow_request: expired' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = v_uid and b.blocked_id = p_follower)
        or (b.blocker_id = p_follower and b.blocked_id = v_uid)
  ) then
    raise exception 'undo_decline_follow_request: blocked' using errcode = '42501';
  end if;
  select p.is_private into v_private from public.profiles p where p.user_id = v_uid;
  v_status := case when coalesce(v_private, true) then 'pending' else 'accepted' end;
  insert into public.follows (follower_id, followee_id, status, created_at)
  values (p_follower, v_uid, v_status, u.follow_created_at)
  on conflict do nothing;
  delete from public.follow_undo
   where follower_id = p_follower and followee_id = v_uid;
  return v_status;
end
$$;

-- 5. Evidence ---------------------------------------------------------------------------------------
-- A private copy of what an admin removed, taken before the text is wiped.
-- Kept 90 days, then purged. One row per comment or post (a second removal of
-- the same item refreshes it). No client policy and no client privilege: the
-- only way to read it is admin_hidden_removed() with audit.read_all.
create table if not exists public.moderation_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('comment', 'post')),
  comment_id uuid references public.event_comments (comment_id) on delete set null,
  post_id uuid references public.profile_posts (post_id) on delete set null,
  event_id uuid,
  parent_id uuid,
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  area_geohash text,
  log_id uuid references public.moderation_log (log_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create unique index if not exists moderation_evidence_comment_idx
  on public.moderation_evidence (comment_id) where comment_id is not null;
create unique index if not exists moderation_evidence_post_idx
  on public.moderation_evidence (post_id) where post_id is not null;
create index if not exists moderation_evidence_expires_idx
  on public.moderation_evidence (expires_at);
alter table public.moderation_evidence enable row level security;
revoke all on public.moderation_evidence from anon, authenticated;

-- 0052's moderate_comment, plus: approving a comment that was hidden marks the
-- earlier hide rows of this comment as undone by this approve (so the Activity
-- screen does not offer a stale Undo).
create or replace function public.moderate_comment(p_comment_id uuid, p_action text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_status text;
  v_hidden text;
  v_flags integer;
  v_log uuid;
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'moderate_comment: moderators only' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'hide') then
    raise exception 'moderate_comment: action must be approve or hide' using errcode = '22023';
  end if;
  select c.user_id, c.status, c.hidden_reason, c.flag_count
    into v_author, v_status, v_hidden, v_flags
    from public.event_comments c
   where c.comment_id = p_comment_id
     and c.status <> 'removed'
     and c.author_deleted_at is null
   for update;
  if not found then
    return;
  end if;
  update public.event_comments
     set status = case when p_action = 'approve' then 'visible' else 'hidden' end,
         hidden_reason = case when p_action = 'hide' then coalesce(p_reason, 'moderator') else null end,
         flag_count = case when p_action = 'approve' then 0 else flag_count end,
         updated_at = now()
   where comment_id = p_comment_id;
  if p_action = 'approve' then
    update public.comment_flags
       set settled = true
     where comment_id = p_comment_id and not settled;
  end if;
  v_log := public.write_audit(
    auth.uid(), 'comment_' || p_action, 'comment', p_comment_id::text,
    v_author, p_comment_id, null, p_reason, null,
    jsonb_build_object('status', v_status, 'hidden_reason', v_hidden, 'flag_count', v_flags)
  );
  if p_action = 'approve' then
    update public.moderation_log
       set reverted_by = v_log
     where comment_id = p_comment_id
       and action = 'comment_hide'
       and reverted_by is null
       and log_id <> v_log;
  end if;
end
$$;

-- 0052's admin_delete_comment, plus: the evidence copy is taken before the
-- text is wiped, and the log row id is stored on it.
create or replace function public.admin_delete_comment(p_comment_id uuid, p_reason text default null)
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
  v_hidden text;
  v_flags integer;
  v_deleted timestamptz;
  v_log uuid;
begin
  if not public.has_permission(v_uid, 'comments.delete') then
    raise exception 'admin_delete_comment: not allowed' using errcode = '42501';
  end if;
  select c.user_id, c.status, c.hidden_reason, c.flag_count, c.author_deleted_at
    into v_author, v_status, v_hidden, v_flags, v_deleted
    from public.event_comments c
   where c.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'admin_delete_comment: comment not found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' or v_deleted is not null then
    return;
  end if;
  insert into public.moderation_evidence (
    kind, comment_id, event_id, parent_id, author_id, body, area_geohash
  )
  select 'comment', c.comment_id, c.event_id, c.parent_id, c.user_id, c.body, c.area_geohash
    from public.event_comments c
   where c.comment_id = p_comment_id
  on conflict (comment_id) where comment_id is not null do update
    set body = excluded.body,
        area_geohash = excluded.area_geohash,
        author_id = excluded.author_id,
        log_id = null,
        created_at = now(),
        expires_at = now() + interval '90 days';
  update public.event_comments
     set status = 'removed',
         body = '',
         area_geohash = null,
         hidden_reason = v_reason,
         updated_at = now()
   where comment_id = p_comment_id;
  v_log := public.write_audit(
    v_uid, 'comment_remove', 'comment', p_comment_id::text,
    v_author, p_comment_id, null, v_reason, null,
    jsonb_build_object('status', v_status, 'hidden_reason', v_hidden, 'flag_count', v_flags)
  );
  update public.moderation_evidence set log_id = v_log where comment_id = p_comment_id;
end
$$;

-- 0052's admin_remove_post, plus: evidence copy first; an author-deleted post
-- is left alone (it is the author's, and gone for everybody else already).
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
  v_ids jsonb;
  v_log uuid;
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
  if v_status in ('removed', 'deleted') then
    return;
  end if;
  insert into public.moderation_evidence (kind, post_id, author_id, body)
  select 'post', po.post_id, po.user_id, po.body
    from public.profile_posts po
   where po.post_id = p_post_id
  on conflict (post_id) where post_id is not null do update
    set body = excluded.body,
        author_id = excluded.author_id,
        log_id = null,
        created_at = now(),
        expires_at = now() + interval '90 days';
  update public.profile_posts
     set status = 'removed',
         body = '',
         removed_by = v_uid,
         removed_reason = v_reason,
         updated_at = now()
   where post_id = p_post_id;
  with closed as (
    update public.post_reports
       set resolved_at = now()
     where post_id = p_post_id and resolved_at is null
    returning report_id
  )
  select coalesce(jsonb_agg(closed.report_id), '[]'::jsonb) into v_ids from closed;
  v_log := public.write_audit(
    v_uid, 'post_remove', 'post', p_post_id::text,
    v_author, null, p_post_id, v_reason, null,
    jsonb_build_object('status', v_status, 'report_ids', v_ids)
  );
  update public.moderation_evidence set log_id = v_log where post_id = p_post_id;
end
$$;

-- 6. Admin restore ---------------------------------------------------------------------------------------
-- Restore a hidden or removed comment. Hidden: comments.moderate, goes back to
-- the state it had before the hide (a comment that was waiting for review
-- waits again; with no record it waits for review). Removed: content.restore,
-- within 30 days of the removal, text and area from the evidence copy, back to
-- the state it had before the removal. Nothing to restore (already back):
-- returns quietly. Tokens: not_found, not_restorable, expired; 42501 = not allowed.
create or replace function public.admin_restore_comment(p_comment_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  l record;
  ev record;
  v_status text;
  v_hidden text;
  v_flags integer;
  v_at timestamptz;
  v_new uuid;
begin
  if not public.has_permission(v_uid, 'comments.moderate') then
    raise exception 'admin_restore_comment: not allowed' using errcode = '42501';
  end if;
  select cm.user_id as user_id, cm.status as status, cm.flag_count as flag_count,
         cm.author_deleted_at as deleted_at, cm.updated_at as updated_at
    into c
    from public.event_comments cm
   where cm.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'admin_restore_comment: not_found' using errcode = 'P0002';
  end if;
  if c.deleted_at is not null then
    raise exception 'admin_restore_comment: not_restorable' using errcode = '22023';
  end if;

  if c.status = 'hidden' then
    select x.log_id as log_id, x.snapshot as snapshot
      into l
      from public.moderation_log x
     where x.comment_id = p_comment_id and x.action = 'comment_hide' and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    v_status := case
      when l.snapshot ->> 'status' in ('visible', 'pending') then l.snapshot ->> 'status'
      else 'pending' end;
    v_hidden := case
      when l.snapshot ->> 'status' = v_status then l.snapshot ->> 'hidden_reason'
      else null end;
    v_flags := coalesce((l.snapshot ->> 'flag_count')::integer, c.flag_count);
    update public.event_comments
       set status = v_status,
           hidden_reason = v_hidden,
           flag_count = v_flags,
           updated_at = now()
     where comment_id = p_comment_id;
  elsif c.status = 'removed' then
    if not public.has_permission(v_uid, 'content.restore') then
      raise exception 'admin_restore_comment: not allowed' using errcode = '42501';
    end if;
    select x.log_id as log_id, x.snapshot as snapshot, x.created_at as created_at
      into l
      from public.moderation_log x
     where x.comment_id = p_comment_id and x.action = 'comment_remove' and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    v_at := coalesce(l.created_at, c.updated_at);
    if v_at < now() - interval '30 days' then
      raise exception 'admin_restore_comment: expired' using errcode = '22023';
    end if;
    select e.body as body, e.area_geohash as area_geohash
      into ev
      from public.moderation_evidence e
     where e.comment_id = p_comment_id;
    if not found or coalesce(ev.body, '') = '' then
      raise exception 'admin_restore_comment: not_restorable' using errcode = '22023';
    end if;
    v_status := case
      when l.snapshot ->> 'status' in ('visible', 'pending', 'hidden') then l.snapshot ->> 'status'
      else 'visible' end;
    v_hidden := case
      when l.snapshot ->> 'status' = v_status then l.snapshot ->> 'hidden_reason'
      else null end;
    v_flags := coalesce((l.snapshot ->> 'flag_count')::integer, 0);
    update public.event_comments
       set status = v_status,
           body = ev.body,
           area_geohash = ev.area_geohash,
           hidden_reason = v_hidden,
           flag_count = v_flags,
           updated_at = now()
     where comment_id = p_comment_id;
  else
    return;
  end if;

  v_new := public.write_audit(
    v_uid, 'comment_restore', 'comment', p_comment_id::text,
    c.user_id, p_comment_id, null, null, p_note,
    jsonb_build_object('from', c.status, 'to', v_status, 'undid', l.log_id)
  );
  if l.log_id is not null then
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  end if;
end
$$;

-- Restore a removed post (content.restore, within 30 days, text from the
-- evidence copy). The reports the removal closed are opened again, so the post
-- is back in the review queue exactly as it was. Tokens as above.
create or replace function public.admin_restore_post(p_post_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  p record;
  l record;
  ev record;
  v_at timestamptz;
  v_new uuid;
  v_reopened integer := 0;
begin
  if not public.has_permission(v_uid, 'content.restore') then
    raise exception 'admin_restore_post: not allowed' using errcode = '42501';
  end if;
  select po.user_id as user_id, po.status as status, po.updated_at as updated_at
    into p
    from public.profile_posts po
   where po.post_id = p_post_id
   for update;
  if not found then
    raise exception 'admin_restore_post: not_found' using errcode = 'P0002';
  end if;
  if p.status = 'visible' then
    return;
  end if;
  if p.status <> 'removed' then
    raise exception 'admin_restore_post: not_restorable' using errcode = '22023';
  end if;
  select x.log_id as log_id, x.snapshot as snapshot, x.created_at as created_at
    into l
    from public.moderation_log x
   where x.post_id = p_post_id and x.action = 'post_remove' and x.reverted_by is null
   order by x.created_at desc, x.log_id desc
   limit 1;
  v_at := coalesce(l.created_at, p.updated_at);
  if v_at < now() - interval '30 days' then
    raise exception 'admin_restore_post: expired' using errcode = '22023';
  end if;
  select e.body as body into ev
    from public.moderation_evidence e
   where e.post_id = p_post_id;
  if not found or coalesce(btrim(ev.body), '') = '' then
    raise exception 'admin_restore_post: not_restorable' using errcode = '22023';
  end if;
  update public.profile_posts
     set status = 'visible',
         body = ev.body,
         removed_by = null,
         removed_reason = null,
         updated_at = now()
   where post_id = p_post_id;
  if jsonb_typeof(l.snapshot -> 'report_ids') = 'array' then
    update public.post_reports r
       set resolved_at = null
     where r.post_id = p_post_id
       and r.resolved_at is not null
       and r.report_id in (
         select (j.value)::uuid from jsonb_array_elements_text(l.snapshot -> 'report_ids') j
       );
    get diagnostics v_reopened = row_count;
  end if;
  v_new := public.write_audit(
    v_uid, 'post_restore', 'post', p_post_id::text,
    p.user_id, null, p_post_id, null, p_note,
    jsonb_build_object('from', 'removed', 'to', 'visible', 'undid', l.log_id, 'reports_reopened', v_reopened)
  );
  if l.log_id is not null then
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  end if;
end
$$;

-- Open the reports again that a resolve (profile) or a dismiss (post) closed:
-- the log row's snapshot lists them. comments.moderate. Repeating the call on a
-- row that was already undone is harmless.
create or replace function public.admin_reopen_reports(p_log_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  l record;
  v_reopened integer := 0;
  v_new uuid;
begin
  if not public.has_permission(v_uid, 'comments.moderate') then
    raise exception 'admin_reopen_reports: not allowed' using errcode = '42501';
  end if;
  select x.log_id as log_id, x.action as action, x.reverted_by as reverted_by,
         x.snapshot as snapshot, x.target_user_id as target_user_id,
         x.post_id as post_id, x.target_id as target_id
    into l
    from public.moderation_log x
   where x.log_id = p_log_id
   for update;
  if not found then
    raise exception 'admin_reopen_reports: not_found' using errcode = 'P0002';
  end if;
  if l.action not in ('profile_reports_resolve', 'post_reports_dismiss') then
    raise exception 'admin_reopen_reports: not_restorable' using errcode = '22023';
  end if;
  if l.reverted_by is not null then
    return;
  end if;
  if jsonb_typeof(l.snapshot -> 'report_ids') = 'array' then
    if l.action = 'profile_reports_resolve' then
      update public.profile_reports r
         set resolved_at = null
       where r.resolved_at is not null
         and r.report_id in (
           select (j.value)::uuid from jsonb_array_elements_text(l.snapshot -> 'report_ids') j
         );
    else
      update public.post_reports r
         set resolved_at = null
       where r.resolved_at is not null
         and r.report_id in (
           select (j.value)::uuid from jsonb_array_elements_text(l.snapshot -> 'report_ids') j
         );
    end if;
    get diagnostics v_reopened = row_count;
  end if;
  v_new := public.write_audit(
    v_uid, 'report_reopen',
    case when l.action = 'profile_reports_resolve' then 'profile' else 'post' end,
    l.target_id, l.target_user_id, null, l.post_id, null, p_note,
    jsonb_build_object('undid', l.log_id, 'reports_reopened', v_reopened)
  );
  update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
end
$$;

-- The one entry the Activity screen calls: undo the action in this log row.
-- Reversible: comment_hide and comment_remove (the newest one of that comment
-- still standing), post_remove, profile_reports_resolve, post_reports_dismiss
-- and role_revoke. Everything else is not_restorable. Each branch checks its
-- own permission (see the split in the header). Already undone: quiet no-op.
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

-- Admin > Hidden and removed: comments a moderator hid, comments and posts an
-- admin removed, last 30 days, newest first (keyset on acted_at: pass the last
-- row's acted_at as p_before). comments.moderate. The text of a REMOVED item
-- comes from the evidence copy and only for audit.read_all (official);
-- can_restore says whether Restore will work for the caller.
create or replace function public.admin_hidden_removed(
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  kind text,
  item_id uuid,
  status text,
  acted_at timestamptz,
  log_id uuid,
  actor_name text,
  reason text,
  author_id uuid,
  author_name text,
  author_username text,
  hub_id text,
  place text,
  body text,
  can_restore boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_mod boolean := public.my_has_permission('comments.moderate');
  v_full boolean := public.my_has_permission('audit.read_all');
  v_rest boolean := public.my_has_permission('content.restore');
begin
  if not v_mod then
    raise exception 'admin_hidden_removed: not allowed' using errcode = '42501';
  end if;
  return query
    with items as (
      select 'comment'::text as kind, c.comment_id as item_id, c.status as status,
             coalesce(l.created_at, c.updated_at) as acted_at, l.log_id as log_id,
             ap.display_name as actor_name, coalesce(l.reason, c.hidden_reason) as reason,
             c.user_id as author_id, up.display_name as author_name, up.username as author_username,
             ev.bumelerze_id::text as hub_id, ev.place::text as place,
             case when c.status = 'hidden' then c.body
                  when v_full then x.body
                  else null end as body,
             case when c.status = 'hidden' then v_mod
                  else v_rest and x.evidence_id is not null
                       and coalesce(l.created_at, c.updated_at) > now() - interval '30 days' end as can_restore
        from public.event_comments c
        left join lateral (
          select m.log_id, m.created_at, m.reason, m.actor_id
            from public.moderation_log m
           where m.comment_id = c.comment_id
             and m.action = case when c.status = 'hidden' then 'comment_hide' else 'comment_remove' end
             and m.reverted_by is null
           order by m.created_at desc, m.log_id desc
           limit 1
        ) l on true
        left join public.profiles ap on ap.user_id = l.actor_id
        left join public.profiles up on up.user_id = c.user_id
        left join public.events ev on ev.event_id = c.event_id
        left join public.moderation_evidence x on x.comment_id = c.comment_id
       where c.status in ('hidden', 'removed')
         and c.author_deleted_at is null
      union all
      select 'post'::text, po.post_id, po.status,
             coalesce(l.created_at, po.updated_at), l.log_id,
             ap.display_name, coalesce(l.reason, po.removed_reason),
             po.user_id, up.display_name, up.username,
             null::text, null::text,
             case when v_full then x.body else null end,
             v_rest and x.evidence_id is not null
               and coalesce(l.created_at, po.updated_at) > now() - interval '30 days'
        from public.profile_posts po
        left join lateral (
          select m.log_id, m.created_at, m.reason, m.actor_id
            from public.moderation_log m
           where m.post_id = po.post_id
             and m.action = 'post_remove'
             and m.reverted_by is null
           order by m.created_at desc, m.log_id desc
           limit 1
        ) l on true
        left join public.profiles ap on ap.user_id = l.actor_id
        left join public.profiles up on up.user_id = po.user_id
        left join public.moderation_evidence x on x.post_id = po.post_id
       where po.status = 'removed'
    )
    select r.kind, r.item_id, r.status, r.acted_at, r.log_id, r.actor_name, r.reason,
           r.author_id, r.author_name, r.author_username, r.hub_id, r.place, r.body, r.can_restore
      from items r
     where r.acted_at > now() - interval '30 days'
       and (p_before is null or r.acted_at < p_before)
     order by r.acted_at desc, r.item_id
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- 7. Nightly purge -----------------------------------------------------------------------------------------
-- Author-deleted posts after 30 days, removal evidence after 90 days, follow
-- undo rows after a day. The first two write one 'purge' audit row each when
-- they removed something. Safe to run twice.
create or replace function public.purge_expired_social()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_posts integer;
  n_evidence integer;
  n_undo integer;
begin
  delete from public.profile_posts
   where status = 'deleted'
     and deleted_at < now() - interval '30 days';
  get diagnostics n_posts = row_count;
  delete from public.moderation_evidence
   where expires_at < now();
  get diagnostics n_evidence = row_count;
  delete from public.follow_undo
   where created_at < now() - interval '1 day';
  get diagnostics n_undo = row_count;
  if n_posts > 0 then
    perform public.write_audit(
      null, 'purge', 'post', null, null, null, null,
      'author_deleted_posts', n_posts::text || ' posts', null
    );
  end if;
  if n_evidence > 0 then
    perform public.write_audit(
      null, 'purge', 'system', null, null, null, null,
      'removal_evidence', n_evidence::text || ' items', null
    );
  end if;
  return jsonb_build_object('posts', n_posts, 'evidence', n_evidence, 'follow_undo', n_undo);
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_expired_social') then
    perform cron.unschedule('purge_expired_social');
  end if;
  perform cron.schedule('purge_expired_social', '25 3 * * *', $cron$select public.purge_expired_social();$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule purge_expired_social by hand: select cron.schedule(''purge_expired_social'', ''25 3 * * *'', ''select public.purge_expired_social();'');', sqlerrm;
end
$$;

-- Grants -----------------------------------------------------------------------------------------------------
revoke all on function public.delete_my_comment(uuid) from public, anon;
revoke all on function public.restore_my_comment(uuid) from public, anon;
revoke all on function public.delete_my_post(uuid) from public, anon;
revoke all on function public.restore_my_post(uuid) from public, anon;
revoke all on function public.my_recently_deleted() from public, anon;
revoke all on function public.unfollow_user(uuid) from public, anon;
revoke all on function public.decline_follow_request(uuid) from public, anon;
revoke all on function public.undo_unfollow_user(uuid) from public, anon;
revoke all on function public.undo_decline_follow_request(uuid) from public, anon;
revoke all on function public.moderate_comment(uuid, text, text) from public, anon;
revoke all on function public.admin_delete_comment(uuid, text) from public, anon;
revoke all on function public.admin_remove_post(uuid, text) from public, anon;
revoke all on function public.admin_restore_comment(uuid, text) from public, anon;
revoke all on function public.admin_restore_post(uuid, text) from public, anon;
revoke all on function public.admin_reopen_reports(uuid, text) from public, anon;
revoke all on function public.admin_undo_action(uuid, text) from public, anon;
revoke all on function public.admin_hidden_removed(timestamptz, integer) from public, anon;
revoke all on function public.purge_expired_social() from public, anon, authenticated;

grant execute on function public.delete_my_comment(uuid) to authenticated;
grant execute on function public.restore_my_comment(uuid) to authenticated;
grant execute on function public.delete_my_post(uuid) to authenticated;
grant execute on function public.restore_my_post(uuid) to authenticated;
grant execute on function public.my_recently_deleted() to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.decline_follow_request(uuid) to authenticated;
grant execute on function public.undo_unfollow_user(uuid) to authenticated;
grant execute on function public.undo_decline_follow_request(uuid) to authenticated;
grant execute on function public.moderate_comment(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_comment(uuid, text) to authenticated;
grant execute on function public.admin_remove_post(uuid, text) to authenticated;
grant execute on function public.admin_restore_comment(uuid, text) to authenticated;
grant execute on function public.admin_restore_post(uuid, text) to authenticated;
grant execute on function public.admin_reopen_reports(uuid, text) to authenticated;
grant execute on function public.admin_undo_action(uuid, text) to authenticated;
grant execute on function public.admin_hidden_removed(timestamptz, integer) to authenticated;
grant execute on function public.purge_expired_social() to service_role;
