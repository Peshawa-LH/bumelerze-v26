-- 0076: admin powers need two-step sign-in (security checklist A1.1, audit
-- finding DB-02).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Why. One password opened every admin power: resetting any member's
-- password, reading e-mail addresses, giving badges (the Government official
-- rank included, also to oneself). The app now offers two-step sign-in
-- (Supabase TOTP, app 26.4.5). A session that has passed the second step
-- carries the claim aal = aal2 in its token; a password-only session carries
-- aal1. From now on a rank's powers work only in an aal2 session. Members
-- without a rank notice nothing.
--
-- How.
-- 1. has_permission(user, permission), the check every admin function,
--    policy and trigger goes through: when the user asked about is the
--    caller (user = auth.uid()), the session must be aal2. Asking about
--    somebody else (the checks that protect a target, such as "this account
--    is staff") and calls without a session (pg_cron, the service role, the
--    SQL editor: auth.uid() is null) answer exactly as before.
-- 2. holds_admin_permission(user), the "is staff" test, gets the same rule:
--    its only caller-side use, admin_tool_counts(), then refuses an aal1
--    session; its target-side uses (restrict, reset profile, person flags)
--    are unchanged.
-- 3. my_permissions(), which the app reads to show admin tools, returns
--    nothing in an aal1 session. my_has_permission() already asks
--    has_permission() for the caller and is not changed.
-- 4. New my_admin_needs_two_step(): true when the caller holds a rank that
--    carries any permission and the session is not aal2, else false (also
--    for guests and without a session). The app shows "Two-step sign-in
--    needed" instead of hiding the admin tools.
-- 5. admin_grant_role and admin_revoke_role refuse the caller's own account
--    (42501); otherwise unchanged from 0066.
-- 6. admin_reset_password refuses every account that holds a rank or a
--    private rank (42501), the caller's own included; such accounts recover
--    their password by e-mail. This includes the old rule (no reset of an
--    account that may reset passwords). Otherwise unchanged from 0052.
-- 7. A last block checks the result and fails the whole paste if a part is
--    missing.
--
-- What changes for a rank holder in an aal1 session: no admin or official
-- tools (my_permissions() is empty, every admin function answers 42501);
-- their comments and posts go through the word filter and surge holds like
-- everyone's (staff skip them only in aal2); they see only visible comments;
-- Alerts settings in testers mode stay closed unless the account is on the
-- testers list (alert pushes themselves are sent by pg_cron, unchanged).
--
-- Rank reads left alone on purpose. They show a badge or the caller's own
-- data: audit_actor_rank, follow_list, my_follow_requests,
-- post_comments_page, public_profile, export_my_data_base,
-- delete_my_account, official_account_id. They sit behind has_permission()
-- for the caller and only read the target's ranks: admin_alerts_overview,
-- admin_feedback_get, admin_feedback_grant_badge (grants through
-- admin_grant_role), admin_people_search, admin_person, admin_person_flags,
-- admin_role_holders, admin_undo_action (restores only badges without
-- powers beyond what a badges.grant holder has). They protect a target:
-- comment_flags_after_insert (a ranked author's comment is not hidden by
-- flags). The reserved-name exception for the official rank
-- (profiles_integrity_guard, profiles_username_guard, username_available)
-- is about the account's own name, which an aal1 session may edit anyway.
-- ops_notify_admins and alert_user_eligible run under pg_cron, without a
-- session. All policies already go through my_has_permission().
--
-- Needs 0060, 0066 and 0052 as applied live. Idempotent: create or replace
-- only, grants restated.

-- 1. The permission check -------------------------------------------------------------------------
create or replace function public.has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and (
       auth.uid() is null
       or p_user <> auth.uid()
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     )
     and (
       exists (
         select 1
           from public.user_roles r
           join public.role_permissions rp on rp.role = r.role
          where r.user_id = p_user
            and rp.permission = p_permission
       )
       or exists (
         select 1
           from public.private_ranks k
           join public.role_permissions rp on rp.role = k.role
          where k.user_id = p_user
            and rp.permission = p_permission
       )
     )
$$;

-- 2. The staff test (0066 definition plus the same rule) -------------------------------------------
create or replace function public.holds_admin_permission(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and (
       auth.uid() is null
       or p_user <> auth.uid()
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     )
     and (
       exists (
         select 1
           from public.user_roles r
           join public.role_permissions rp on rp.role = r.role
          where r.user_id = p_user
            and rp.permission not like 'authority.%'
       )
       or exists (
         select 1
           from public.private_ranks k
           join public.role_permissions rp on rp.role = k.role
          where k.user_id = p_user
            and rp.permission not like 'authority.%'
       )
     )
$$;

-- 3. What the app may show (0060 definition, empty below aal2) -------------------------------------
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct x.permission order by x.permission), '{}'::text[])
    from (
      select rp.permission
        from public.user_roles r
        join public.role_permissions rp on rp.role = r.role
       where r.user_id = auth.uid()
      union
      select rp.permission
        from public.private_ranks k
        join public.role_permissions rp on rp.role = k.role
       where k.user_id = auth.uid()
    ) x
   where coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- 4. "Two-step sign-in needed" -------------------------------------------------------------------
create or replace function public.my_admin_needs_two_step()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     and (
       exists (
         select 1
           from public.user_roles r
           join public.role_permissions rp on rp.role = r.role
          where r.user_id = auth.uid()
       )
       or exists (
         select 1
           from public.private_ranks k
           join public.role_permissions rp on rp.role = k.role
          where k.user_id = auth.uid()
       )
     )
$$;

-- 5. Badges: never to or from oneself (0066 definitions plus that check) -----------------------------
create or replace function public.admin_grant_role(
  p_username text,
  p_role text,
  p_org_name text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_org text;
  v_note text;
  v_previous jsonb;
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_grant_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner', 'authority') then
    raise exception 'admin_grant_role: this rank cannot be granted here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_grant_role: user not found' using errcode = 'P0002';
  end if;
  if v_target = v_uid then
    raise exception 'admin_grant_role: not allowed for your own account' using errcode = '42501';
  end if;
  v_org := case when p_role = 'partner' then nullif(left(btrim(coalesce(p_org_name, '')), 80), '') else null end;
  v_note := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  select jsonb_build_object(
           'org_name', r.org_name, 'note', r.note,
           'granted_by', r.granted_by, 'granted_at', r.granted_at)
    into v_previous
    from public.user_roles r
   where r.user_id = v_target and r.role = p_role;
  insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note)
  values (v_target, p_role, v_org, v_uid, now(), v_note)
  on conflict (user_id, role) do update
    set org_name = excluded.org_name,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        note = excluded.note;
  perform public.write_audit(
    v_uid, 'role_grant', 'rank', v_target::text,
    v_target, null, null, p_role, null,
    jsonb_build_object('role', p_role, 'org_name', v_org, 'note', v_note, 'previous', v_previous)
  );
end
$$;

create or replace function public.admin_revoke_role(p_username text, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_snapshot jsonb;
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_revoke_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner', 'authority') then
    raise exception 'admin_revoke_role: this rank cannot be revoked here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_revoke_role: user not found' using errcode = 'P0002';
  end if;
  if v_target = v_uid then
    raise exception 'admin_revoke_role: not allowed for your own account' using errcode = '42501';
  end if;
  delete from public.user_roles r
   where r.user_id = v_target and r.role = p_role
  returning jsonb_build_object(
              'role', r.role, 'org_name', r.org_name, 'note', r.note,
              'granted_by', r.granted_by, 'granted_at', r.granted_at)
       into v_snapshot;
  if not found then
    raise exception 'admin_revoke_role: rank not held' using errcode = 'P0002';
  end if;
  perform public.write_audit(
    v_uid, 'role_revoke', 'rank', v_target::text,
    v_target, null, null, p_role, null, v_snapshot
  );
end
$$;

-- 6. Password reset: never for an account that holds a rank (0052 definition) -----------------------
create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_anonymous boolean;
begin
  if not public.has_permission(v_uid, 'accounts.reset_password') then
    raise exception 'admin_reset_password: not allowed' using errcode = '42501';
  end if;
  if p_new_password is null
     or char_length(p_new_password) < 8
     or char_length(p_new_password) > 72 then
    raise exception 'admin_reset_password: password must be 8 to 72 characters' using errcode = '22023';
  end if;

  select coalesce(u.is_anonymous, false)
    into v_anonymous
    from auth.users u
   where u.id = p_user_id;
  if not found then
    raise exception 'admin_reset_password: user not found' using errcode = 'P0002';
  end if;
  if v_anonymous then
    raise exception 'admin_reset_password: anonymous users have no password' using errcode = '22023';
  end if;

  -- No account that holds a rank (a badge, the Government official rank, an
  -- admin rank or a private rank) can be taken over this way, the caller's
  -- own included.
  if exists (select 1 from public.user_roles r where r.user_id = p_user_id)
     or exists (select 1 from public.private_ranks k where k.user_id = p_user_id) then
    raise exception 'admin_reset_password: not allowed for this account' using errcode = '42501';
  end if;

  -- GoTrue stores bcrypt hashes (cost 10) and verifies any valid bcrypt hash.
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;

  -- A reset means the old password is no longer trusted: end every session.
  delete from auth.sessions where user_id = p_user_id;

  perform public.write_audit(
    v_uid, 'password_reset', 'account', p_user_id::text,
    p_user_id, null, null, null, null, null
  );
end
$$;

-- Grants (as 0052, 0060 and 0066 left them; has_permission keeps its own) ---------------------
revoke all on function public.holds_admin_permission(uuid) from public, anon, authenticated;
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.my_admin_needs_two_step() from public, anon;
revoke all on function public.admin_grant_role(text, text, text, text) from public, anon;
revoke all on function public.admin_revoke_role(text, text) from public, anon;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.my_admin_needs_two_step() to authenticated;
grant execute on function public.admin_grant_role(text, text, text, text) to authenticated;
grant execute on function public.admin_revoke_role(text, text) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;

-- 7. Check ---------------------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}'::text[];
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'my_admin_needs_two_step'
       and p.pronargs = 0
       and p.prorettype = 'boolean'::regtype
       and p.prosecdef
       and p.provolatile = 's'
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    v_missing := v_missing || 'my_admin_needs_two_step()'::text;
  elsif has_function_privilege('anon', 'public.my_admin_needs_two_step()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_admin_needs_two_step()', 'execute') then
    v_missing := v_missing || 'my_admin_needs_two_step() grants'::text;
  end if;
  if has_function_privilege('anon', 'public.my_permissions()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_permissions()', 'execute') then
    v_missing := v_missing || 'my_permissions() grants'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'has_permission'
       and p.prosrc like '%p_user <> auth.uid()%' and p.prosrc like '%''aal2''%'
  ) then
    v_missing := v_missing || 'has_permission() aal2 rule'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'holds_admin_permission'
       and p.prosrc like '%p_user <> auth.uid()%' and p.prosrc like '%''aal2''%'
  ) then
    v_missing := v_missing || 'holds_admin_permission() aal2 rule'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_permissions' and p.prosrc like '%''aal2''%'
  ) then
    v_missing := v_missing || 'my_permissions() aal2 rule'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_has_permission'
       and p.prosrc like '%public.has_permission(auth.uid(), p_permission)%'
  ) then
    v_missing := v_missing || 'my_has_permission() through has_permission()'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_grant_role' and p.prosrc like '%v_target = v_uid%'
  ) then
    v_missing := v_missing || 'admin_grant_role() self check'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_revoke_role' and p.prosrc like '%v_target = v_uid%'
  ) then
    v_missing := v_missing || 'admin_revoke_role() self check'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_reset_password'
       and p.prosrc like '%from public.private_ranks k where k.user_id = p_user_id%'
  ) then
    v_missing := v_missing || 'admin_reset_password() rank check'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0076: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
