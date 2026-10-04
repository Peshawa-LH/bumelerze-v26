-- 0037: Tag my building (phase C) — home tags, family membership, surveys,
-- automatic assessments, private photos.
-- Spec: tag-my-building-phaseC-spec-2026-10-04.md in the project brain.
-- A home tag is one family's home (house or apartment). Its exact location,
-- answers, photos and assessment are visible only to its approved members;
-- Bumelerze uses them de-identified for research (consent, D68).

create table if not exists public.building_complexes (
  complex_id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lon double precision not null,
  created_at timestamptz not null default now()
);
alter table public.building_complexes enable row level security;
-- no client access: grouping is a server concern.

create table if not exists public.home_tags (
  tag_id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^BMH-[0-9A-HJKMNP-TV-Z]{6}$'),
  owner_user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('house', 'apartment')),
  label text check (label is null or char_length(label) <= 60),
  unit_label text check (unit_label is null or char_length(unit_label) <= 40),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  geohash_p7 text generated always as (public.geohash_encode(lat, lon, 7)) stored,
  complex_id uuid references public.building_complexes (complex_id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists home_tags_geohash_idx on public.home_tags (left(geohash_p7, 6));
alter table public.home_tags enable row level security;

create table if not exists public.home_tag_secrets (
  tag_id uuid primary key references public.home_tags (tag_id) on delete cascade,
  join_key text not null,
  rotated_at timestamptz not null default now()
);
alter table public.home_tag_secrets enable row level security;

create table if not exists public.home_members (
  tag_id uuid not null references public.home_tags (tag_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (tag_id, user_id)
);
alter table public.home_members enable row level security;

create table if not exists public.home_join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists home_join_attempts_idx on public.home_join_attempts (user_id, attempted_at);
alter table public.home_join_attempts enable row level security;

create table if not exists public.home_surveys (
  survey_id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.home_tags (tag_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  version text not null check (char_length(version) <= 40),
  answers jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.home_surveys enable row level security;

create table if not exists public.home_assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.home_tags (tag_id) on delete cascade,
  survey_id uuid references public.home_surveys (survey_id) on delete set null,
  method text not null check (char_length(method) <= 40),
  ims_type_probs jsonb not null,
  vc_probs jsonb not null,
  vc_most_likely text not null check (vc_most_likely in ('A', 'B', 'C', 'D', 'E', 'F')),
  vc_range text check (vc_range is null or char_length(vc_range) <= 10),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  hazard jsonb,
  review_status text not null default 'automatic' check (review_status in ('automatic', 'engineer_reviewed')),
  created_at timestamptz not null default now()
);
alter table public.home_assessments enable row level security;

-- Membership test used by every policy below.
create or replace function public.is_home_member(p_tag uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.home_members m
    where m.tag_id = p_tag and m.user_id = auth.uid() and m.status = 'approved'
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
    select 1 from public.home_members m
    where m.tag_id = p_tag and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'approved'
  )
$$;

drop policy if exists home_tags_read on public.home_tags;
create policy home_tags_read on public.home_tags
  for select to authenticated using (public.is_home_member(tag_id));
drop policy if exists home_tags_update on public.home_tags;
create policy home_tags_update on public.home_tags
  for update to authenticated using (public.is_home_owner(tag_id)) with check (public.is_home_owner(tag_id));

drop policy if exists home_tag_secrets_read on public.home_tag_secrets;
create policy home_tag_secrets_read on public.home_tag_secrets
  for select to authenticated using (public.is_home_owner(tag_id));

drop policy if exists home_members_read on public.home_members;
create policy home_members_read on public.home_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_home_member(tag_id));

drop policy if exists home_surveys_read on public.home_surveys;
create policy home_surveys_read on public.home_surveys
  for select to authenticated using (public.is_home_member(tag_id));
drop policy if exists home_surveys_insert on public.home_surveys;
create policy home_surveys_insert on public.home_surveys
  for insert to authenticated with check (user_id = auth.uid() and public.is_home_member(tag_id));

drop policy if exists home_assessments_read on public.home_assessments;
create policy home_assessments_read on public.home_assessments
  for select to authenticated using (public.is_home_member(tag_id));
drop policy if exists home_assessments_insert on public.home_assessments;
create policy home_assessments_insert on public.home_assessments
  for insert to authenticated
  with check (public.is_home_member(tag_id) and review_status = 'automatic');

-- Codes and keys: Crockford base32 without I, L, O, U.
create or replace function public.random_crockford(p_len integer)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_out text := '';
  b bytea := gen_random_bytes(p_len);
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return v_out;
end
$$;

-- Apartment tags close together form one building complex.
create or replace function public.link_home_complex(p_tag uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t record;
  v_complex uuid;
begin
  select * into t from public.home_tags where tag_id = p_tag;
  if t.kind <> 'apartment' then return null; end if;
  select h.complex_id into v_complex
  from public.home_tags h
  where h.kind = 'apartment' and h.tag_id <> p_tag and h.status = 'active'
    and h.complex_id is not null
    and left(h.geohash_p7, 6) = left(t.geohash_p7, 6)
    and ST_DWithin(
          geography(ST_SetSRID(ST_MakePoint(h.lon, h.lat), 4326)),
          geography(ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)),
          30
        )
  limit 1;
  if v_complex is null then
    insert into public.building_complexes (lat, lon) values (t.lat, t.lon) returning complex_id into v_complex;
  end if;
  update public.home_tags set complex_id = v_complex where tag_id = p_tag;
  return v_complex;
end
$$;

create or replace function public.create_home_tag(
  p_kind text,
  p_lat double precision,
  p_lon double precision,
  p_label text default null,
  p_unit_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_key text;
  v_tag uuid;
  v_count integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'create_home_tag: create an account first' using errcode = '42501';
  end if;
  select count(*) into v_count from public.home_tags where owner_user_id = v_uid and status = 'active';
  if v_count >= 5 then
    raise exception 'create_home_tag: limit of 5 homes per account' using errcode = '54000';
  end if;
  loop
    v_code := 'BMH-' || public.random_crockford(6);
    exit when not exists (select 1 from public.home_tags where code = v_code);
  end loop;
  v_key := public.random_crockford(8);
  insert into public.home_tags (code, owner_user_id, kind, label, unit_label, lat, lon)
  values (v_code, v_uid, p_kind, nullif(btrim(p_label), ''), nullif(btrim(p_unit_label), ''), p_lat, p_lon)
  returning tag_id into v_tag;
  insert into public.home_tag_secrets (tag_id, join_key) values (v_tag, v_key);
  insert into public.home_members (tag_id, user_id, role, status, decided_at)
  values (v_tag, v_uid, 'owner', 'approved', now());
  perform public.link_home_complex(v_tag);
  return jsonb_build_object('tag_id', v_tag, 'code', v_code, 'join_key', v_key);
end
$$;

create or replace function public.request_join_home(p_code text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tag uuid;
  v_recent integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'request_join_home: create an account first' using errcode = '42501';
  end if;
  select count(*) into v_recent from public.home_join_attempts
  where user_id = v_uid and attempted_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'request_join_home: too many attempts, try again later' using errcode = '54000';
  end if;
  insert into public.home_join_attempts (user_id) values (v_uid);
  select t.tag_id into v_tag
  from public.home_tags t join public.home_tag_secrets s using (tag_id)
  where t.code = upper(btrim(p_code)) and s.join_key = upper(btrim(p_key)) and t.status = 'active';
  if v_tag is null then
    raise exception 'request_join_home: code or key is wrong' using errcode = '22023';
  end if;
  insert into public.home_members (tag_id, user_id, role, status)
  values (v_tag, v_uid, 'member', 'pending')
  on conflict (tag_id, user_id) do nothing;
  return jsonb_build_object('tag_id', v_tag, 'status',
    (select status from public.home_members where tag_id = v_tag and user_id = v_uid));
end
$$;

create or replace function public.decide_join_request(p_tag uuid, p_user uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_home_owner(p_tag) then
    raise exception 'decide_join_request: owners only' using errcode = '42501';
  end if;
  if p_approve then
    update public.home_members set status = 'approved', decided_at = now()
    where tag_id = p_tag and user_id = p_user and status = 'pending';
  else
    delete from public.home_members where tag_id = p_tag and user_id = p_user and status = 'pending';
  end if;
end
$$;

create or replace function public.leave_home(p_tag uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_home_owner(p_tag) then
    -- the owner archives the home instead of leaving it ownerless
    update public.home_tags set status = 'archived', updated_at = now() where tag_id = p_tag;
  end if;
  delete from public.home_members where tag_id = p_tag and user_id = auth.uid();
end
$$;

create or replace function public.rotate_join_key(p_tag uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := public.random_crockford(8);
begin
  if not public.is_home_owner(p_tag) then
    raise exception 'rotate_join_key: owners only' using errcode = '42501';
  end if;
  update public.home_tag_secrets set join_key = v_key, rotated_at = now() where tag_id = p_tag;
  return v_key;
end
$$;

-- Private photos: approved members of the tag only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('home-photos', 'home-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists home_photos_read on storage.objects;
create policy home_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'home-photos' and public.is_home_member(((storage.foldername(name))[1])::uuid));
drop policy if exists home_photos_insert on storage.objects;
create policy home_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'home-photos' and public.is_home_member(((storage.foldername(name))[1])::uuid));
drop policy if exists home_photos_delete on storage.objects;
create policy home_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'home-photos' and public.is_home_member(((storage.foldername(name))[1])::uuid));

revoke all on function public.random_crockford(integer) from public, anon, authenticated;
revoke all on function public.link_home_complex(uuid) from public, anon, authenticated;
revoke all on function public.create_home_tag(text, double precision, double precision, text, text) from public, anon;
revoke all on function public.request_join_home(text, text) from public, anon;
revoke all on function public.decide_join_request(uuid, uuid, boolean) from public, anon;
revoke all on function public.leave_home(uuid) from public, anon;
revoke all on function public.rotate_join_key(uuid) from public, anon;
revoke all on function public.is_home_member(uuid) from public;
revoke all on function public.is_home_owner(uuid) from public;
grant execute on function public.create_home_tag(text, double precision, double precision, text, text) to authenticated;
grant execute on function public.request_join_home(text, text) to authenticated;
grant execute on function public.decide_join_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.leave_home(uuid) to authenticated;
grant execute on function public.rotate_join_key(uuid) to authenticated;
grant execute on function public.is_home_member(uuid) to authenticated;
grant execute on function public.is_home_owner(uuid) to authenticated;
