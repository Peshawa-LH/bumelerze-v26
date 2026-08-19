-- 0022: feedback triage fields (owner directive, follow-up to 0020/0021 —
-- "we need to add a tracking field to the data ... I want to track the
-- comments and issues"). Two INDEPENDENT triage fields, not one mixed
-- field, because they answer different questions and a merged field
-- becomes unusable within weeks:
--   - `status`  — workflow state: where a message sits in the review loop.
--   - `category` — content classification: what kind of message it is.
-- Both are assigned by whoever triages (today: the owner, via the
-- dashboard/service role) and NEVER by the app or the system — "we do not
-- need to assign this from the system itself" (owner's own words). Also in
-- this migration: a free-text triage note, a trigger-maintained
-- `updated_at` so the triage list can sort by recent activity, and the
-- removal of the never-used `screen` column (owner, twice: not wanted).
-- Additive-only per this repo's migration convention: a new numbered file;
-- 0020/0021 are never hand-edited.

-- ---------------------------------------------------------------------------
-- 1. status — workflow state, defaults to unseen on arrival
-- ---------------------------------------------------------------------------
-- `unseen` -> `in_review` -> `solved`, with `wont_do` as the one terminal
-- state for things deliberately not being done (distinct from `solved` so
-- the two "closed" reasons stay queryable separately). `not null default
-- 'unseen'` both drives every future insert AND backfills every existing
-- row in the same statement — a single metadata-level rewrite, no separate
-- UPDATE needed — which is exactly right per the owner's own framing that
-- the four rows already in the table "are all genuinely unseen".
alter table public.feedback
  add column status text not null default 'unseen'
    check (status in ('unseen', 'in_review', 'solved', 'wont_do'));

comment on column public.feedback.status is
  'Triage workflow state, owner-assigned only (the app never reads or writes this): unseen (default, on arrival) -> in_review -> solved, or wont_do for anything deliberately not being done.';

-- ---------------------------------------------------------------------------
-- 2. category — what kind of thing it is, nullable, triage-assigned
-- ---------------------------------------------------------------------------
-- Nullable and with no default: a category is assigned during triage, by a
-- human reading the message, never guessed at insert time. Covers the
-- owner's own list ("suggestion from others, prompts, issues, fixed,
-- improvements, bugs") collapsed to five durable buckets plus a catch-all
-- (`fixed`/`solved` is already `status`, not a category, per this
-- migration's own header split).
alter table public.feedback
  add column category text
    check (category is null or category in ('bug', 'improvement', 'suggestion', 'question', 'other'));

comment on column public.feedback.category is
  'Triage content classification, nullable until a human reviews the message and assigns one (never guessed by the system, never set by the client). One of bug / improvement / suggestion / question / other.';

-- ---------------------------------------------------------------------------
-- 3. triage_note — free text for whoever reviews to record a decision
-- ---------------------------------------------------------------------------
alter table public.feedback
  add column triage_note text
    check (triage_note is null or char_length(triage_note) <= 4000);

comment on column public.feedback.triage_note is
  'Free-text note for whoever triages this row (what was decided, follow-up needed, etc.) — owner-only, never read or written by the client. Same length cap as feedback.message itself.';

-- ---------------------------------------------------------------------------
-- 4. updated_at — trigger-maintained, so the triage list can sort by recent
--    activity (a status/category/note edit counts as activity)
-- ---------------------------------------------------------------------------
alter table public.feedback
  add column updated_at timestamptz not null default now();

-- Backfill: an existing row's own creation IS its most recent activity so
-- far (nothing has triaged it yet) — `default now()` above would otherwise
-- leave every pre-existing row's `updated_at` at "the moment this migration
-- ran", which would wrongly sort all four current rows as "just touched".
update public.feedback set updated_at = created_at;

comment on column public.feedback.updated_at is
  'Maintained by trigger feedback_set_updated_at below on every UPDATE — lets the triage list sort by recent activity, not just arrival. Backfilled to created_at for rows that existed before this column did.';

create or replace function public.set_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_feedback_updated_at() is
  'Sets feedback.updated_at = now() on every UPDATE — see the column comment on feedback.updated_at.';

drop trigger if exists feedback_set_updated_at on public.feedback;
create trigger feedback_set_updated_at
  before update on public.feedback
  for each row
  execute function public.set_feedback_updated_at();

-- ---------------------------------------------------------------------------
-- 5. screen — DROP (owner, re-confirmed this wave: "we don't need
--    location, only getting the message would be enough" / "the feedback
--    screen and message stays the same" — no new field was ever wanted
--    here either). Chose DROP over "mark deprecated": nothing has ever
--    populated it with anything meaningful (the one entry point, Settings,
--    always sent the literal string "settings", and this same wave's
--    client change removes even that), so there is no data worth
--    preserving and no reason to carry a permanently-unused column
--    forward — a "deprecated but still present" column is a trap for a
--    future reader who doesn't have this comment's context. Dropping it
--    here (rather than leaving it and only stopping the client from
--    sending it) keeps the schema truthful about what the app actually
--    captures today.
-- ---------------------------------------------------------------------------
alter table public.feedback drop column if exists screen;

-- ---------------------------------------------------------------------------
-- RLS — untouched, deliberately
-- ---------------------------------------------------------------------------
-- `feedback_insert` (0020) already has no column-level predicate, and this
-- table still has NO select policy and NO update policy for `anon`/
-- `authenticated` at all — so even though `status`/`category`/
-- `triage_note` all default/allow-null safely for a plain insert, there is
-- still no RLS path from the client to READ or WRITE any of the four
-- columns this migration adds: default-deny already covers it. Reads and
-- edits happen exclusively via service_role (Supabase dashboard table
-- editor / the orchestrator's own tooling), which bypasses RLS implicitly
-- — same convention as every other table in this schema (see
-- supabase/README.md's own "service_role bypass is implicit" note).
