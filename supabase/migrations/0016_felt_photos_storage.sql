-- 0016: felt-photos Storage bucket + policies, and the felt_photos schema
-- bit that was still missing (a uniqueness target for idempotent client
-- upserts). Closes the last felt-reports gap: window 3's photo attachment
-- (D26 item 8's artwork wave built the UI; D15 says photos are moderated
-- like every other user-generated row; D26 photos are part of the report).
-- Additive-only per this repo's migration convention: a new numbered file,
-- never a hand-edit of 0003_felt_reports.sql. Like every migration in this
-- repo so far, this has never been applied against a live database
-- (PROJECT.md "Blocked on Peshawa": no Supabase project yet) — reviewed by
-- inspection only, matching supabase/README.md's own disclaimer.

-- ---------------------------------------------------------------------------
-- 1. The bucket itself
-- ---------------------------------------------------------------------------
-- PRIVATE (public = false): felt photos are moderated (D15) — nothing here
-- is served publicly until a human approves it. This wave does not add a
-- public-read path; a future moderated-public wave will serve approved
-- photos via short-lived signed URLs (createSignedUrl), generated
-- server-side (service_role or an Edge Function), never a public bucket
-- flip or a client-facing SELECT policy on storage.objects.
insert into storage.buckets (id, name, public)
values ('felt-photos', 'felt-photos', false)
on conflict (id) do nothing;

-- `file_size_limit`/`allowed_mime_types` are inspected defensively rather
-- than set inline on the insert above: both columns have existed on
-- `storage.buckets` since Supabase Storage's early-2023 releases and should
-- be present on any current project, but this repo's migrations have never
-- run against a live database (see header) — a DO block that no-ops on an
-- unexpectedly old/different shape is strictly safer than an insert that
-- fails outright on a column that doesn't exist.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    update storage.buckets
      set file_size_limit = 5242880 -- 5 MB; matches the client's own
                                     -- aggressive-compression picker
                                     -- (`app/felt-report/details.tsx`,
                                     -- quality 0.4 JPEG) with headroom.
      where id = 'felt-photos';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
      set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
      where id = 'felt-photos';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. storage.objects RLS — INSERT + UPDATE only, path-prefix-scoped
-- ---------------------------------------------------------------------------
-- Predicate chosen: `(storage.foldername(name))[1] = auth.uid()::text`,
-- i.e. the object path MUST be `<auth.uid()>/<report_id>.jpg` — the same
-- auth.uid()-keyed ownership migration 0015 already established for
-- `felt_reports_select_own`/`felt_report_details_select_own`, extended here
-- to Storage. `device_id` (felt_reports' own anonymous identity column) is
-- deliberately NOT usable as a path prefix for the same reason 0015 rejected
-- it as a select-own predicate: it is client-supplied and unverifiable by
-- RLS, so keying a WRITABLE path off it would let any anon-key request
-- upload into (or overwrite) any other device's photo path just by guessing
-- a device_id string. `auth.uid()` from a real (if anonymous) Supabase Auth
-- session is the only value here Postgres can actually prove belongs to the
-- calling client — hence this wave's anonymous-sign-in wiring
-- (`src/lib/supabase.ts`'s `signInAnonymously()`, now called from
-- `src/features/felt/supabase-transport.ts` before any write) is a real
-- DEPENDENCY of this policy, not incidental to it.
--
-- `to authenticated`, not `to anon`: a client that has called
-- `signInAnonymously()` carries a JWT with role `authenticated` (Supabase
-- Anonymous Auth issues a normal session, just with no email/password and
-- an `is_anonymous: true` claim) — `auth.uid()` is only ever non-null for
-- that role. An `anon`-role request (no session at all) can never satisfy
-- this predicate, matching "uploads require the client to actually be
-- signed in anonymously" from the wave brief.
--
-- Both INSERT and UPDATE are granted (not INSERT alone): the client
-- uploads with `{ upsert: true }` for retry-idempotency (a queued photo
-- upload that partially succeeded — bytes written, response lost — must be
-- safely re-attemptable). Supabase Storage services an upsert-of-an-
-- existing-object as an UPDATE against `storage.objects`, so without an
-- UPDATE policy here a retry onto the SAME path would be rejected by RLS
-- even though the client legitimately owns that path.
--
-- No SELECT policy (client-facing download/list) and no DELETE policy this
-- wave, matching the brief: photos are reviewed by the owner via the
-- Supabase dashboard/service_role (which bypasses RLS, per this repo's own
-- "service_role bypass is implicit, not policy-based" convention,
-- supabase/README.md), not read back by the client yet.
create policy felt_photos_storage_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'felt-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy felt_photos_storage_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'felt-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'felt-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 3. felt_photos: the one additive bit 0003 was missing
-- ---------------------------------------------------------------------------
-- 0003_felt_reports.sql already has everything else this wave needs
-- (`storage_path text not null`, `moderation_status ... default 'pending'`,
-- the `felt_photos_insert`/`felt_photos_select_approved` policies) — no
-- duplication here. The one gap: no uniqueness target for a client-side
-- UPSERT. The app's photo model is one photo per report (`Tier2Report.
-- photoUri: string | null`, `app/felt-report/details.tsx`'s single picker
-- slot) — a plain UNIQUE on `report_id` both matches that model AND is what
-- `supabase-transport.ts`'s `uploadFeltPhoto` upserts against
-- (`onConflict: 'report_id'`) so a retried photo-queue drain re-attempt
-- never creates a second row for the same report, and — because the
-- upsert payload never includes `moderation_status` — never resets an
-- already-moderated row back to 'pending' on retry either (only a true
-- first-time INSERT gets the column default).
alter table public.felt_photos
  add constraint felt_photos_report_id_uq unique (report_id);

comment on constraint felt_photos_report_id_uq on public.felt_photos is
  'One photo per felt report (the client model, see this migration''s own comment) — also the client-side upsert target for idempotent retry.';
