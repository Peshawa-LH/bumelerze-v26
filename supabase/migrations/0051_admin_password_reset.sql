-- 0051: admin password reset (owner decision 2026-10-08).
--
-- Accounts now sign in with email + password, and no emails are sent yet
-- (Supabase Auth "Confirm email" is off). Until a real mail sender exists,
-- "I forgot my password" is handled by hand: the person writes through
-- Feedback, an admin resets the password in the app (Admin > Reset a
-- password) and passes a temporary one on, which the person changes in
-- My account > Password.
--
--   1. permission accounts.reset_password for the official rank
--   2. moderation_log learns the action 'password_reset'
--   3. admin_find_accounts(p_query): find an account by @username (prefix) or
--      exact email; returns the id, username, display name and a MASKED email
--   4. admin_reset_password(p_user_id, p_new_password): sets the bcrypt hash
--      in auth.users (the same format GoTrue writes) and signs the person out
--      everywhere; logged in moderation_log (who, whom, when; never the password)
--
-- Needs 0043 (role_permissions, has_permission, moderation_log), 0045
-- (usernames) and 0050 (current moderation_log action list). Idempotent.
-- Apply by hand in the SQL editor, like 0043..0050.

-- 1. Permission --------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('official', 'accounts.reset_password')
on conflict do nothing;

-- 2. Moderation log learns the action --------------------------------------------------
-- Dropped by shape, not by name, so a differently named constraint cannot linger
-- (same approach as 0050). The list is 0050's plus 'password_reset'.
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
    'post_remove', 'post_reports_dismiss',
    'password_reset'
  ));

-- 3. Find an account ---------------------------------------------------------------------
-- Real accounts only (anonymous installs have no email and no password).
-- Username: case-insensitive prefix, at least 3 characters. Email: exact match,
-- case-insensitive. At most 10 rows. The email comes back masked (p***@gmail.com).
create or replace function public.admin_find_accounts(p_query text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  masked_email text
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_q text := lower(ltrim(btrim(coalesce(p_query, '')), '@'));
begin
  if not public.has_permission(auth.uid(), 'accounts.reset_password') then
    raise exception 'admin_find_accounts: not allowed' using errcode = '42501';
  end if;
  if char_length(v_q) < 3 then
    return;
  end if;
  return query
    select u.id,
           p.username,
           p.display_name,
           case
             when u.email is null or position('@' in u.email) = 0 then null
             else left(u.email, 1) || '***@' || split_part(u.email, '@', 2)
           end
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where coalesce(u.is_anonymous, false) = false
       and (
         lower(u.email) = v_q
         or (p.username is not null
             and lower(p.username) like replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       )
     order by (lower(u.email) = v_q) desc, p.username
     limit 10;
end
$$;

-- 4. Reset ----------------------------------------------------------------------------------
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

  -- One admin cannot take over another admin's account this way.
  if p_user_id <> v_uid and public.has_permission(p_user_id, 'accounts.reset_password') then
    raise exception 'admin_reset_password: not allowed for this account' using errcode = '42501';
  end if;

  -- GoTrue stores bcrypt hashes (cost 10) and verifies any valid bcrypt hash.
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;

  -- A reset means the old password is no longer trusted: end every session.
  delete from auth.sessions where user_id = p_user_id;

  insert into public.moderation_log (actor_id, action, target_user_id)
  values (v_uid, 'password_reset', p_user_id);
end
$$;

-- Grants ----------------------------------------------------------------------------------------
revoke all on function public.admin_find_accounts(text) from public, anon;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
grant execute on function public.admin_find_accounts(text) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
