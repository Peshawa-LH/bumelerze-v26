-- 0035: accounts phase 1 — profiles, private profile, avatars, claiming a
-- device's anonymous reports, deleting an account.
-- Spec: accounts-phase1-spec-2026-10-04.md in the project brain (owner:
-- email + Google + Apple sign-in, profession as a private pick list).
--
-- An account is the SAME Supabase user as the install's anonymous identity,
-- upgraded (email / Google / Apple linked), so user_id never changes and
-- past reports stay attached. `auth.jwt() ->> 'is_anonymous'` tells the two
-- tiers apart; only real accounts may create a profile or an avatar.

-- 1. Public profile: only what is shown next to a post ------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- 2. Private profile: profession and consent, owner-only -----------------
create table if not exists public.profile_private (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profession text check (profession in (
    'engineer', 'architect', 'construction', 'teacher', 'health', 'student',
    'public_service', 'business', 'agriculture', 'other'
  )),
  locale text check (locale in ('en', 'ckb', 'kmr', 'ar')),
  terms_version text,
  terms_accepted_at timestamptz,
  research_consent_version text,
  research_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;

drop policy if exists profile_private_select_own on public.profile_private;
create policy profile_private_select_own on public.profile_private
  for select to authenticated using (user_id = auth.uid());

drop policy if exists profile_private_insert_own on public.profile_private;
create policy profile_private_insert_own on public.profile_private
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists profile_private_update_own on public.profile_private;
create policy profile_private_update_own on public.profile_private
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists profile_private_updated_at on public.profile_private;
create trigger profile_private_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();

-- 3. Avatars: public read, owner writes only in their own folder ---------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Moving a device's anonymous reports into the account ---------------
-- Signing into an EXISTING account on a phone that already reported
-- anonymously: the app passes its device id; rows from that device still
-- owned by nobody or by an anonymous user move to the account. Device ids
-- are random client UUIDs kept on the phone, so they cannot be guessed.
create or replace function public.claim_device_reports(p_device_id text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  n integer := 0;
  k integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'claim_device_reports: sign in with an account first' using errcode = '42501';
  end if;
  if p_device_id is null or char_length(p_device_id) < 8 then
    raise exception 'claim_device_reports: invalid device id' using errcode = '22023';
  end if;

  update public.felt_reports fr
  set user_id = v_uid
  where fr.device_id = p_device_id
    and (fr.user_id is null or fr.user_id in (select id from auth.users where is_anonymous));
  get diagnostics k = row_count; n := n + k;

  update public.felt_comments fc
  set user_id = v_uid
  where fc.device_id = p_device_id
    and (fc.user_id is null or fc.user_id in (select id from auth.users where is_anonymous));
  get diagnostics k = row_count; n := n + k;

  update public.feedback f
  set user_id = v_uid
  where f.device_id = p_device_id
    and (f.user_id is null or f.user_id in (select id from auth.users where is_anonymous));
  get diagnostics k = row_count; n := n + k;

  return n;
end
$$;

-- 5. Deleting an account (App Store requirement) --------------------------
-- Profile rows go; the person's reports, comments and feedback stay as
-- anonymous research data (consent text says so); the auth user is
-- removed. The app deletes the avatar file through Storage first.
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
  delete from public.notification_subscriptions where user_id = v_uid;
  delete from public.profile_private where user_id = v_uid;
  delete from public.profiles where user_id = v_uid;
  delete from auth.users where id = v_uid;
end
$$;

revoke all on function public.claim_device_reports(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.claim_device_reports(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
