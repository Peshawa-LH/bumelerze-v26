-- 0045: @usernames, private accounts, "hide my badges" (owner note N4 and the
-- owner's answers of 2026-10-07).
--
-- A username is optional until the person picks one in the profile editor
-- (existing profiles keep working without one; they just have no public page).
-- Stored lowercase only, so uniqueness is case-insensitive by construction
-- (and also enforced on lower(username)).
--
-- Public: username, is_private (profiles are readable by everyone, as before).
-- Owner-only: hide_badges (on profile_private).

-- 1. Columns ------------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists is_private boolean not null default false;
alter table public.profile_private add column if not exists hide_badges boolean not null default false;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_.]{3,24}$');

-- (NULLs never collide in a unique index, so a partial index is not needed and
-- the plain expression index also serves lookups by lower(username).)
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- 2. Names nobody may take ---------------------------------------------------------
create table if not exists public.reserved_usernames (
  name text primary key check (name = lower(name))
);
alter table public.reserved_usernames enable row level security;
-- no policies: never read or written by a client; the guard below reads it.

insert into public.reserved_usernames (name) values
  ('admin'), ('administrator'), ('root'), ('system'), ('superuser'),
  ('support'), ('help'), ('helpdesk'), ('staff'), ('team'), ('security'),
  ('official'), ('moderator'), ('mod'), ('mods'), ('bumelerze'), ('bumelerzeapp'),
  ('contact'), ('info'), ('hello'), ('dev'), ('press'), ('privacy'), ('legal'),
  ('news'), ('alert'), ('alerts'), ('earthquake'), ('quake'), ('seismology'),
  ('usgs'), ('emsc'), ('geofon'), ('null'), ('undefined'), ('anonymous'),
  ('guest'), ('me'), ('you'), ('everyone'), ('all'), ('api'), ('www'), ('app'),
  ('settings'), ('account'), ('profile'), ('feedback'), ('hub'), ('u')
on conflict do nothing;

-- 3. Guard: normalise, reserved names, no impersonation ---------------------------
-- Reserved names, and names that CONTAIN "bumelerze", belong to the official
-- account only.
create or replace function public.profiles_username_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.username is null then
    return new;
  end if;
  new.username := lower(btrim(new.username));
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;
  if (
       exists (select 1 from public.reserved_usernames r where r.name = new.username)
       or position('bumelerze' in new.username) > 0
     )
     and not exists (
       select 1 from public.user_roles ur
        where ur.user_id = new.user_id and ur.role = 'official'
     ) then
    raise exception 'profiles: username_reserved' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists profiles_username_guard on public.profiles;
create trigger profiles_username_guard
  before insert or update of username on public.profiles
  for each row execute function public.profiles_username_guard();

-- 4. Is this name free for me? ---------------------------------------------------
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with n as (select lower(btrim(coalesce(p_username, ''))) as name)
  select n.name ~ '^[a-z0-9_.]{3,24}$'
     and (
       not (
         exists (select 1 from public.reserved_usernames r where r.name = n.name)
         or position('bumelerze' in n.name) > 0
       )
       or exists (
         select 1 from public.user_roles ur
          where ur.user_id = auth.uid() and ur.role = 'official'
       )
     )
     and not exists (
       select 1 from public.profiles p
        where lower(p.username) = n.name
          and p.user_id is distinct from auth.uid()
     )
    from n
$$;

revoke all on function public.profiles_username_guard() from public, anon, authenticated;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;
