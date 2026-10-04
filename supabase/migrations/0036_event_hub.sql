-- 0036: the Event hub — threaded comments per earthquake, helpful marks,
-- flags, roles, and a privacy-safe felt summary.
-- Design: tag-my-building-design-draft-2026-10-04.md and
-- community-roles-badges-draft-2026-10-04.md in the project brain.
-- Owner: button "Who felt it?" opens the page titled "Event hub".
--
-- Trust tiers: an account's comment is visible at once (post-moderated);
-- an anonymous comment waits for review. The commenter's area comes from
-- THEIR OWN felt report for that event (server-filled, geohash-5 ≈ 5 km),
-- never from the client, so a place cannot be faked or a home revealed.

-- 1. Roles: granted by us, public marks ------------------------------------
create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('official', 'moderator', 'engineer', 'partner')),
  org_name text check (org_name is null or char_length(org_name) <= 80),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select to anon, authenticated using (true);
-- no client writes: roles are granted with the service key / SQL editor.

create or replace function public.is_moderator(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user and r.role in ('official', 'moderator')
  )
$$;

-- 2. Comments ----------------------------------------------------------------
create table if not exists public.event_comments (
  comment_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (event_id) on delete cascade,
  parent_id uuid references public.event_comments (comment_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  area_geohash text,
  status text not null default 'pending' check (status in ('visible', 'pending', 'hidden')),
  hidden_reason text,
  helpful_count integer not null default 0,
  reply_count integer not null default 0,
  flag_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_comments_event_idx on public.event_comments (event_id, created_at);
create index if not exists event_comments_parent_idx on public.event_comments (parent_id);
create index if not exists event_comments_user_idx on public.event_comments (user_id, created_at);
alter table public.event_comments enable row level security;

drop policy if exists event_comments_read on public.event_comments;
create policy event_comments_read on public.event_comments
  for select to anon, authenticated
  using (status = 'visible' or user_id = auth.uid() or public.is_moderator(auth.uid()));

drop policy if exists event_comments_insert on public.event_comments;
create policy event_comments_insert on public.event_comments
  for insert to authenticated
  with check (user_id = auth.uid());

-- Server decides status, area, depth and pace — whatever the client sends.
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
  new.created_at := now();
  new.updated_at := now();
  new.helpful_count := 0;
  new.reply_count := 0;
  new.flag_count := 0;
  new.hidden_reason := null;
  new.status := case when v_anonymous then 'pending' else 'visible' end;
  new.body := btrim(new.body);

  if new.parent_id is not null then
    select parent_id, event_id into v_parent from public.event_comments where comment_id = new.parent_id;
    if not found or v_parent.event_id <> new.event_id then
      raise exception 'event_comments: reply target not found' using errcode = '22023';
    end if;
    if v_parent.parent_id is not null then
      -- one level of replies: answer the thread, not the reply
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
drop trigger if exists event_comments_before_insert on public.event_comments;
create trigger event_comments_before_insert before insert on public.event_comments
  for each row execute function public.event_comments_before_insert();

create or replace function public.event_comments_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parent_id is not null then
    update public.event_comments set reply_count = reply_count + 1 where comment_id = new.parent_id;
  end if;
  return new;
end
$$;
drop trigger if exists event_comments_after_insert on public.event_comments;
create trigger event_comments_after_insert after insert on public.event_comments
  for each row execute function public.event_comments_after_insert();

-- 3. Helpful marks (accounts only) and flags (anyone signed in) ----------------
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.event_comments (comment_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'helpful' check (kind in ('helpful')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, kind)
);
alter table public.comment_reactions enable row level security;
drop policy if exists comment_reactions_read_own on public.comment_reactions;
create policy comment_reactions_read_own on public.comment_reactions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists comment_reactions_insert_own on public.comment_reactions;
create policy comment_reactions_insert_own on public.comment_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
    and not exists (select 1 from public.event_comments c where c.comment_id = comment_reactions.comment_id and c.user_id = auth.uid())
  );
drop policy if exists comment_reactions_delete_own on public.comment_reactions;
create policy comment_reactions_delete_own on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.comment_reactions_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.event_comments set helpful_count = helpful_count + 1 where comment_id = new.comment_id;
    return new;
  end if;
  update public.event_comments set helpful_count = greatest(helpful_count - 1, 0) where comment_id = old.comment_id;
  return old;
end
$$;
drop trigger if exists comment_reactions_count on public.comment_reactions;
create trigger comment_reactions_count after insert or delete on public.comment_reactions
  for each row execute function public.comment_reactions_count();

create table if not exists public.comment_flags (
  comment_id uuid not null references public.event_comments (comment_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or reason in ('spam', 'abuse', 'false', 'private', 'other')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.comment_flags enable row level security;
drop policy if exists comment_flags_insert_own on public.comment_flags;
create policy comment_flags_insert_own on public.comment_flags
  for insert to authenticated with check (user_id = auth.uid());

-- Three flags send a visible comment back to review.
create or replace function public.comment_flags_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_comments
  set flag_count = flag_count + 1,
      status = case when status = 'visible' and flag_count + 1 >= 3 then 'pending' else status end
  where comment_id = new.comment_id;
  return new;
end
$$;
drop trigger if exists comment_flags_after_insert on public.comment_flags;
create trigger comment_flags_after_insert after insert on public.comment_flags
  for each row execute function public.comment_flags_after_insert();

-- 4. Author delete, moderator decisions ---------------------------------------
create or replace function public.delete_my_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_comments
  set status = 'hidden', hidden_reason = 'deleted_by_author', updated_at = now()
  where comment_id = p_comment_id and user_id = auth.uid();
  if not found then
    raise exception 'delete_my_comment: not your comment' using errcode = '42501';
  end if;
end
$$;

create or replace function public.moderate_comment(p_comment_id uuid, p_action text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator(auth.uid()) then
    raise exception 'moderate_comment: moderators only' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'hide') then
    raise exception 'moderate_comment: action must be approve or hide' using errcode = '22023';
  end if;
  update public.event_comments
  set status = case when p_action = 'approve' then 'visible' else 'hidden' end,
      hidden_reason = case when p_action = 'hide' then coalesce(p_reason, 'moderator') else null end,
      updated_at = now()
  where comment_id = p_comment_id;
end
$$;

-- 5. Felt summary for an event: aggregates only ------------------------------
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
    'comments', (select count(*) from public.event_comments where event_id = p_event_id and status = 'visible')
  )
$$;

-- 6. Account deletion also anonymises comments and drops marks/flags --------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'delete_my_account: no account to delete' using errcode = '42501';
  end if;
  update public.felt_reports set user_id = null where user_id = v_uid;
  update public.felt_comments set user_id = null where user_id = v_uid;
  update public.feedback set user_id = null where user_id = v_uid;
  update public.event_comments set user_id = null where user_id = v_uid;
  delete from public.comment_reactions where user_id = v_uid;
  delete from public.comment_flags where user_id = v_uid;
  delete from public.notification_subscriptions where user_id = v_uid;
  delete from public.user_roles where user_id = v_uid;
  delete from public.profile_private where user_id = v_uid;
  delete from public.profiles where user_id = v_uid;
  delete from auth.users where id = v_uid;
end
$$;

revoke all on function public.is_moderator(uuid) from public, anon, authenticated;
revoke all on function public.event_comments_before_insert() from public, anon, authenticated;
revoke all on function public.event_comments_after_insert() from public, anon, authenticated;
revoke all on function public.comment_reactions_count() from public, anon, authenticated;
revoke all on function public.comment_flags_after_insert() from public, anon, authenticated;
revoke all on function public.delete_my_comment(uuid) from public, anon;
revoke all on function public.moderate_comment(uuid, text, text) from public, anon;
revoke all on function public.event_hub_summary(uuid) from public;
grant execute on function public.delete_my_comment(uuid) to authenticated;
grant execute on function public.moderate_comment(uuid, text, text) to authenticated;
grant execute on function public.event_hub_summary(uuid) to anon, authenticated;
grant execute on function public.is_moderator(uuid) to anon, authenticated;
