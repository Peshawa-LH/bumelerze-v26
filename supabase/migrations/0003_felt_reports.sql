-- Bumelerze schema v0 — felt reports (tier 1 + tier 2) + moderated photos/comments
-- Implements spec-v1 §5.2 and felt-report-science-v1.md Parts 1-2, confirmed D18.

-- ---------------------------------------------------------------------------
-- felt_reports: tier-1 record. One row per (device, event) once associated —
-- see felt_reports_device_event_uq below.
-- ---------------------------------------------------------------------------
create table public.felt_reports (
  report_id uuid primary key default gen_random_uuid(),

  -- D8: anonymous per-install device id, required on every report. Client-
  -- generated, not tied to any Supabase auth identity — felt reporting must
  -- work with zero network round-trips to an auth endpoint (PROJECT.md
  -- offline requirement). RLS cannot verify this value belongs to the
  -- calling device; see supabase/README.md "what RLS can't do here".
  device_id text not null check (char_length(device_id) between 1 and 128),

  -- D8: nullable for future accounts / citizen-seismologist profiles —
  -- present now so those features attach without a migration later.
  user_id uuid references auth.users (id) on delete set null,

  -- Nullable at capture (offline queue, or filed before the matching event
  -- exists yet in our catalog); associated later by the ingestion/
  -- association job. on delete set null: if an event is ever hard-deleted
  -- the report itself is never lost.
  event_id uuid references public.events (event_id) on delete set null,

  -- Tier-1 pick: 1 of 12 EMS-98 cartoons (felt-report-science-v1.md Part 1).
  cartoon_level smallint not null check (cartoon_level between 1 and 12),

  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),

  -- D18 §3.1: base display/CDI aggregation cell, derived at write time so
  -- the aggregation job never recomputes it and the client never has to
  -- send it.
  geohash_p5 text generated always as (
    st_geohash(st_setsrid(st_makepoint(lon, lat), 4326), 5)
  ) stored,

  -- D18 §3.1: 'manual' = town/region-centroid fallback when GPS permission
  -- is denied (spec-v1 §4.6 "never block the one-tap promise on a
  -- permission grant"); excluded from the p6 city-refinement pass.
  location_quality text not null default 'gps' check (location_quality in ('gps', 'manual')),

  created_at timestamptz not null default now(),  -- captured on-device; may be backdated by the offline queue
  submitted_at timestamptz not null default now() -- when it reached the server; (submitted_at - created_at) measures offline-queue lag
);

comment on table public.felt_reports is
  'Tier-1 felt reports (one EMS-98 cartoon pick). Own-data-only (D8): never merged with USGS/EMSC testimony data.';
comment on column public.felt_reports.device_id is
  'D8: anonymous per-install device id. Client-supplied, not authenticated — see README for the RLS caveat this implies.';

-- D18 §3.2 dedup rule: "one report per device ID per event". Partial (not a
-- plain UNIQUE constraint) because event_id is legitimately NULL before
-- association.
create unique index felt_reports_device_event_uq
  on public.felt_reports (device_id, event_id)
  where event_id is not null;

-- ---------------------------------------------------------------------------
-- felt_report_details: tier-2, optional. One-to-one with felt_reports —
-- tier-2 *supersedes* the device's tier-1 pick in place, it does not create
-- a second felt_reports row (D18 §3.2).
-- ---------------------------------------------------------------------------
create table public.felt_report_details (
  detail_id uuid primary key default gen_random_uuid(),

  felt_report_id uuid not null unique references public.felt_reports (report_id) on delete cascade,

  -- Q1 — context only, CDI weight 0 (felt-report-science-v1.md §2 Q1).
  situation text check (situation in ('inside', 'outside', 'stopped_car', 'moving_car', 'asleep')),

  -- Q2-Q9: the 8 published DYFI/CDI indices, stored as raw enumerated
  -- answers (not pre-computed index values) so the CWS/CDI math can be
  -- re-run/corrected later without re-asking users (D13, D18 R1/R2/R4).
  felt_answer text check (felt_answer in ('no', 'yes')), -- Q2 -> index `felt`
  others_felt_answer text check (others_felt_answer in ('dont_know', 'no_one', 'some', 'most', 'everyone')), -- Q3 -> modifies `felt` (DYFI getFeltFromOther, D18 R2: code values 0.36/0.72)
  motion_answer text check (motion_answer in ('not_felt', 'weak', 'mild', 'moderate', 'strong', 'violent')), -- Q4 -> index `motion`
  reaction_answer text check (reaction_answer in ('no_reaction', 'noticed', 'excitement', 'somewhat_frightened', 'very_frightened', 'extremely_frightened')), -- Q5 -> index `reaction`
  stand_answer text check (stand_answer in ('no', 'difficult', 'fell')), -- Q6 -> index `stand` ('fell' capped at index 1 per D18 R3; IX+ is an EMS-side diagnostic only)
  shelf_answer text check (shelf_answer in ('no', 'rattled', 'few_fell', 'many_fell')), -- Q7 -> index `shelf`, weight 5 — highest-priority unverified value, D18 R1 (Phase-2 DYFI-form check pending)
  picture_answer text check (picture_answer in ('no', 'yes')), -- Q8 -> index `picture`
  furniture_answer text check (furniture_answer in ('no', 'yes')), -- Q9 -> index `furniture`

  -- Q10: structured building damage, 4 levels (MyShake pattern) -> both the
  -- `damage` CDI index and an EMS-98/IMS-25 damage grade (D18 R5/R7).
  building_damage_level smallint check (building_damage_level between 0 and 3),

  -- Q11: road/ground damage. Deliberately excluded from both CDI and EMS
  -- intensity (D18 R8) — stored purely as a ground-effects layer + moderator
  -- safety signal.
  road_damage_level smallint check (road_damage_level between 0 and 3),

  -- Full verbatim submission (all Q1-Q11 answers as sent by the client).
  -- Authoritative source for IMS-25 re-scoring, the Phase-2 tier-1/tier-2
  -- correction fit, and the SHAKEdyfi benchmark (D13; D18 §3.5).
  raw_answers jsonb not null,

  created_at timestamptz not null default now()
);

comment on table public.felt_report_details is
  'Tier-2 optional follow-up: the 8 CDI index answers + structured damage questions. One-to-one with felt_reports (tier-2 supersedes tier-1, D18 §3.2).';

-- ---------------------------------------------------------------------------
-- felt_photos / felt_comments: attached to a felt_reports row (tier-1 or
-- tier-2), moderated before public display (D15). No likes field (D11 /
-- feature-matrix B13 — deliberate).
-- ---------------------------------------------------------------------------
create table public.felt_photos (
  photo_id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.felt_reports (report_id) on delete cascade,
  storage_path text not null, -- Supabase Storage object path
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  moderated_at timestamptz,
  moderated_by text, -- free text (Supabase dashboard reviewer identity); no admin-user table in v0 (D15)
  created_at timestamptz not null default now()
);

comment on table public.felt_photos is
  'Optional tier-2 photo attachments. Moderation queue per D15 — pending photos are never publicly visible.';

create table public.felt_comments (
  comment_id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.felt_reports (report_id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 128),
  user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  moderated_at timestamptz,
  moderated_by text,
  created_at timestamptz not null default now()
);

comment on table public.felt_comments is
  'Open comment stream attached to felt reports, moderated per D15. No like/dislike field by design (D11 / feature-matrix B13).';

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index idx_felt_reports_event_geohash on public.felt_reports (event_id, geohash_p5);
create index idx_felt_reports_device on public.felt_reports (device_id);
create index idx_felt_reports_submitted_at on public.felt_reports (submitted_at);

create index idx_felt_photos_report on public.felt_photos (report_id);
create index idx_felt_photos_moderation on public.felt_photos (moderation_status);

create index idx_felt_comments_report on public.felt_comments (report_id);
create index idx_felt_comments_moderation on public.felt_comments (moderation_status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.felt_reports enable row level security;
alter table public.felt_report_details enable row level security;
alter table public.felt_photos enable row level security;
alter table public.felt_comments enable row level security;

-- felt_reports: anonymous-friendly write (D8 "must not require signup").
-- Device-scoped in intent only — RLS cannot cryptographically bind device_id
-- to the calling client without an auth session, so this check is a basic
-- sanity gate, not an ownership proof (see README).
create policy felt_reports_insert
  on public.felt_reports for insert
  to anon, authenticated
  with check (device_id is not null);

-- No select policy: individual raw reports are never publicly readable
-- (felt-report-science-v1.md §3.5: "individual raw reports are never
-- publicly displayed — only cell aggregates"). Public consumption is
-- entirely through felt_cells_public (0004_felt_cells.sql).

-- felt_report_details: same anonymous-write, no-select stance as
-- felt_reports. Attaching to a report_id you don't already hold is only
-- prevented by not knowing the id, not by RLS — a v0 limitation, see README.
create policy felt_report_details_insert
  on public.felt_report_details for insert
  to anon, authenticated
  with check (true);

-- felt_photos: anyone can queue a photo for moderation; only approved
-- photos are publicly visible (D15).
create policy felt_photos_insert
  on public.felt_photos for insert
  to anon, authenticated
  with check (true);

create policy felt_photos_select_approved
  on public.felt_photos for select
  to anon, authenticated
  using (moderation_status = 'approved');

-- felt_comments: same moderation-gated pattern as felt_photos (D15).
create policy felt_comments_insert
  on public.felt_comments for insert
  to anon, authenticated
  with check (true);

create policy felt_comments_select_approved
  on public.felt_comments for select
  to anon, authenticated
  using (moderation_status = 'approved');

-- All four tables: the moderation UPDATE (pending -> approved/rejected) and
-- any server-side association/re-scoring UPDATE happen via the service_role
-- key, which bypasses RLS — no client-facing update/delete policy exists on
-- any of these tables in v0.
