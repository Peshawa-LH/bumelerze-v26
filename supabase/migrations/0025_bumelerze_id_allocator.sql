-- 0025: Postgres becomes the single allocation authority for
-- `bumelerze_id` ("bml id"). Scheme: docs/research/bumelerze-id-scheme.md
-- (spec, format-frozen) and shake-service/shake_service/event_id.py (the
-- reference implementation this migration ports byte-for-byte). Migration
-- 0008 added the NULLable column and always documented this handover as
-- "future" — this is that handover.
--
-- WHY NOW: verified against the live project (2026-08-27) that THREE
-- would-be allocators exist and NONE of them is authoritative —
--   1. The bumelerze-engine worker has been minting `bml2026...` since
--      January from a GitHub Actions cache that cannot be read back; its
--      true high-water mark is unknown (Atlas shows published ids only up
--      to counter 82 — unpublished allocations are invisible).
--   2. The archival catalog rebuild left 1,776 origin-year-2026 events
--      `bumelerze_id = NULL`, `id_status = 'pending-live-authority'`, in
--      `bumelerze-engine/regional-catalog/` — waiting on exactly this RPC
--      (see supabase/README.md "Archival backfill handshake" for the
--      protocol the engine repo will use; NOT built here).
--   3. `upsert_event_from_client` (0011/0012) has always inserted
--      `bumelerze_id = NULL` — `select count(*) from events where
--      bumelerze_id is not null` returns 0 on the live project. Postgres
--      has never allocated one despite being the column's home since 0008.
-- This migration makes Postgres the ONE allocator going forward. Migration
-- 0026 wires `upsert_event_from_client` to call it and backfills the 40
-- existing null rows; this migration only adds the allocator itself so it
-- can be reviewed/tested in isolation.
--
-- ---------------------------------------------------------------------------
-- Locking strategy (why this is safe under 4 overlapping pg_cron ingest
-- channels, migration 0024: emsc/usgs every 1 min, geofon every 5 min, isc
-- once daily — any of which can be mid-flight at once, each potentially
-- discovering a brand-new event in the same instant):
--
-- Every allocation — single or batch — is ONE statement:
--   INSERT ... VALUES (year, n) ON CONFLICT (year) DO UPDATE
--     SET last_counter = last_counter + n
--   RETURNING last_counter
-- Postgres serializes concurrent INSERTs that collide on the same unique
-- key (`year`) at the row level: the second (and third, ...) concurrent
-- transaction targeting the SAME year blocks on that row until the first
-- commits, then re-evaluates the ON CONFLICT branch against the
-- now-committed value and proceeds — this is standard, documented Postgres
-- upsert behavior (an "upsert as atomic counter" idiom), not something this
-- migration invents. There is no read-then-write gap for a concurrent
-- transaction to land in, so no allocation is ever handed out twice and no
-- increment is ever lost — exactly the property the wave brief calls
-- "a lost update here permanently corrupts identity."
--
-- Two different years never block each other (they're different rows), so
-- the four channels racing on DIFFERENT years (e.g. a late-arriving 2025
-- ISC bulletin row racing a live 2026 EMSC event) proceed independently;
-- only same-year collisions serialize, and only for the instant of that one
-- row's commit — a few-millisecond lock, not a app-wide mutex. This is
-- deliberately NOT `pg_advisory_xact_lock` (the pattern
-- `upsert_event_from_client` already uses for its own (provider,
-- provider_event_id) dedup key, 0011): an advisory lock would work too, but
-- the row-level lock that ON CONFLICT already takes is simpler, needs no
-- extra statement, and is exactly as strong for a single hot row.
--
-- Gap-free is explicitly NOT required (module docstring, event_id.py):
-- a rolled-back caller (e.g. the ingester crashes after allocating but
-- before writing the events row) burns that counter value forever — an
-- accepted, documented property, identical to the worker's own "a crash
-- before ws.save re-allocates... safe" note for its in-memory allocator.
-- Never reusing a value IS required, and the ON CONFLICT UPDATE only ever
-- moves `last_counter` upward, never resets or decrements it — so a
-- rollback cannot un-burn a counter, and no two callers can ever observe
-- the same RETURNING value for the same year.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. bumelerze_id_counters — one row per origin year, NOT a bare
-- `CREATE SEQUENCE`: Postgres sequences are one global object each, and this
-- scheme needs an independent counter PER YEAR that can be seeded to an
-- arbitrary starting value (see §3 below) without a migration per year.
-- A single-column-PK table + the atomic upsert in §2 gives exactly that,
-- self-service for any future year (first allocation for an unseen year
-- creates its row via the INSERT branch, seeded at 0 implicitly).
-- ---------------------------------------------------------------------------
create table public.bumelerze_id_counters (
  year integer primary key check (year between 0 and 9999),
  last_counter bigint not null default 0 check (last_counter >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.bumelerze_id_counters is
  'The single per-year allocation authority for events.bumelerze_id ("bml id"). One row per origin year; last_counter is the highest counter already handed out for that year — NEVER decremented, NEVER reused. Written exclusively through allocate_bumelerze_id[_batch] (single atomic INSERT ... ON CONFLICT ... RETURNING per call, migration 0025 header comment) — never hand-updated. 2026 is seeded at 999 (reserved band, see that row''s own note) so the FIRST Postgres-issued 2026 id is counter 1000; every other year starts unseeded and its first allocation returns counter 1.';

create trigger bumelerze_id_counters_set_updated_at
  before update on public.bumelerze_id_counters
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Seed 2026 above a reserved band.
--
-- The bumelerze-engine worker has been the SOLE minter of `bml2026...` ids
-- since January, entirely independently of this database (Postgres has
-- allocated exactly zero of them — verified above). Its counter lives in a
-- GitHub Actions cache this migration's author cannot read; the Atlas
-- (published products only) shows ids up to counter 82, but the worker also
-- allocates ids for events that never reach a published product (any
-- "catalog"-only detection, event_id.py's own allocation-rule #1) and for
-- any run since whose cache write never got read back — so the TRUE
-- high-water mark is unknown and could plausibly be some hundreds, not 82.
--
-- Rather than guess a number and risk a live collision the day the worker's
-- cache resurfaces, this migration reserves counters 1-999 for the
-- worker's past and near-future legacy allocations and starts the Postgres
-- allocator for 2026 at 1000 — a full order of magnitude above the only
-- confirmed high-water mark (82), and comfortably above any plausible
-- undercounted true value for a regional network's first eight months of
-- live monitoring. A future reader who notices Postgres-issued 2026 ids
-- start at `bml20260rs` (1000) rather than `bml20260001`: this is why —
-- there is no missing migration, the gap is deliberate and permanent (gaps
-- are explicitly allowed; only REUSE is forbidden, migration 0025 header).
--
-- Seeded via `last_counter = 999` so the allocator's first call (which
-- always increments-then-returns, see §3) hands out counter 1000, not 999.
-- Every other year is left unseeded (no row here) — its first ever
-- allocation naturally returns counter 1 (the INSERT ... ON CONFLICT branch
-- with no existing row inserts `last_counter = <count>` directly, §3).
-- ---------------------------------------------------------------------------
insert into public.bumelerze_id_counters (year, last_counter)
values (2026, 999);

comment on column public.bumelerze_id_counters.last_counter is
  'Highest counter already allocated for this year. 2026 is pre-seeded to 999 — a reserved band for the pre-existing bumelerze-engine worker''s own (unreadable, possibly-still-growing) legacy allocator, whose true high-water mark is unknown but confirmed >= 82 (Atlas-published ids) — see this table''s own comment and migration 0025''s header for the full reasoning. Every other year has no seed row until its first allocation.';

-- ---------------------------------------------------------------------------
-- 3. bumelerze_base36 / format_bumelerze_id — faithful SQL port of
-- shake_service/event_id.py's `base36()` / `format_bumelerze_id()`. Same
-- alphabet (`0-9a-z`, lowercase only), same "0" special case, same
-- zero-pad-to-4 behavior, same unbounded growth past `zzzz` (padding is
-- applied ONLY when the base-36 string is shorter than 4 chars — Postgres's
-- own `lpad()` TRUNCATES a string longer than its target width, which would
-- silently corrupt any 5+-digit rollover id, so it is deliberately never
-- called unconditionally). Pure functions of their inputs — IMMUTABLE.
--
-- Verified byte-for-byte against the Python implementation (ad hoc, this
-- migration's authoring session, `python3 -c "from shake_service.event_id
-- import base36, format_bumelerze_id; ..."` against the sibling
-- bumelerze-engine checkout) for the same spread the accompanying Jest
-- suite checks: 0, 1, 35, 36, 1295, 1296, 46655 -> '0','1','z','10','zz',
-- '100','zzz'. src/lib/__tests__/bumelerze-id.test.ts re-asserts these
-- exact values (plus a best-effort live cross-check against the sibling
-- Python module) so a future edit to either side that breaks byte-for-byte
-- agreement fails CI, not just a manual re-check.
-- ---------------------------------------------------------------------------
create or replace function public.bumelerze_base36(p_n bigint)
returns text
language plpgsql
immutable
as $$
declare
  v_digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_n bigint := p_n;
  v_result text := '';
begin
  if v_n < 0 then
    raise exception 'bumelerze_base36: negative value %', v_n using errcode = '22023';
  end if;
  if v_n = 0 then
    return '0';
  end if;
  while v_n > 0 loop
    v_result := substr(v_digits, (v_n % 36)::int + 1, 1) || v_result;
    v_n := v_n / 36;
  end loop;
  return v_result;
end;
$$;

comment on function public.bumelerze_base36(bigint) is
  'Non-negative integer -> lowercase base-36 string, no padding. SQL port of shake_service/event_id.py::base36 — same alphabet, same "0" special case. Migration 0025.';

create or replace function public.format_bumelerze_id(p_year integer, p_counter bigint)
returns text
language plpgsql
immutable
as $$
declare
  v_suffix text;
begin
  if p_year is null or p_year < 0 or p_year > 9999 then
    raise exception 'format_bumelerze_id: year % not expressible in 4 digits', p_year
      using errcode = '22023';
  end if;
  if p_counter is null or p_counter < 1 then
    raise exception 'format_bumelerze_id: counter must be >= 1, got %', p_counter
      using errcode = '22023';
  end if;
  v_suffix := public.bumelerze_base36(p_counter);
  -- Pad ONLY when shorter than 4 — lpad() truncates a longer string, which
  -- would corrupt any past-`zzzz` rollover id (event_id.py's own module
  -- docstring: "never truncated, never reused").
  if length(v_suffix) < 4 then
    v_suffix := lpad(v_suffix, 4, '0');
  end if;
  return 'bml' || lpad(p_year::text, 4, '0') || v_suffix;
end;
$$;

comment on function public.format_bumelerze_id(integer, bigint) is
  '(year, 1-based counter) -> canonical bml id, e.g. (2026, 1) -> bml20260001, (2026, 1000) -> bml202600rs. SQL port of shake_service/event_id.py::format_bumelerze_id — byte-identical format, including the past-zzzz unbounded-growth behavior. Migration 0025.';

-- ---------------------------------------------------------------------------
-- 4. allocate_bumelerze_id_batch — the one place that ever writes
-- bumelerze_id_counters. Atomically reserves a contiguous block of
-- `p_count` counters for `p_year` (see this migration's header "Locking
-- strategy") and returns their formatted ids in allocation order. Backs
-- BOTH the single-id RPC below (p_count = 1) and the archival catalog's
-- 1,776-event backfill (p_count = however many origin-2026 rows that batch
-- has) — one locking path, not two independently-maintained ones.
--
-- Service-role only (see grants below): this is the authority the
-- bumelerze-engine worker calls directly with its own service-role key once
-- it stops minting ids locally, and the ONLY path the archival-catalog
-- backfill (supabase/README.md) uses. Never callable by anon/authenticated
-- — nothing in the client app allocates ids; `upsert_event_from_client`
-- (0011/0012, updated by migration 0026) calls it as an internal
-- `plpgsql`-to-`plpgsql` call from within ITS OWN SECURITY DEFINER context,
-- which needs no separate grant (the executing role for an internal call
-- inside a SECURITY DEFINER function body is the function's OWNER, same as
-- every other internal call this schema already makes — e.g.
-- upsert_event_from_client's own calls into public.events).
-- ---------------------------------------------------------------------------
create or replace function public.allocate_bumelerze_id_batch(p_year integer, p_count integer)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end bigint;
  v_start bigint;
begin
  if p_count is null or p_count < 1 then
    raise exception 'allocate_bumelerze_id_batch: count must be >= 1, got %', p_count
      using errcode = '22023';
  end if;
  if p_count > 1000000 then
    -- Sanity ceiling, not a real limit: guards against a caller accidentally
    -- passing a timestamp or an unbounded count and generating millions of
    -- ids in one call. 1,000,000 is far above any real batch this app has
    -- (the archival backfill's 1,776 origin-2026 rows; the largest
    -- plausible future one, per event_id.py's own module docstring, is
    -- 36^4 - 1 = 1,679,615 events IN A SINGLE YEAR).
    raise exception 'allocate_bumelerze_id_batch: count % exceeds sanity ceiling', p_count
      using errcode = '22023';
  end if;
  if p_year is null or p_year < 0 or p_year > 9999 then
    raise exception 'allocate_bumelerze_id_batch: year out of range: %', p_year
      using errcode = '22023';
  end if;

  -- The one atomic statement (migration header "Locking strategy"): reserves
  -- [last_counter+1, last_counter+p_count] for this year in a single
  -- INSERT ... ON CONFLICT ... RETURNING, safe under N concurrent callers.
  insert into public.bumelerze_id_counters (year, last_counter)
  values (p_year, p_count)
  on conflict (year) do update
    set last_counter = public.bumelerze_id_counters.last_counter + p_count,
        updated_at = now()
  returning last_counter into v_end;

  v_start := v_end - p_count + 1;

  return array(
    select public.format_bumelerze_id(p_year, gs)
    from generate_series(v_start, v_end) as gs
  );
end;
$$;

comment on function public.allocate_bumelerze_id_batch(integer, integer) is
  'Atomically reserves p_count contiguous bml-id counters for p_year and returns them, formatted, in allocation order (single INSERT ... ON CONFLICT ... RETURNING — see migration 0025''s header for why this is race-free under overlapping pg_cron ingest channels). SERVICE ROLE ONLY. Called with p_count = 1 by allocate_bumelerze_id; called directly by the bumelerze-engine worker (once it stops minting ids locally) and by the archival-catalog backfill described in supabase/README.md. Migration 0025.';

revoke all on function public.allocate_bumelerze_id_batch(integer, integer) from public, anon, authenticated;
grant execute on function public.allocate_bumelerze_id_batch(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. allocate_bumelerze_id — the single-id convenience form. Thin `sql`
-- wrapper over §4 (p_count = 1) so there is exactly ONE place the atomic
-- upsert is written, not two copies that could drift.
--
-- This is the RPC signature the bumelerze-engine worker calls per newly
-- detected canonical event once it stops minting ids from its own state
-- file (event_id.py's own "FUTURE handover" note, and
-- source-and-ingestion-plan.md §17): `allocate_bumelerze_id(origin_year)
-- returns text`. Also the RPC `upsert_event_from_client` (migration 0026)
-- calls internally for the client/ingester write path.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_bumelerze_id(p_year integer)
returns text
language sql
security definer
set search_path = public
as $$
  select (public.allocate_bumelerze_id_batch(p_year, 1))[1];
$$;

comment on function public.allocate_bumelerze_id(integer) is
  'Allocates and returns exactly one bml id for p_year (the event''s ORIGIN year, UTC — never the detection year). Thin wrapper over allocate_bumelerze_id_batch(p_year, 1), the shared atomic-upsert path. SERVICE ROLE ONLY at the RPC layer; upsert_event_from_client (migration 0026) calls it internally (no separate grant needed for an internal SECURITY DEFINER-to-SECURITY DEFINER call, see allocate_bumelerze_id_batch''s own comment). This is the signature the bumelerze-engine worker calls once it stops minting ids locally. Migration 0025.';

revoke all on function public.allocate_bumelerze_id(integer) from public, anon, authenticated;
grant execute on function public.allocate_bumelerze_id(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS — bumelerze_id_counters is pure internal allocator state, exactly
-- like event_source_records/event_merges (0002's own framing): enabled with
-- ZERO policies for anon/authenticated denies all client access by
-- default; every write goes through the two SECURITY DEFINER RPCs above
-- (owned by the migration-running role, which bypasses RLS — same posture
-- as every other SECURITY DEFINER function in this schema, see
-- supabase/README.md "service_role bypass is implicit, not policy-based").
-- No SELECT policy either: the counters themselves are not public data —
-- the app only ever needs the FORMATTED id, already exposed on
-- events/events_with_sources.
-- ---------------------------------------------------------------------------
alter table public.bumelerze_id_counters enable row level security;
