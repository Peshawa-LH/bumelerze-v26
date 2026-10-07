-- 0046: granting and revoking rank badges by @username (owner notes N3, N5).
--
-- Only holders of `badges.grant` (the official account today) may call these.
-- The official rank itself is NOT grantable here: it stays a database-only
-- operation, so admin power cannot spread by accident. Every grant and revoke
-- is written to moderation_log, and user_roles records granted_by/granted_at.
-- Needs 0043 (has_permission, moderation_log, user_roles columns) and 0045
-- (usernames).

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
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_grant_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
    raise exception 'admin_grant_role: this rank cannot be granted here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_grant_role: user not found' using errcode = 'P0002';
  end if;
  insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note)
  values (
    v_target,
    p_role,
    case when p_role = 'partner' then nullif(left(btrim(coalesce(p_org_name, '')), 80), '') else null end,
    v_uid,
    now(),
    nullif(left(btrim(coalesce(p_note, '')), 200), '')
  )
  on conflict (user_id, role) do update
    set org_name = excluded.org_name,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        note = excluded.note;
  insert into public.moderation_log (actor_id, action, target_user_id, reason)
  values (v_uid, 'role_grant', v_target, p_role);
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
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_revoke_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
    raise exception 'admin_revoke_role: this rank cannot be revoked here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_revoke_role: user not found' using errcode = 'P0002';
  end if;
  delete from public.user_roles where user_id = v_target and role = p_role;
  if not found then
    raise exception 'admin_revoke_role: rank not held' using errcode = 'P0002';
  end if;
  insert into public.moderation_log (actor_id, action, target_user_id, reason)
  values (v_uid, 'role_revoke', v_target, p_role);
end
$$;

-- Who holds which rank, with the granter and the note (not public elsewhere).
create or replace function public.admin_role_holders()
returns table (
  holder_id uuid,
  username text,
  display_name text,
  role text,
  org_name text,
  granted_at timestamptz,
  granted_by_name text,
  note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'badges.grant') then
    raise exception 'admin_role_holders: not allowed' using errcode = '42501';
  end if;
  return query
    select r.user_id, p.username, p.display_name, r.role, r.org_name, r.granted_at,
           g.display_name, r.note
      from public.user_roles r
      left join public.profiles p on p.user_id = r.user_id
      left join public.profiles g on g.user_id = r.granted_by
     order by r.granted_at desc
     limit 500;
end
$$;

revoke all on function public.admin_grant_role(text, text, text, text) from public, anon;
revoke all on function public.admin_revoke_role(text, text) from public, anon;
revoke all on function public.admin_role_holders() from public, anon;
grant execute on function public.admin_grant_role(text, text, text, text) to authenticated;
grant execute on function public.admin_revoke_role(text, text) to authenticated;
grant execute on function public.admin_role_holders() to authenticated;
