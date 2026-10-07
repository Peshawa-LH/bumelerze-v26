-- 0043: ranks with permissions (owner notes N3 and N5, 2026-10-07).
--
-- Role badges are ranks. What a rank may DO lives in one table
-- (`role_permissions`) read through one function (`has_permission`), instead
-- of role names scattered through SQL. Milestone badges are achievements and
-- carry no powers (they are computed in the app, not stored here).
--
-- This file:
--   1. a tiny "is this a real account" helper (not an anonymous-auth session)
--   2. user_roles: three new credential ranks, who granted a rank, a note
--      (the note and the granter are NOT publicly readable)
--   3. role_permissions + has_permission() + my_permissions()
--   4. is_moderator() and moderate_comment() now go through has_permission()
--      (same behaviour: official and moderator may approve or hide)
--   5. moderation_log: who did what to whom, when and why
--
-- Idempotent: safe to run twice. Apply 0043..0048 in order.

-- 1. Real account? -------------------------------------------------------------
-- Comments, helpful marks, homes and (from 0047) follows all need a signed-in
-- account, not an anonymous install. Same test everywhere:
-- is_anonymous missing counts as anonymous.
create or replace function public.is_real_account()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
$$;

-- 2. user_roles: more ranks, who granted them ----------------------------------
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in (
    'official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'
  ));

alter table public.user_roles
  add column if not exists granted_by uuid references auth.users (id) on delete set null;
alter table public.user_roles
  add column if not exists note text check (note is null or char_length(note) <= 200);

-- The role mark is public (the app shows it next to names), but WHO granted it
-- and the private note are not. Column-level read grants keep those two out of
-- every client query; admins read them through admin_role_holders() (0046).
revoke select on public.user_roles from anon, authenticated;
grant select (user_id, role, org_name, granted_at) on public.user_roles to anon, authenticated;

-- 3. What each rank may do ---------------------------------------------------------
create table if not exists public.role_permissions (
  role text not null check (role in (
    'official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'
  )),
  permission text not null check (permission ~ '^[a-z]+\.[a-z_]+$'),
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;
drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions
  for select to authenticated using (true);
-- no client writes: the matrix changes by migration only.

-- official = admin. Credential ranks (seismologist, professor, researcher,
-- engineer, partner) are marks with no powers for now.
insert into public.role_permissions (role, permission) values
  ('official', 'comments.moderate'),
  ('official', 'comments.delete'),
  ('official', 'badges.grant'),
  ('official', 'hubs.feature'),
  ('moderator', 'comments.moderate')
on conflict do nothing;

create or replace function public.has_permission(p_user uuid, p_permission text)
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
          and rp.permission = p_permission
     )
$$;

-- The signed-in viewer's own permissions, one call, so the app can show or
-- hide tools. Empty for everyone without a rank.
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), '{}'::text[])
    from public.user_roles r
    join public.role_permissions rp on rp.role = r.role
   where r.user_id = auth.uid()
$$;

-- 4. Existing moderation goes through has_permission ------------------------------
create or replace function public.is_moderator(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission(p_user, 'comments.moderate')
$$;

-- 5. Moderation log ---------------------------------------------------------------
create table if not exists public.moderation_log (
  log_id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in (
    'comment_approve', 'comment_hide', 'comment_remove',
    'role_grant', 'role_revoke', 'profile_reports_resolve'
  )),
  comment_id uuid references public.event_comments (comment_id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists moderation_log_created_idx on public.moderation_log (created_at desc);
alter table public.moderation_log enable row level security;
drop policy if exists moderation_log_read on public.moderation_log;
create policy moderation_log_read on public.moderation_log
  for select to authenticated
  using (public.has_permission(auth.uid(), 'comments.moderate'));
-- no client writes: rows are written by the security definer functions below.

create or replace function public.moderate_comment(p_comment_id uuid, p_action text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'moderate_comment: moderators only' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'hide') then
    raise exception 'moderate_comment: action must be approve or hide' using errcode = '22023';
  end if;
  -- a removed comment (0044) stays removed
  update public.event_comments
  set status = case when p_action = 'approve' then 'visible' else 'hidden' end,
      hidden_reason = case when p_action = 'hide' then coalesce(p_reason, 'moderator') else null end,
      updated_at = now()
  where comment_id = p_comment_id
    and status <> 'removed'
  returning user_id into v_author;
  if found then
    insert into public.moderation_log (actor_id, action, comment_id, target_user_id, reason)
    values (auth.uid(), 'comment_' || p_action, p_comment_id, v_author, left(p_reason, 200));
  end if;
end
$$;

-- Grants ---------------------------------------------------------------------------
revoke all on function public.is_real_account() from public;
revoke all on function public.has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.is_moderator(uuid) from public, anon, authenticated;
revoke all on function public.moderate_comment(uuid, text, text) from public, anon;
grant execute on function public.is_real_account() to anon, authenticated;
grant execute on function public.has_permission(uuid, text) to anon, authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.is_moderator(uuid) to anon, authenticated;
grant execute on function public.moderate_comment(uuid, text, text) to authenticated;
