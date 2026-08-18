-- 0021: feedback allows several screenshots per submission (owner
-- directive, follow-up to 0020: "a user should be able to attach more than
-- one photo" — a tester reporting a visual problem usually has several
-- screenshots, and forcing one per message just makes them send several
-- messages instead). Additive-only per this repo's migration convention: a
-- new numbered file, 0020 itself is never hand-edited.
--
-- The ONLY schema change this wave needs is dropping the constraint that
-- made `feedback_photos` a one-row-per-feedback table:
-- `feedback_photos_feedback_id_uq` (0020) enforced "at most one photo per
-- feedback_id" and was also the client's upsert target
-- (`onConflict: 'feedback_id'`) for retry-idempotency. Both jobs move to
-- `photo_id`: `feedback_photos.photo_id` (0020) is already a plain UUID
-- primary key with a server-side default, and nothing about that column
-- ever required the default to be used — the client now generates its own
-- `photo_id` per photo (same convention `feedback.feedback_id` already
-- established: a client-generated id reused as the row's own PK), and
-- upserts on `onConflict: 'photo_id'` instead. A retry of the SAME queued
-- photo can only ever collide with its own prior attempt's primary key, so
-- idempotency is preserved with a strictly WIDER table shape rather than a
-- new mechanism.
--
-- Idempotent/defensive: this migration only drops the constraint if it is
-- still present, so re-running this file (or running it against a database
-- that already had it dropped by some other means) is a safe no-op rather
-- than an error.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.feedback_photos'::regclass
      and conname = 'feedback_photos_feedback_id_uq'
  ) then
    alter table public.feedback_photos
      drop constraint feedback_photos_feedback_id_uq;
  end if;
end
$$;

-- `idx_feedback_photos_feedback` (0020) already covers lookups by
-- `feedback_id` and is untouched by the drop above (it was always a
-- separate index, not the unique constraint's implicit one) — several
-- `feedback_photos` rows per `feedback_id` now simply return several rows
-- through that same index rather than at most one.

-- Defensive uniqueness net: `storage_path` is deterministically derived
-- from `photo_id` on the client (`<auth.uid()>/<feedback_id>/<photo_id>.<ext>`,
-- `src/features/feedback/supabase-transport.ts`), so two DIFFERENT photos
-- can never legitimately share a path — this guards against a future bug
-- (not a scenario this wave's own client code can produce) writing two
-- rows at the same storage location, which would otherwise silently point
-- one of them at the wrong bytes. Skipped defensively if some already-
-- inserted 0020-era row happens to collide (there can be at most one, the
-- old unique-per-feedback_id row) rather than failing outright.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.feedback_photos'::regclass
      and conname = 'feedback_photos_storage_path_uq'
  ) then
    begin
      alter table public.feedback_photos
        add constraint feedback_photos_storage_path_uq unique (storage_path);

      -- Only commented if the constraint above actually landed — see the
      -- exception handler below for the (should-never-happen) case where
      -- it does not.
      comment on constraint feedback_photos_storage_path_uq on public.feedback_photos is
        'Defensive only, added 0021 alongside multi-photo support: storage_path is derived deterministically from photo_id on the client, so this should never legitimately fire.';
    exception
      when unique_violation then
        -- Pre-existing data has a duplicate storage_path (should not
        -- happen given 0020's per-feedback uniqueness, but this migration
        -- must never fail an otherwise-unrelated deploy over it) — leave
        -- the table without this defensive constraint rather than block.
        null;
    end;
  end if;
end
$$;

comment on table public.feedback_photos is
  'Optional screenshot(s) attached to a feedback row, up to the client-enforced cap (5, see app/feedback.tsx) — several rows per feedback_id as of 0021 (was at most one under 0020). No moderation columns and no select policy — private like feedback itself, never publicly displayed.';

comment on column public.feedback_photos.photo_id is
  'Client-generated UUID as of 0021 (was server-default-only under 0020) — the client-side upsert key (onConflict: photo_id) for idempotent per-photo retry, one identity per photo rather than per feedback_id.';

comment on column public.feedback_photos.storage_path is
  'As of 0021: <auth.uid()>/<feedback_id>/<photo_id>.<ext> (was <auth.uid()>/<feedback_id>.jpg under 0020) — keyed per photo so several photos on the same feedback_id never collide on one path.';

-- RLS is untouched: `feedback_photos_insert` (0020) already has no
-- per-row-count predicate, and `storage.objects`' own
-- `feedback_photos_storage_insert_own` / `_update_own` (0020) key on the
-- path's first segment (`auth.uid()`) only, which the new
-- `<uid>/<feedback_id>/<photo_id>.<ext>` layout still satisfies unchanged.
