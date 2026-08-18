-- 0020: in-app feedback — the owner's daily-review + external-tester loop
-- ("In the settings tab we can implement a feedback message where you press
-- feedback then write a message, this message then gets routed somewhere
-- ... I can get the list of feedback then share them with you for fixes").
-- A `feedback` table + a dedicated private Storage bucket for optional
-- screenshots. Additive-only per this repo's migration convention: a new
-- numbered file, never a hand-edit of an earlier one.

-- ---------------------------------------------------------------------------
-- 1. feedback: one row per submission
-- ---------------------------------------------------------------------------
-- `device_id`/`user_id` follow the EXACT convention `felt_reports`
-- (migration 0003) established and `felt_reports_select_own` (migration
-- 0015) already documents at length: `device_id` is a client-generated,
-- unauthenticated per-install id (present for future device-scoped
-- follow-up, but NOT something RLS can verify belongs to the caller); `user_id`
-- is nullable, FK'd to `auth.users`, and is only ever populated from a real
-- `auth.uid()` (Supabase Anonymous Auth) — see `src/features/felt/
-- supabase-transport.ts`'s `ensureAnonymousUserId` for the app-side half of
-- this, mirrored (not shared code, a parallel implementation) by
-- `src/features/feedback/supabase-transport.ts`.
create table public.feedback (
  feedback_id uuid primary key default gen_random_uuid(),

  device_id text not null check (char_length(device_id) between 1 and 128),
  user_id uuid references auth.users (id) on delete set null,

  -- The message itself. 4000 chars is a generous cap for a bug report or a
  -- piece of daily-use feedback (the owner's own stated use case) while
  -- still bounding a single row's size — see the "runaway client" note
  -- below for why no other guard is layered on top of this one.
  message text not null check (char_length(message) between 1 and 4000),

  -- Optional "so a tester can be followed up with" (brief) — free text, not
  -- a validated email/phone column: the owner reads these by hand, a loose
  -- format costs nothing and rejecting a plausible contact string at insert
  -- time is worse than accepting it as-is.
  contact text check (contact is null or char_length(contact) between 1 and 320),

  -- Automatically captured context (never asked of the user) —
  -- `src/features/feedback/context.ts`'s `buildFeedbackContext()`. All four
  -- are nullable: a context-capture failure (e.g. `Constants.expoConfig` is
  -- somehow unavailable) must never block the message itself from being
  -- captured, matching every other "never block the user-facing action on
  -- a secondary concern" pattern in this schema (e.g. `felt_reports.event_id`).
  app_version text,
  locale text,
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  -- Free-text route/screen the feedback was opened from (e.g. "settings") —
  -- deliberately a free string, not an enum: new entry points (this wave
  -- ships exactly one, the Settings row) should never need a migration to
  -- be recorded.
  screen text check (screen is null or char_length(screen) <= 200),

  created_at timestamptz not null default now()
);

comment on table public.feedback is
  'In-app feedback (bug reports / comments / testing notes) — private correspondence, never publicly readable. See this migration''s header for the owner''s own stated use case.';
comment on column public.feedback.device_id is
  'Anonymous per-install device id, same convention/caveats as felt_reports.device_id (migration 0003) — not RLS-provable, presence-checked only.';
comment on column public.feedback.screen is
  'Free-text route the Feedback screen was opened from, e.g. "settings" — client-supplied, best-effort, never blocks the submission if absent.';

-- ---------------------------------------------------------------------------
-- Runaway-client guard — what this migration does and deliberately does NOT do
-- ---------------------------------------------------------------------------
-- supabase/README.md's own "What v0 deliberately defers" section is explicit
-- that real throttling (per-device/per-IP/burst) "belongs in an ingestion
-- Edge Function with its own state, not in table RLS" — this migration keeps
-- that stance rather than bolting a rate-limit trigger onto this table alone.
-- What IS a table-level guard, and mirrors the exact mechanism `felt_reports`
-- already relies on for its own retry safety (migration 0003's `report_id`
-- PK reused client-side, `supabase-transport.ts`'s 23505-is-not-an-error
-- handling): `feedback_id` below is generated CLIENT-SIDE and reused as the
-- row's own primary key (see `src/features/feedback/queue.ts`'s
-- `enqueueFeedback`) — a retry of the SAME queued submission (weak network,
-- a dropped response, an app restart mid-sync) can only ever collide with
-- its own prior attempt's primary key and be rejected as a duplicate, never
-- insert a second row. Combined with the message length cap above, this is
-- the "light guard against a runaway client" this wave ships: a client bug
-- that resubmits the same in-flight item cannot grow this table without
-- bound; a client bug that generates genuinely new rows in a loop is exactly
-- the "real throttling" class of problem the README already assigns to a
-- future Edge Function, not to this schema pass.

-- ---------------------------------------------------------------------------
-- 2. feedback_photos: optional screenshot metadata, one per feedback row
-- ---------------------------------------------------------------------------
-- Deliberately its own small table (mirroring felt_photos' shape, migration
-- 0003/0016) rather than a column on `feedback` directly, so the upload can
-- land strictly AFTER the feedback row already exists and be retried
-- independently via an idempotent upsert — exactly the ordering
-- `src/features/feedback/queue.ts` (mirroring `src/features/felt/queue.ts`)
-- depends on: "the message must submit successfully even if the photo
-- upload fails or is slow" (wave brief). Unlike `felt_photos` this table has
-- NO moderation columns and NO public select policy at all: feedback
-- screenshots are private correspondence like the rest of this table, never
-- shown to any other user, so there is nothing to moderate FOR.
create table public.feedback_photos (
  photo_id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (feedback_id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

comment on table public.feedback_photos is
  'Optional screenshot attached to a feedback row. No moderation columns and no select policy — private like feedback itself, never publicly displayed.';

-- One screenshot per feedback row (the client model — a single picker slot,
-- same as felt_photos_report_id_uq / Tier2Report.photoUri) — also the
-- client-side upsert target for idempotent retry (onConflict: 'feedback_id').
alter table public.feedback_photos
  add constraint feedback_photos_feedback_id_uq unique (feedback_id);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index idx_feedback_created_at on public.feedback (created_at);
create index idx_feedback_device on public.feedback (device_id);
create index idx_feedback_photos_feedback on public.feedback_photos (feedback_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.feedback enable row level security;
alter table public.feedback_photos enable row level security;

-- feedback: anonymous-friendly write, same stance as felt_reports_insert
-- (migration 0003) — feedback must work with zero signup (PROJECT.md: the
-- whole app is auth-free by default).
create policy feedback_insert
  on public.feedback for insert
  to anon, authenticated
  with check (device_id is not null);

comment on policy feedback_insert on public.feedback is
  'Anonymous-friendly write, matching felt_reports_insert (migration 0003) — no signup required to send feedback.';

-- No select policy at all — deliberate: "Feedback is private correspondence,
-- not public content, and only the service role reads it" (wave brief).
-- Unlike felt_reports (which at least has 0015's narrow select-own
-- exception), feedback gets NO select-own path either: the owner's own
-- review loop is entirely via the Supabase dashboard / service_role, which
-- bypasses RLS implicitly (supabase/README.md's own stated convention).

-- feedback_photos: same anonymous-write stance as felt_photos_insert
-- (migration 0003), but with no select-approved counterpart (see this
-- table's own comment above for why).
create policy feedback_photos_insert
  on public.feedback_photos for insert
  to anon, authenticated
  with check (true);

comment on policy feedback_photos_insert on public.feedback_photos is
  'Anonymous-friendly write, matching felt_photos_insert (migration 0003) — no select policy exists on this table at all (private, see table comment).';

-- No update/delete policy on either table in v0 — same "service_role
-- bypass is implicit, not policy-based" convention as every other table in
-- this schema (migration 0003's own closing comment).

-- ---------------------------------------------------------------------------
-- 3. Storage — a bucket of its own, NOT felt-photos (wave brief: "keep the
--    two separable so retention or deletion policies can differ later")
-- ---------------------------------------------------------------------------
-- Mirrors migration 0016's felt-photos bucket line for line: private,
-- 5 MB cap (matches the client's own aggressive compression, quality 0.4
-- JPEG — see app/feedback.tsx), jpeg/png/webp only.
insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', false)
on conflict (id) do nothing;

-- Same defensive column-existence check as migration 0016 — this repo's
-- migrations are reviewed by inspection before ever running against a live
-- project, so a DO block that no-ops on an unexpectedly different
-- `storage.buckets` shape is strictly safer than an insert that could fail
-- outright on a missing column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    update storage.buckets
      set file_size_limit = 5242880 -- 5 MB, same limit as felt-photos (migration 0016)
      where id = 'feedback-photos';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
      set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
      where id = 'feedback-photos';
  end if;
end $$;

-- storage.objects RLS — INSERT + UPDATE only, path-prefix-scoped to the
-- uploader's own auth.uid(), identical predicate and identical reasoning to
-- migration 0016's felt_photos_storage_insert_own/update_own: device_id is
-- client-supplied and unverifiable by RLS, so only a real (if anonymous)
-- Supabase Auth session's auth.uid() is safe to key a WRITABLE path on.
-- `to authenticated`, not `to anon`, for the same reason: only a session
-- from `signInAnonymously()` ever carries a non-null auth.uid().
create policy feedback_photos_storage_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'feedback-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy feedback_photos_storage_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'feedback-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'feedback-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No SELECT policy on storage.objects for this bucket either — screenshots
-- are reviewed by the owner via the dashboard/service_role only, matching
-- `feedback`/`feedback_photos`' own no-select stance.
