-- 0042: Tag my building q-v2 — photo slots, captions and a per-home cap.
-- Photos stay in the private `home-photos` bucket (0037). This adds:
--   * home_photos: one row per photo with its suggested slot (front, back,
--     left, right, ground, roof, column, ceiling, cracks, basement, or
--     "more" for extras) and an optional short caption. The app writes the
--     row after the upload and degrades gracefully without it (the slot is
--     also the prefix of the file name; only captions need this table).
--   * a cap of 30 photos per home, enforced on the storage insert policy and
--     on the table.
-- Nothing else in 0037 changes: no new kind values (the five q-v2 home types
-- map to the existing 'house' | 'apartment'), no change to create_home_tag or
-- link_home_complex.

create table if not exists public.home_photos (
  path text primary key,
  tag_id uuid not null references public.home_tags (tag_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  slot text not null check (
    slot in ('front', 'back', 'left', 'right', 'ground', 'roof', 'column', 'ceiling', 'cracks', 'basement', 'more')
  ),
  caption text check (caption is null or char_length(caption) <= 80),
  created_at timestamptz not null default now(),
  check (path like tag_id::text || '/%')
);
create index if not exists home_photos_tag_idx on public.home_photos (tag_id);
alter table public.home_photos enable row level security;

-- Photos already stored for a home (storage objects under <tag_id>/).
create or replace function public.home_photo_count(p_tag uuid)
returns integer
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select count(*)::integer
  from storage.objects o
  where o.bucket_id = 'home-photos'
    and o.name like p_tag::text || '/%'
$$;

revoke all on function public.home_photo_count(uuid) from public, anon;
grant execute on function public.home_photo_count(uuid) to authenticated;

drop policy if exists home_photos_table_read on public.home_photos;
create policy home_photos_table_read on public.home_photos
  for select to authenticated using (public.is_home_member(tag_id));
drop policy if exists home_photos_table_insert on public.home_photos;
create policy home_photos_table_insert on public.home_photos
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_home_member(tag_id)
    and public.home_photo_count(tag_id) <= 30
  );
drop policy if exists home_photos_table_delete on public.home_photos;
create policy home_photos_table_delete on public.home_photos
  for delete to authenticated using (public.is_home_member(tag_id));

-- The storage insert policy of 0037 plus the cap: 30 photos per home.
drop policy if exists home_photos_insert on storage.objects;
create policy home_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'home-photos'
    and public.is_home_member(((storage.foldername(name))[1])::uuid)
    and public.home_photo_count(((storage.foldername(name))[1])::uuid) < 30
  );
