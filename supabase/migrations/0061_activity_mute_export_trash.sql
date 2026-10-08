-- 0061: social P2 batch 3: in-app activity list, mute, download my data, home
-- trash, unblock restores follows.
-- Review: social-admin-review-2026-10-08 (section 4a, 4e; plan rows P2-4,
-- P2-8, P2-9, P2-13, P2-14), decisions D70, D76 to D81.
--
--   1. P2-4 Activity (in the app only; social things never send a push, so
--      earthquake alerts stay the only pushes). activity_items holds one row
--      per thing to tell a person. It is written ONLY by AFTER triggers on the
--      tables where things happen (follows, event_comments, comment_reactions,
--      post_helpful, moderation_log, user_roles, home_members,
--      safety_checkins), never by the app. Kinds:
--        new_follower, follow_request, follow_accepted, comment_reply,
--        comment_helpful and post_helpful (one row per comment or post per
--        UTC day, with a count), content_removed (the statement of reasons,
--        with "Ask for review" that files a feedback row of category appeal),
--        badge_granted, report_reviewed (neutral: "we reviewed it", never the
--        outcome or who), home_join_request, home_join_approved, family_safe
--        (an approved member of the same ACTIVE home who shares check-ins,
--        made after the reader joined; 0057's rules; never a place).
--      Moderators are never named (actor is empty for moderation and ranks).
--      Blocks (either way) stop new rows and hide old ones, and a block
--      deletes the rows between the two people. Mutes stop and hide
--      everything from the muted person EXCEPT family_safe: a family
--      member's "I'm safe" is safety information, and the home's own family
--      card (0057) shows it whatever the mute; suspended actors are hidden
--      the same way, with the same exception (D81: safety over moderation).
--      Reads: my_activity(), my_activity_unread(); mark_activity_read();
--      request_content_review(). Kept 90 days (nightly purge).
--   2. P2-8 Mute: mutes (muter, muted). Quiet: the muted person is not told
--      and nothing on their side changes. The app hides their comments and
--      posts for the muter; activity from them stops. mute_user(),
--      unmute_user(), my_mutes(). Guests may mute (as they may block).
--   3. P2-9 export_my_data(): one JSON document of everything the person
--      gave us or did, their own coordinates included (felt reports, homes
--      they OWN, alert places). Never another person's private data: other
--      people appear by public user id, @username and display name only;
--      shared homes they do not own come without coordinates and with only
--      their OWN answers and photos; admin notes, who moderated, and
--      internal triage notes are left out.
--   4. P2-13 Home trash: trash_home_tag() replaces the immediate delete in
--      the app. A trashed home (status trashed, trashed_at) is invisible to
--      every member, the owner included (is_home_member and is_home_owner
--      now skip it, so every 0037/0042 policy, the photo bucket and 0057's
--      family card close at once). The owner sees it in my_trashed_homes()
--      and can restore_home_tag() within 14 days (the 5-home limit still
--      applies) or delete_home_now(). The nightly job hard-deletes after 14
--      days, as delete_home_tag() does. Photo FILES: Supabase does not let
--      SQL delete storage objects, so every deleted home whose folder still
--      has files is queued in home_photo_purge by a trigger (any path:
--      purge, delete now, 0049, account deletion), and the edge function
--      purge-home-photos removes the files through the Storage API nightly.
--      Account deletion (0056 delete_my_account) is unchanged and still
--      immediate; trashed homes go with it.
--   5. P2-14 Unblock within 24 hours gives back the follows the block took
--      away (stored on the block row), unless the other person blocked too,
--      quietly (no activity rows).
--
-- Not touched: event_comments_before_insert, profile_posts_before_insert and
-- before_update (0059), moderation functions, feedback functions and
-- role_permissions (0060), delete_my_account (0056), purge_expired_social
-- (0058). Every hook here is a NEW after-trigger or a separate function.
--
-- Error tokens (message text, the app maps them): not_account, not_found,
-- rate_limited, already_requested, limit, expired, not_trashed.
--
-- Needs 0035 to 0058. Idempotent: safe to run twice. Written for the SQL
-- editor as one line: no transaction statements, only full-line comments,
-- ASCII only.

-- 1. Tables -----------------------------------------------------------------------------
create table if not exists public.activity_items (
  item_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  actor_id uuid references auth.users (id) on delete cascade,
  comment_id uuid references public.event_comments (comment_id) on delete cascade,
  post_id uuid references public.profile_posts (post_id) on delete cascade,
  event_id uuid references public.events (event_id) on delete cascade,
  tag_id uuid references public.home_tags (tag_id) on delete cascade,
  log_id uuid,
  meta jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
alter table public.activity_items drop constraint if exists activity_items_kind_check;
alter table public.activity_items
  add constraint activity_items_kind_check
  check (kind in (
    'new_follower', 'follow_request', 'follow_accepted',
    'comment_reply', 'comment_helpful', 'post_helpful',
    'content_removed', 'badge_granted', 'report_reviewed',
    'home_join_request', 'home_join_approved', 'family_safe'
  ));
create index if not exists activity_items_user_idx on public.activity_items (user_id, created_at desc);
create index if not exists activity_items_actor_idx on public.activity_items (actor_id);
create index if not exists activity_items_created_idx on public.activity_items (created_at);
alter table public.activity_items enable row level security;
revoke all on public.activity_items from public, anon, authenticated;

create table if not exists public.mutes (
  muter_id uuid not null references auth.users (id) on delete cascade,
  muted_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
alter table public.mutes enable row level security;
revoke all on public.mutes from public, anon, authenticated;

create table if not exists public.home_photo_purge (
  tag_id uuid primary key,
  queued_at timestamptz not null default now()
);
alter table public.home_photo_purge enable row level security;
revoke all on public.home_photo_purge from public, anon, authenticated;

alter table public.blocks add column if not exists removed_follows jsonb;

alter table public.home_tags add column if not exists trashed_at timestamptz;
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.home_tags'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%archived%'
  loop
    execute format('alter table public.home_tags drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.home_tags drop constraint if exists home_tags_status_check;
alter table public.home_tags
  add constraint home_tags_status_check
  check (status in ('active', 'archived', 'trashed'));
create index if not exists home_tags_trashed_idx on public.home_tags (trashed_at) where trashed_at is not null;

-- 2. Small internal helpers ----------------------------------------------------------------
-- A block between two people, in either direction.
create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

-- p_muter muted p_muted.
create or replace function public.has_muted(p_muter uuid, p_muted uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_muter is not null and p_muted is not null and exists (
    select 1 from public.mutes m where m.muter_id = p_muter and m.muted_id = p_muted
  )
$$;

-- Restores done by the server itself (unblock) set this for the rest of the
-- transaction, so they do not tell anybody anything.
create or replace function public.activity_silent()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('bumelerze.activity_silent', true), '') = 'on'
$$;

-- The one writer of activity rows. Skips: no recipient, telling a person
-- about themself, a block either way, a mute by the recipient (except
-- family_safe), and the silent flag. p_refresh: a repeat of the same thing
-- brings the row back to the top as unread; otherwise only after a day (so
-- follow, unfollow, follow does not ring again and again).
create or replace function public.activity_add(
  p_user uuid,
  p_kind text,
  p_actor uuid,
  p_key text,
  p_comment uuid default null,
  p_post uuid default null,
  p_event uuid default null,
  p_tag uuid default null,
  p_log uuid default null,
  p_meta jsonb default '{}'::jsonb,
  p_refresh boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_key is null or public.activity_silent() then
    return;
  end if;
  if p_actor is not null then
    if p_actor = p_user or public.blocked_between(p_user, p_actor) then
      return;
    end if;
    if p_kind <> 'family_safe' and public.has_muted(p_user, p_actor) then
      return;
    end if;
  end if;
  insert into public.activity_items (
    user_id, kind, actor_id, comment_id, post_id, event_id, tag_id, log_id, meta, dedupe_key
  )
  values (
    p_user, p_kind, p_actor, p_comment, p_post, p_event, p_tag, p_log,
    coalesce(p_meta, '{}'::jsonb), p_key
  )
  on conflict (user_id, dedupe_key) do update
    set kind = excluded.kind,
        actor_id = excluded.actor_id,
        comment_id = excluded.comment_id,
        post_id = excluded.post_id,
        event_id = excluded.event_id,
        tag_id = excluded.tag_id,
        log_id = excluded.log_id,
        meta = excluded.meta,
        created_at = now(),
        read_at = null
  where p_refresh or activity_items.created_at < now() - interval '1 day';
end
$$;

-- "Helpful" marks: one row per comment or post per UTC day, with a count.
-- p_delta is +1 for a new mark, -1 when it is taken back the same day.
create or replace function public.activity_helpful(
  p_user uuid,
  p_actor uuid,
  p_kind text,
  p_comment uuid,
  p_post uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if p_user is null or p_actor is null or p_actor = p_user or public.activity_silent() then
    return;
  end if;
  if public.blocked_between(p_user, p_actor) or public.has_muted(p_user, p_actor) then
    return;
  end if;
  v_key := p_kind || ':' || coalesce(p_comment, p_post)::text || ':'
           || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  if p_delta > 0 then
    insert into public.activity_items (user_id, kind, actor_id, comment_id, post_id, event_id, meta, dedupe_key)
    values (
      p_user, p_kind, p_actor, p_comment, p_post,
      (select c.event_id from public.event_comments c where c.comment_id = p_comment),
      jsonb_build_object('count', 1), v_key
    )
    on conflict (user_id, dedupe_key) do update
      set actor_id = excluded.actor_id,
          meta = jsonb_build_object(
            'count', coalesce((activity_items.meta ->> 'count')::integer, 0) + 1),
          created_at = now(),
          read_at = null;
  else
    update public.activity_items a
       set meta = jsonb_build_object(
             'count', greatest(coalesce((a.meta ->> 'count')::integer, 0) - 1, 0))
     where a.user_id = p_user and a.dedupe_key = v_key;
    delete from public.activity_items a
     where a.user_id = p_user and a.dedupe_key = v_key
       and coalesce((a.meta ->> 'count')::integer, 0) <= 0;
  end if;
end
$$;

-- 3. Membership skips trashed homes ------------------------------------------------------------
-- 0037's two tests plus: the home is not in the trash. Every home policy, the
-- private photo bucket and 0057's family card use them, so a trashed home
-- closes for everybody at once, its owner included.
create or replace function public.is_home_member(p_tag uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.home_members m
      join public.home_tags t on t.tag_id = m.tag_id
     where m.tag_id = p_tag and m.user_id = auth.uid() and m.status = 'approved'
       and t.status <> 'trashed'
  )
$$;

create or replace function public.is_home_owner(p_tag uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.home_members m
      join public.home_tags t on t.tag_id = m.tag_id
     where m.tag_id = p_tag and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'approved'
       and t.status <> 'trashed'
  )
$$;

-- 4. Activity triggers ------------------------------------------------------------------------
-- Follows: a new follower, a request, a request accepted. A request that is
-- answered or withdrawn leaves the follow_request row behind no longer.
create or replace function public.activity_on_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      perform public.activity_add(new.followee_id, 'new_follower', new.follower_id,
        'follow:' || new.follower_id::text, p_refresh => false);
    else
      perform public.activity_add(new.followee_id, 'follow_request', new.follower_id,
        'follow_request:' || new.follower_id::text, p_refresh => false);
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'accepted' then
      delete from public.activity_items
       where user_id = new.followee_id and dedupe_key = 'follow_request:' || new.follower_id::text;
      perform public.activity_add(new.follower_id, 'follow_accepted', new.followee_id,
        'follow_accepted:' || new.followee_id::text, p_refresh => false);
    end if;
    return new;
  end if;
  if old.status = 'pending' then
    delete from public.activity_items
     where user_id = old.followee_id and dedupe_key = 'follow_request:' || old.follower_id::text;
  end if;
  return old;
end
$$;
drop trigger if exists activity_on_follows on public.follows;
create trigger activity_on_follows
  after insert or update of status or delete on public.follows
  for each row execute function public.activity_on_follows();

-- Replies: the author of the parent hears about a reply once it is visible
-- (a guest's reply after a moderator approves it). A reply that stops being
-- visible (deleted, hidden, removed, back to review) is taken back.
create or replace function public.activity_on_comments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_author uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.status = 'visible'
     and (tg_op = 'INSERT' or old.status is distinct from 'visible') then
    select c.user_id into v_parent_author
      from public.event_comments c
     where c.comment_id = new.parent_id
       and c.author_deleted_at is null
       and c.account_deleted_at is null;
    perform public.activity_add(v_parent_author, 'comment_reply', new.user_id,
      'reply:' || new.comment_id::text, new.comment_id, null, new.event_id);
  elsif tg_op = 'UPDATE' and old.status = 'visible' and new.status <> 'visible' then
    delete from public.activity_items
     where kind = 'comment_reply' and comment_id = new.comment_id;
  end if;
  return new;
end
$$;
drop trigger if exists activity_on_comments on public.event_comments;
create trigger activity_on_comments
  after insert or update of status on public.event_comments
  for each row execute function public.activity_on_comments();

create or replace function public.activity_on_comment_helpful()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  if tg_op = 'INSERT' then
    select c.user_id into v_author from public.event_comments c where c.comment_id = new.comment_id;
    perform public.activity_helpful(v_author, new.user_id, 'comment_helpful', new.comment_id, null, 1);
    return new;
  end if;
  select c.user_id into v_author from public.event_comments c where c.comment_id = old.comment_id;
  perform public.activity_helpful(v_author, old.user_id, 'comment_helpful', old.comment_id, null, -1);
  return old;
end
$$;
drop trigger if exists activity_on_comment_helpful on public.comment_reactions;
create trigger activity_on_comment_helpful
  after insert or delete on public.comment_reactions
  for each row execute function public.activity_on_comment_helpful();

create or replace function public.activity_on_post_helpful()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  if tg_op = 'INSERT' then
    select po.user_id into v_author from public.profile_posts po where po.post_id = new.post_id;
    perform public.activity_helpful(v_author, new.user_id, 'post_helpful', null, new.post_id, 1);
    return new;
  end if;
  select po.user_id into v_author from public.profile_posts po where po.post_id = old.post_id;
  perform public.activity_helpful(v_author, old.user_id, 'post_helpful', null, old.post_id, -1);
  return old;
end
$$;
drop trigger if exists activity_on_post_helpful on public.post_helpful;
create trigger activity_on_post_helpful
  after insert or delete on public.post_helpful
  for each row execute function public.activity_on_post_helpful();

-- Reporters of one piece of content: "we reviewed it", the same words
-- whatever the outcome. Withdrawn reports are left out.
create or replace function public.activity_reviewed(p_target text, p_id text, p_reporters uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r uuid;
begin
  for r in select distinct x from unnest(coalesce(p_reporters, '{}'::uuid[])) x where x is not null loop
    perform public.activity_add(r, 'report_reviewed', null,
      'reviewed:' || p_target || ':' || p_id, p_meta => jsonb_build_object('target', p_target));
  end loop;
end
$$;

-- Moderation, from the audit log every admin function writes (0052): the
-- author is told what was removed and why (statement of reasons); an undo or
-- approval takes that back; reporters hear that their report was reviewed;
-- reopening takes that back.
create or replace function public.activity_on_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event uuid;
  v_ids uuid[];
begin
  if new.action in ('comment_hide', 'comment_remove') and new.comment_id is not null then
    select c.event_id into v_event from public.event_comments c where c.comment_id = new.comment_id;
    perform public.activity_add(new.target_user_id, 'content_removed', null,
      'removed:comment:' || new.comment_id::text, new.comment_id, null, v_event, null, new.log_id,
      jsonb_build_object(
        'target', 'comment',
        'action', case when new.action = 'comment_hide' then 'hide' else 'remove' end,
        'reason', new.reason));
    select array_agg(f.user_id) into v_ids
      from public.comment_flags f
     where f.comment_id = new.comment_id and f.withdrawn_at is null;
    perform public.activity_reviewed('comment', new.comment_id::text, v_ids);
  elsif new.action in ('comment_approve', 'comment_restore') and new.comment_id is not null then
    delete from public.activity_items
     where dedupe_key = 'removed:comment:' || new.comment_id::text and kind = 'content_removed';
    if new.action = 'comment_approve' then
      select array_agg(f.user_id) into v_ids
        from public.comment_flags f
       where f.comment_id = new.comment_id and f.withdrawn_at is null;
      perform public.activity_reviewed('comment', new.comment_id::text, v_ids);
    end if;
  elsif new.action = 'post_remove' and new.post_id is not null then
    perform public.activity_add(new.target_user_id, 'content_removed', null,
      'removed:post:' || new.post_id::text, null, new.post_id, null, null, new.log_id,
      jsonb_build_object('target', 'post', 'action', 'remove', 'reason', new.reason));
    select array_agg(r.reporter_id) into v_ids
      from public.post_reports r
     where r.post_id = new.post_id
       and (r.resolved_at = now()
            or r.report_id::text in (
              select j.value from jsonb_array_elements_text(
                case when jsonb_typeof(new.snapshot -> 'report_ids') = 'array'
                     then new.snapshot -> 'report_ids' else '[]'::jsonb end) j));
    perform public.activity_reviewed('post', new.post_id::text, v_ids);
  elsif new.action = 'post_restore' and new.post_id is not null then
    delete from public.activity_items
     where dedupe_key = 'removed:post:' || new.post_id::text and kind = 'content_removed';
  elsif new.action = 'post_reports_dismiss' and new.post_id is not null then
    select array_agg(r.reporter_id) into v_ids
      from public.post_reports r
     where r.post_id = new.post_id
       and (r.resolved_at = now()
            or r.report_id::text in (
              select j.value from jsonb_array_elements_text(
                case when jsonb_typeof(new.snapshot -> 'report_ids') = 'array'
                     then new.snapshot -> 'report_ids' else '[]'::jsonb end) j));
    perform public.activity_reviewed('post', new.post_id::text, v_ids);
  elsif new.action = 'profile_reports_resolve' and new.target_user_id is not null then
    select array_agg(r.reporter_id) into v_ids
      from public.profile_reports r
     where r.reported_id = new.target_user_id
       and (r.resolved_at = now()
            or r.report_id::text in (
              select j.value from jsonb_array_elements_text(
                case when jsonb_typeof(new.snapshot -> 'report_ids') = 'array'
                     then new.snapshot -> 'report_ids' else '[]'::jsonb end) j));
    perform public.activity_reviewed('profile', new.target_user_id::text, v_ids);
  elsif new.action = 'report_reopen' and new.target_id is not null then
    delete from public.activity_items
     where kind = 'report_reviewed'
       and dedupe_key = 'reviewed:' || coalesce(new.target_type, '') || ':' || new.target_id;
  end if;
  return new;
end
$$;
drop trigger if exists activity_on_moderation on public.moderation_log;
create trigger activity_on_moderation
  after insert on public.moderation_log
  for each row execute function public.activity_on_moderation();

-- Ranks with a public mark. Who granted it is never said.
create or replace function public.activity_on_roles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.role in ('official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
      perform public.activity_add(new.user_id, 'badge_granted', null, 'badge:' || new.role,
        p_meta => jsonb_build_object('role', new.role, 'org_name', new.org_name));
    end if;
    return new;
  end if;
  delete from public.activity_items
   where user_id = old.user_id and dedupe_key = 'badge:' || old.role;
  return old;
end
$$;
drop trigger if exists activity_on_roles on public.user_roles;
create trigger activity_on_roles
  after insert or delete on public.user_roles
  for each row execute function public.activity_on_roles();

-- Homes: a join request reaches the owners; an approval reaches the new
-- member. An answered or withdrawn request leaves the owners' list.
create or replace function public.activity_on_home_members()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      for r in
        select m.user_id
          from public.home_members m
          join public.home_tags t on t.tag_id = m.tag_id
         where m.tag_id = new.tag_id and m.role = 'owner' and m.status = 'approved'
           and t.status = 'active'
      loop
        perform public.activity_add(r.user_id, 'home_join_request', new.user_id,
          'home_request:' || new.tag_id::text || ':' || new.user_id::text, null, null, null, new.tag_id);
      end loop;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'approved' then
      delete from public.activity_items
       where kind = 'home_join_request'
         and dedupe_key = 'home_request:' || new.tag_id::text || ':' || new.user_id::text;
      perform public.activity_add(new.user_id, 'home_join_approved',
        case when auth.uid() is distinct from new.user_id then auth.uid() else null end,
        'home_approved:' || new.tag_id::text, null, null, null, new.tag_id);
    end if;
    return new;
  end if;
  delete from public.activity_items
   where kind = 'home_join_request'
     and dedupe_key = 'home_request:' || old.tag_id::text || ':' || old.user_id::text;
  return old;
end
$$;
drop trigger if exists activity_on_home_members on public.home_members;
create trigger activity_on_home_members
  after insert or update of status or delete on public.home_members
  for each row execute function public.activity_on_home_members();

-- "I'm safe": the approved members of every ACTIVE home the person shares
-- check-ins with, who joined before the check-in (0057's family_checkins
-- rules). One row per reader per event, never a place. Taking the check-in
-- back takes the rows back.
create or replace function public.activity_on_checkins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' and new.status = 'safe' and new.event_id is not null then
    for r in
      select distinct on (reader.user_id) reader.user_id, reader.tag_id
        from public.home_members me
        join public.home_tags t on t.tag_id = me.tag_id and t.status = 'active'
        join public.home_members reader
          on reader.tag_id = me.tag_id
         and reader.status = 'approved'
         and reader.user_id <> me.user_id
       where me.user_id = new.user_id
         and me.status = 'approved'
         and me.share_checkins
         and coalesce(reader.decided_at, reader.requested_at) <= new.created_at
       order by reader.user_id, t.created_at
    loop
      perform public.activity_add(r.user_id, 'family_safe', new.user_id,
        'safe:' || new.user_id::text || ':' || new.event_id::text, null, null, new.event_id, r.tag_id);
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'safe' and new.status = 'retracted' and old.event_id is not null then
    delete from public.activity_items
     where kind = 'family_safe'
       and dedupe_key = 'safe:' || old.user_id::text || ':' || old.event_id::text;
  end if;
  return new;
end
$$;
drop trigger if exists activity_on_checkins on public.safety_checkins;
create trigger activity_on_checkins
  after insert or update of status on public.safety_checkins
  for each row execute function public.activity_on_checkins();

-- 5. Reading the list ---------------------------------------------------------------------------
-- The caller's rows that may still be shown: 90 days; nothing from a person
-- blocked either way; nothing from a muted or suspended person except a
-- family member's check-in; home rows only while the home is active and the
-- reader is still an approved member (and, for a check-in, the person still
-- shares with that home); a reply only while it is visible; Helpful only
-- while the comment or post is still up. Internal.
create or replace function public.activity_visible(p_user uuid)
returns setof public.activity_items
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.*
    from public.activity_items a
   where a.user_id = p_user
     and a.created_at > now() - interval '90 days'
     and (
       a.actor_id is null
       or (
         not public.blocked_between(p_user, a.actor_id)
         and (
           a.kind = 'family_safe'
           or (not public.has_muted(p_user, a.actor_id) and not public.is_suspended(a.actor_id))
         )
       )
     )
     and (
       a.tag_id is null
       or exists (
         select 1
           from public.home_members m
           join public.home_tags t on t.tag_id = m.tag_id and t.status = 'active'
          where m.tag_id = a.tag_id and m.user_id = p_user and m.status = 'approved'
       )
     )
     and (
       a.kind <> 'family_safe'
       or exists (
         select 1 from public.home_members s
          where s.tag_id = a.tag_id and s.user_id = a.actor_id
            and s.status = 'approved' and s.share_checkins
       )
     )
     and (
       a.kind <> 'comment_reply'
       or exists (
         select 1 from public.event_comments c
          where c.comment_id = a.comment_id and c.status = 'visible'
       )
     )
     and (
       a.kind <> 'comment_helpful'
       or exists (
         select 1 from public.event_comments c
          where c.comment_id = a.comment_id and c.status = 'visible' and c.user_id = p_user
       )
     )
     and (
       a.kind <> 'post_helpful'
       or exists (
         select 1 from public.profile_posts po
          where po.post_id = a.post_id and po.status = 'visible' and po.user_id = p_user
       )
     )
$$;

-- The list behind the Activity screen, newest first, a page at a time. Only
-- public fields of other people (name, @username, photo); the event's public
-- fields; for a reply, the visible reply's first 140 characters; for a home,
-- its label and code (the reader is a member).
create or replace function public.my_activity(p_limit integer default 50, p_before timestamptz default null)
returns table (
  item_id uuid,
  kind text,
  created_at timestamptz,
  read_at timestamptz,
  actor_id uuid,
  actor_username text,
  actor_name text,
  actor_avatar text,
  item_count integer,
  role text,
  org_name text,
  target text,
  action text,
  reason text,
  appealed boolean,
  hub_id text,
  place text,
  magnitude numeric,
  snippet text,
  comment_id uuid,
  post_id uuid,
  tag_id uuid,
  home_label text,
  home_code text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  return query
    select a.item_id, a.kind, a.created_at, a.read_at, a.actor_id,
           p.username::text, p.display_name::text, p.avatar_path::text,
           coalesce((a.meta ->> 'count')::integer, 1),
           (a.meta ->> 'role')::text, (a.meta ->> 'org_name')::text,
           (a.meta ->> 'target')::text, (a.meta ->> 'action')::text,
           (a.meta ->> 'reason')::text,
           (a.meta ->> 'appealed_at') is not null,
           e.bumelerze_id::text, e.place::text, e.magnitude::numeric,
           case when a.kind = 'comment_reply' then left(rc.body, 140) else null end,
           a.comment_id, a.post_id, a.tag_id,
           t.label::text, t.code::text
      from public.activity_visible(v_uid) a
      left join public.profiles p on p.user_id = a.actor_id
      left join public.events e0 on e0.event_id = a.event_id
      left join public.events e on e.event_id = coalesce(e0.merged_into, e0.event_id)
      left join public.event_comments rc on rc.comment_id = a.comment_id and rc.status = 'visible'
      left join public.home_tags t on t.tag_id = a.tag_id
     where p_before is null or a.created_at < p_before
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- The number on the bell: unread rows that may be shown, at most 99.
create or replace function public.my_activity_unread()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null then 0 else (
    select least(count(*), 99)::integer
      from public.activity_visible(auth.uid()) a
     where a.read_at is null
  ) end
$$;

-- Mark some rows (or, with no ids, all of them) as read. Returns how many.
create or replace function public.mark_activity_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update public.activity_items
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or item_id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- "Ask for review" on a removed comment or post: one feedback row of
-- category appeal per removal (0054's pattern), with the person's optional
-- words (at most 1000 characters). Tokens: not_account, not_found,
-- already_requested.
create or replace function public.request_content_review(p_item uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  a record;
  v_msg text := left(btrim(coalesce(p_message, '')), 1000);
  v_ref text;
  v_fid uuid;
begin
  if v_uid is null then
    raise exception 'request_content_review: not_account' using errcode = '42501';
  end if;
  select i.item_id as item_id, i.meta as meta, i.comment_id as comment_id,
         i.post_id as post_id, i.log_id as log_id
    into a
    from public.activity_items i
   where i.item_id = p_item and i.user_id = v_uid and i.kind = 'content_removed'
   for update;
  if not found then
    raise exception 'request_content_review: not_found' using errcode = 'P0002';
  end if;
  if (a.meta ->> 'appealed_at') is not null then
    raise exception 'request_content_review: already_requested' using errcode = '22023';
  end if;
  v_ref := coalesce(a.meta ->> 'target', 'content') || ' '
           || coalesce(a.comment_id, a.post_id)::text;
  insert into public.feedback (device_id, user_id, message)
  values (
    'appeal-' || a.item_id::text,
    v_uid,
    'Review request for removed ' || v_ref
      || ' (reason: ' || coalesce(a.meta ->> 'reason', 'none') || ')'
      || case when a.log_id is not null then ' log ' || a.log_id::text else '' end
      || case when v_msg <> '' then E'\n\n' || v_msg else '' end
  )
  returning feedback_id into v_fid;
  update public.feedback set category = 'appeal' where feedback_id = v_fid;
  update public.activity_items
     set meta = meta || jsonb_build_object('appealed_at', now())
   where item_id = a.item_id;
end
$$;

-- 6. Mute ------------------------------------------------------------------------------------------
create or replace function public.mute_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'mute_user: not_account' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_uid or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'mute_user: not_found' using errcode = '22023';
  end if;
  if (select count(*) from public.mutes m where m.muter_id = v_uid) >= 500 then
    raise exception 'mute_user: rate_limited' using errcode = '54000';
  end if;
  insert into public.mutes (muter_id, muted_id) values (v_uid, p_user)
  on conflict do nothing;
end
$$;

create or replace function public.unmute_user(p_user uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.mutes where muter_id = auth.uid() and muted_id = p_user
$$;

-- The people I muted (public fields only; a guest has no profile, so its
-- name fields are empty).
create or replace function public.my_mutes()
returns table (
  person_id uuid,
  username text,
  display_name text,
  avatar_path text,
  muted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
    select m.muted_id, p.username::text, p.display_name::text, p.avatar_path::text, m.created_at
      from public.mutes m
      left join public.profiles p on p.user_id = m.muted_id
     where m.muter_id = auth.uid()
     order by m.created_at desc
     limit 500;
end
$$;

-- 7. Block keeps the follows it removed; unblock within 24 hours gives them back ---------------
-- 0047's block_user plus: the removed follows are stored on the block row,
-- and the activity rows between the two people are deleted.
create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_removed jsonb;
begin
  if v_uid is null then
    raise exception 'block_user: not_account' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'block_user: not_found' using errcode = '22023';
  end if;
  if exists (select 1 from public.blocks b where b.blocker_id = v_uid and b.blocked_id = p_user) then
    return;
  end if;
  if (select count(*) from public.blocks b where b.blocker_id = v_uid) >= 500 then
    raise exception 'block_user: rate_limited' using errcode = '54000';
  end if;
  with removed as (
    delete from public.follows
     where (follower_id = v_uid and followee_id = p_user)
        or (follower_id = p_user and followee_id = v_uid)
    returning follower_id, followee_id, status, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'follower_id', removed.follower_id, 'followee_id', removed.followee_id,
           'status', removed.status, 'created_at', removed.created_at)), '[]'::jsonb)
    into v_removed
    from removed;
  insert into public.blocks (blocker_id, blocked_id, removed_follows)
  values (v_uid, p_user, v_removed)
  on conflict do nothing;
  delete from public.activity_items
   where (user_id = v_uid and actor_id = p_user)
      or (user_id = p_user and actor_id = v_uid);
end
$$;

-- 0047's unblock_user plus: within 24 hours of the block, the follows it
-- removed come back as they were (a request to an account that went public
-- meanwhile comes back accepted), unless the other person has blocked too.
-- Quietly: nobody gets an activity row for it.
create or replace function public.unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_created timestamptz;
  v_removed jsonb;
  v_status text;
  v_private boolean;
  f record;
begin
  if v_uid is null then
    return;
  end if;
  delete from public.blocks
   where blocker_id = v_uid and blocked_id = p_user
  returning created_at, removed_follows into v_created, v_removed;
  if not found or v_created < now() - interval '24 hours'
     or jsonb_typeof(v_removed) is distinct from 'array'
     or public.blocked_between(v_uid, p_user) then
    return;
  end if;
  perform set_config('bumelerze.activity_silent', 'on', true);
  for f in
    select (j.value ->> 'follower_id')::uuid as follower_id,
           (j.value ->> 'followee_id')::uuid as followee_id,
           j.value ->> 'status' as status,
           (j.value ->> 'created_at')::timestamptz as created_at
      from jsonb_array_elements(v_removed) j
  loop
    continue when f.follower_id is null or f.followee_id is null
                  or f.follower_id = f.followee_id
                  or f.follower_id not in (v_uid, p_user)
                  or f.followee_id not in (v_uid, p_user);
    select p.is_private into v_private from public.profiles p where p.user_id = f.followee_id;
    continue when not found
                  or not exists (select 1 from public.profiles q where q.user_id = f.follower_id);
    v_status := 'pending';
    if f.status = 'accepted' or not coalesce(v_private, true) then
      v_status := 'accepted';
    end if;
    insert into public.follows (follower_id, followee_id, status, created_at)
    values (f.follower_id, f.followee_id, v_status, coalesce(f.created_at, now()))
    on conflict do nothing;
  end loop;
  perform set_config('bumelerze.activity_silent', 'off', true);
end
$$;

-- 8. Home trash ------------------------------------------------------------------------------------
-- The real delete of a home, as delete_home_tag() does (rows cascade; a
-- building complex left without homes goes too). Internal.
create or replace function public.hard_delete_home(p_tag uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_complex uuid;
begin
  select complex_id into v_complex from public.home_tags where tag_id = p_tag;
  delete from public.home_tags where tag_id = p_tag;
  if v_complex is not null
     and not exists (select 1 from public.home_tags where complex_id = v_complex) then
    delete from public.building_complexes where complex_id = v_complex;
  end if;
end
$$;

-- Owner of a home whatever its state (is_home_owner skips trashed homes).
create or replace function public.owns_home_any_state(p_tag uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.home_tags t
     where t.tag_id = p_tag
       and (
         t.owner_user_id = auth.uid()
         or exists (
           select 1 from public.home_members m
            where m.tag_id = t.tag_id and m.user_id = auth.uid()
              and m.role = 'owner' and m.status = 'approved'
         )
       )
  )
$$;

-- "Delete this home" in the app: into the trash for 14 days. Owners only.
create or replace function public.trash_home_tag(p_tag uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_at timestamptz := now();
begin
  if not public.is_home_owner(p_tag) then
    raise exception 'trash_home_tag: owners only' using errcode = '42501';
  end if;
  update public.home_tags
     set status = 'trashed', trashed_at = v_at, updated_at = v_at
   where tag_id = p_tag;
  return jsonb_build_object('tag_id', p_tag, 'purge_at', v_at + interval '14 days');
end
$$;

-- Bring a trashed home back within 14 days, if the owner has room (5 homes).
create or replace function public.restore_home_tag(p_tag uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t record;
begin
  if not public.owns_home_any_state(p_tag) then
    raise exception 'restore_home_tag: not_found' using errcode = 'P0002';
  end if;
  select h.status as status, h.trashed_at as trashed_at
    into t
    from public.home_tags h where h.tag_id = p_tag
   for update;
  if t.status <> 'trashed' then
    return;
  end if;
  if t.trashed_at < now() - interval '14 days' then
    raise exception 'restore_home_tag: expired' using errcode = '22023';
  end if;
  if (select count(*) from public.home_tags h
       where h.owner_user_id = auth.uid() and h.status = 'active') >= 5 then
    raise exception 'restore_home_tag: limit' using errcode = '54000';
  end if;
  update public.home_tags
     set status = 'active', trashed_at = null, updated_at = now()
   where tag_id = p_tag;
end
$$;

-- Delete a trashed home now instead of waiting. Its photo files are queued
-- for the purge function (trigger below).
create or replace function public.delete_home_now(p_tag uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.owns_home_any_state(p_tag) then
    raise exception 'delete_home_now: not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.home_tags t where t.tag_id = p_tag and t.status = 'trashed') then
    raise exception 'delete_home_now: not_trashed' using errcode = '22023';
  end if;
  perform public.hard_delete_home(p_tag);
end
$$;

-- My homes in the trash: no coordinates, no answers.
create or replace function public.my_trashed_homes()
returns table (
  tag_id uuid,
  code text,
  kind text,
  label text,
  unit_label text,
  trashed_at timestamptz,
  purge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
    select t.tag_id, t.code::text, t.kind::text, t.label::text, t.unit_label::text,
           t.trashed_at, t.trashed_at + interval '14 days'
      from public.home_tags t
     where t.status = 'trashed'
       and t.trashed_at is not null
       and public.owns_home_any_state(t.tag_id)
     order by t.trashed_at desc;
end
$$;

-- Every deleted home whose folder still holds photo files is queued for the
-- purge-home-photos edge function (SQL cannot delete storage objects).
create or replace function public.home_tags_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if exists (
    select 1 from storage.objects o
     where o.bucket_id = 'home-photos' and o.name like old.tag_id::text || '/%'
  ) then
    insert into public.home_photo_purge (tag_id) values (old.tag_id)
    on conflict (tag_id) do nothing;
  end if;
  return old;
end
$$;
drop trigger if exists home_tags_after_delete on public.home_tags;
create trigger home_tags_after_delete
  after delete on public.home_tags
  for each row execute function public.home_tags_after_delete();

-- 9. Download my data ---------------------------------------------------------------------------
-- One JSON document. Everything is the caller's own; other people appear by
-- public id, @username and display name only.
create or replace function public.export_person(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id', p_user,
    'username', (select p.username from public.profiles p where p.user_id = p_user),
    'display_name', (select p.display_name from public.profiles p where p.user_id = p_user)
  )
$$;

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
  if v_uid is null then
    raise exception 'export_my_data: not_account' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format', 'bumelerze-export-1',
    'generated_at', now(),
    'account', (
      select jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'is_guest', u.is_anonymous, 'created_at', u.created_at)
        from auth.users u where u.id = v_uid
    ),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = v_uid),
    'private_profile', (select to_jsonb(pp) from public.profile_private pp where pp.user_id = v_uid),
    'consents', jsonb_build_object(
      'terms_and_research', (
        select jsonb_build_object(
          'terms_version', pp.terms_version, 'terms_accepted_at', pp.terms_accepted_at,
          'research_consent_version', pp.research_consent_version,
          'research_consent_at', pp.research_consent_at)
          from public.profile_private pp where pp.user_id = v_uid
      ),
      'community_guidelines', (
        select jsonb_build_object(
          'version', g.version, 'age_confirmed', g.age_confirmed,
          'source', g.source, 'accepted_at', g.accepted_at)
          from public.guidelines_acceptance g where g.user_id = v_uid
      )
    ),
    'ranks', coalesce((
      select jsonb_agg(jsonb_build_object('role', r.role, 'org_name', r.org_name, 'granted_at', r.granted_at))
        from public.user_roles r where r.user_id = v_uid
    ), '[]'::jsonb),
    'name_changes', coalesce((
      select jsonb_agg(jsonb_build_object('field', n.field, 'old_value', n.old_value, 'changed_at', n.changed_at)
                       order by n.changed_at)
        from public.profile_name_changes n where n.user_id = v_uid
    ), '[]'::jsonb),
    'felt_reports', coalesce((
      select jsonb_agg(to_jsonb(fr) || jsonb_build_object(
               'details', (select to_jsonb(d) - 'felt_report_id' from public.felt_report_details d
                            where d.felt_report_id = fr.report_id),
               'photos', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'storage_path', ph.storage_path, 'status', ph.moderation_status,
                          'created_at', ph.created_at))
                   from public.felt_photos ph where ph.report_id = fr.report_id
               ), '[]'::jsonb),
               'comments', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'body', fc.body, 'status', fc.moderation_status, 'created_at', fc.created_at))
                   from public.felt_comments fc
                  where fc.report_id = fr.report_id and fc.user_id = v_uid
               ), '[]'::jsonb))
             order by fr.created_at)
        from public.felt_reports fr where fr.user_id = v_uid
    ), '[]'::jsonb),
    'event_comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'comment_id', c.comment_id, 'event_id', c.event_id, 'parent_id', c.parent_id,
               'body', c.body, 'area_geohash', c.area_geohash, 'status', c.status,
               'hidden_reason', c.hidden_reason, 'helpful_count', c.helpful_count,
               'created_at', c.created_at, 'updated_at', c.updated_at,
               'deleted_by_me_at', c.author_deleted_at)
             order by c.created_at)
        from public.event_comments c where c.user_id = v_uid
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'post_id', po.post_id, 'kind', po.kind, 'event_id', po.event_id, 'body', po.body,
               'status', po.status, 'removed_reason', po.removed_reason,
               'created_at', po.created_at, 'edited_at', po.edited_at, 'deleted_at', po.deleted_at)
             order by po.created_at)
        from public.profile_posts po where po.user_id = v_uid
    ), '[]'::jsonb),
    'helpful_given', jsonb_build_object(
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object('comment_id', cr.comment_id, 'created_at', cr.created_at))
          from public.comment_reactions cr where cr.user_id = v_uid
      ), '[]'::jsonb),
      'posts', coalesce((
        select jsonb_agg(jsonb_build_object('post_id', ph.post_id, 'created_at', ph.created_at))
          from public.post_helpful ph where ph.user_id = v_uid
      ), '[]'::jsonb)
    ),
    'reports_made', jsonb_build_object(
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'comment_id', f.comment_id, 'reason', f.reason, 'note', f.note,
                 'created_at', f.created_at, 'withdrawn_at', f.withdrawn_at))
          from public.comment_flags f where f.user_id = v_uid
      ), '[]'::jsonb),
      'posts', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'post_id', r.post_id, 'reason', r.reason, 'note', r.note,
                 'created_at', r.created_at, 'resolved_at', r.resolved_at))
          from public.post_reports r where r.reporter_id = v_uid
      ), '[]'::jsonb),
      'profiles', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'person', public.export_person(r.reported_id), 'reason', r.reason, 'note', r.note,
                 'created_at', r.created_at, 'resolved_at', r.resolved_at))
          from public.profile_reports r where r.reporter_id = v_uid
      ), '[]'::jsonb)
    ),
    'following', coalesce((
      select jsonb_agg(public.export_person(f.followee_id)
                       || jsonb_build_object('status', f.status, 'since', f.created_at))
        from public.follows f where f.follower_id = v_uid
    ), '[]'::jsonb),
    'followers', coalesce((
      select jsonb_agg(public.export_person(f.follower_id)
                       || jsonb_build_object('status', f.status, 'since', f.created_at))
        from public.follows f where f.followee_id = v_uid
    ), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(public.export_person(b.blocked_id) || jsonb_build_object('since', b.created_at))
        from public.blocks b where b.blocker_id = v_uid
    ), '[]'::jsonb),
    'muted', coalesce((
      select jsonb_agg(public.export_person(m.muted_id) || jsonb_build_object('since', m.created_at))
        from public.mutes m where m.muter_id = v_uid
    ), '[]'::jsonb),
    'homes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'code', t.code, 'kind', t.kind, 'label', t.label, 'unit_label', t.unit_label,
                 'status', t.status, 'trashed_at', t.trashed_at, 'created_at', t.created_at,
                 'my_role', hm.role, 'my_status', hm.status, 'requested_at', hm.requested_at,
                 'approved_at', hm.decided_at, 'share_checkins', hm.share_checkins,
                 'i_own_it', (t.owner_user_id = v_uid),
                 'my_answers', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'version', s.version, 'answers', s.answers, 'created_at', s.created_at)
                          order by s.created_at)
                     from public.home_surveys s where s.tag_id = t.tag_id and s.user_id = v_uid
                 ), '[]'::jsonb),
                 'my_photos', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'path', hp.path, 'slot', hp.slot, 'caption', hp.caption,
                            'created_at', hp.created_at))
                     from public.home_photos hp where hp.tag_id = t.tag_id and hp.user_id = v_uid
                 ), '[]'::jsonb)
               )
               || case when t.owner_user_id = v_uid then jsonb_build_object(
                    'lat', t.lat, 'lon', t.lon,
                    'assessments', coalesce((
                      select jsonb_agg(jsonb_build_object(
                               'method', ha.method, 'vc_most_likely', ha.vc_most_likely,
                               'vc_range', ha.vc_range, 'vc_probs', ha.vc_probs,
                               'ims_type_probs', ha.ims_type_probs, 'confidence', ha.confidence,
                               'hazard', ha.hazard, 'created_at', ha.created_at)
                             order by ha.created_at)
                        from public.home_assessments ha where ha.tag_id = t.tag_id
                    ), '[]'::jsonb))
                  else '{}'::jsonb end
             order by t.created_at)
        from public.home_tags t
        left join public.home_members hm on hm.tag_id = t.tag_id and hm.user_id = v_uid
       where t.owner_user_id = v_uid or hm.user_id is not null
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', sc.event_id, 'status', sc.status,
               'checked_in_at', sc.checked_in_at, 'created_at', sc.created_at)
             order by sc.created_at)
        from public.safety_checkins sc where sc.user_id = v_uid
    ), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object(
               'message', fb.message, 'contact', fb.contact, 'category', fb.category,
               'status', fb.status, 'created_at', fb.created_at, 'app_version', fb.app_version,
               'locale', fb.locale, 'platform', fb.platform,
               'screenshots', (select count(*) from public.feedback_photos fp where fp.feedback_id = fb.feedback_id))
             order by fb.created_at)
        from public.feedback fb where fb.user_id = v_uid
    ), '[]'::jsonb),
    'alert_settings', (
      select to_jsonb(ns) - 'subscription_id'
        from public.notification_subscriptions ns where ns.user_id = v_uid
    ),
    'app_presence', (select to_jsonb(ap) from public.app_presence ap where ap.user_id = v_uid),
    'account_limits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'level', ar.level, 'reason', ar.reason, 'starts_at', ar.starts_at,
               'ends_at', ar.ends_at, 'lifted_at', ar.lifted_at,
               'review_requested_at', ar.appeal_requested_at)
             order by ar.created_at)
        from public.account_restrictions ar where ar.user_id = v_uid
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind, 'created_at', a.created_at, 'read_at', a.read_at,
               'from', case when a.actor_id is null then null else public.export_person(a.actor_id) end,
               'comment_id', a.comment_id, 'post_id', a.post_id, 'event_id', a.event_id,
               'details', a.meta)
             order by a.created_at)
        from public.activity_items a where a.user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;

-- 10. Nightly purge: activity after 90 days, trashed homes after 14 days -------------------------
create or replace function public.purge_activity_and_home_trash()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_activity integer;
  n_homes integer := 0;
  r record;
begin
  delete from public.activity_items where created_at < now() - interval '90 days';
  get diagnostics n_activity = row_count;
  for r in
    select t.tag_id from public.home_tags t
     where t.status = 'trashed' and t.trashed_at < now() - interval '14 days'
  loop
    perform public.hard_delete_home(r.tag_id);
    n_homes := n_homes + 1;
  end loop;
  return jsonb_build_object('activity', n_activity, 'homes', n_homes);
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_activity_and_home_trash') then
    perform cron.unschedule('purge_activity_and_home_trash');
  end if;
  perform cron.schedule('purge_activity_and_home_trash', '45 3 * * *', $cron$select public.purge_activity_and_home_trash();$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule purge_activity_and_home_trash by hand', sqlerrm;
end
$$;

-- The photo files: the purge-home-photos edge function, nightly after the
-- purge (same call shape as 0017). Until the function is deployed the call
-- only fails quietly and the queue waits; nothing is lost.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_home_photos') then
    perform cron.unschedule('purge_home_photos');
  end if;
  perform cron.schedule('purge_home_photos', '15 4 * * *', $cron$SELECT net.http_post(url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/purge-home-photos', body := '{}'::jsonb, params := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I', 'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'), timeout_milliseconds := 30000);$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule purge_home_photos by hand', sqlerrm;
end
$$;

-- 11. Who may call what ----------------------------------------------------------------------------
revoke all on function public.blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.has_muted(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activity_silent() from public, anon, authenticated;
revoke all on function public.activity_add(uuid, text, uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.activity_helpful(uuid, uuid, text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.activity_reviewed(text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.activity_on_follows() from public, anon, authenticated;
revoke all on function public.activity_on_comments() from public, anon, authenticated;
revoke all on function public.activity_on_comment_helpful() from public, anon, authenticated;
revoke all on function public.activity_on_post_helpful() from public, anon, authenticated;
revoke all on function public.activity_on_moderation() from public, anon, authenticated;
revoke all on function public.activity_on_roles() from public, anon, authenticated;
revoke all on function public.activity_on_home_members() from public, anon, authenticated;
revoke all on function public.activity_on_checkins() from public, anon, authenticated;
revoke all on function public.activity_visible(uuid) from public, anon, authenticated;
revoke all on function public.hard_delete_home(uuid) from public, anon, authenticated;
revoke all on function public.home_tags_after_delete() from public, anon, authenticated;
revoke all on function public.export_person(uuid) from public, anon, authenticated;
revoke all on function public.purge_activity_and_home_trash() from public, anon, authenticated;
revoke all on function public.my_activity(integer, timestamptz) from public, anon;
revoke all on function public.my_activity_unread() from public, anon;
revoke all on function public.mark_activity_read(uuid[]) from public, anon;
revoke all on function public.request_content_review(uuid, text) from public, anon;
revoke all on function public.mute_user(uuid) from public, anon;
revoke all on function public.unmute_user(uuid) from public, anon;
revoke all on function public.my_mutes() from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.owns_home_any_state(uuid) from public, anon, authenticated;
revoke all on function public.trash_home_tag(uuid) from public, anon;
revoke all on function public.restore_home_tag(uuid) from public, anon;
revoke all on function public.delete_home_now(uuid) from public, anon;
revoke all on function public.my_trashed_homes() from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.is_home_member(uuid) from public;
revoke all on function public.is_home_owner(uuid) from public;
grant execute on function public.my_activity(integer, timestamptz) to authenticated;
grant execute on function public.my_activity_unread() to authenticated;
grant execute on function public.mark_activity_read(uuid[]) to authenticated;
grant execute on function public.request_content_review(uuid, text) to authenticated;
grant execute on function public.mute_user(uuid) to authenticated;
grant execute on function public.unmute_user(uuid) to authenticated;
grant execute on function public.my_mutes() to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.trash_home_tag(uuid) to authenticated;
grant execute on function public.restore_home_tag(uuid) to authenticated;
grant execute on function public.delete_home_now(uuid) to authenticated;
grant execute on function public.my_trashed_homes() to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.is_home_member(uuid) to authenticated;
grant execute on function public.is_home_owner(uuid) to authenticated;
grant execute on function public.purge_activity_and_home_trash() to service_role;
grant select, delete on public.home_photo_purge to service_role;
